import type { Place } from '../../src/domain/favorites'
import { distanceMeters } from '../../src/domain/geo'
import { findRestaurantCategory, restaurantCategoryAliases } from '../../src/domain/restaurant-categories'
import {
  rankRecommendations,
  type RankedPlace,
  type RecommendationCandidate,
  type RecommendationRequest,
} from '../../src/domain/recommendation'
import { createAmapClient, type PlaceSearchQuery } from '../place-search/amap-client'
import {
  createCloudBaseSearchCache,
  createPlaceSearchService,
  type CloudBaseCacheDatabase,
  type PlaceSearchResult,
} from '../place-search/cache'
import { createAmapRoutesClient, type RouteTimesClient } from '../place-routes/amap-routes'
import {
  createCloudBaseRouteRateLimiter,
  type CloudBaseRouteRateLimitDatabase,
} from '../place-routes/rate-limiter'
import { selectCloudBaseSdk } from '../shared/cloudbase-sdk'
import { createCloudBasePublicPlaceStore, type PublicPlacesDatabase } from '../shared/public-places'

export type { RouteTimesClient } from '../place-routes/amap-routes'

export interface RecommendationSearchClient {
  search(query: PlaceSearchQuery): Promise<PlaceSearchResult>
}

export interface RecommendationItem extends RankedPlace {
  travelTimeUnavailable: boolean
}

export interface RecommendationResult {
  items: RecommendationItem[]
  stale: boolean
  sourceUpdatedAt: string
}

export class RecommendationRequestError extends Error {
  readonly code = 'INVALID_RECOMMENDATION_REQUEST'

  constructor() {
    super('推荐条件无效')
    this.name = 'RecommendationRequestError'
  }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: string | undefined) => value?.trim() ?? ''
const normalized = (value: string) => value.trim().toLocaleLowerCase('zh-CN')

function validPoint(point: RecommendationRequest['center']): boolean {
  return finite(point?.latitude) && point.latitude >= -90 && point.latitude <= 90
    && finite(point?.longitude) && point.longitude >= -180 && point.longitude <= 180
}

function validBudget(budget: RecommendationRequest['budget']): boolean {
  if (!budget) return true
  const min = budget.min
  const max = budget.max
  if (min !== undefined && (!finite(min) || min < 0)) return false
  if (max !== undefined && (!finite(max) || max < 0)) return false
  return min === undefined || max === undefined || min <= max
}

function validate(request: RecommendationRequest): void {
  if (!request || typeof request !== 'object') throw new RecommendationRequestError()
  const hasPreference = Boolean(text(request.category) || text(request.keywords) || request.random)
  if (!hasPreference || !validPoint(request.center)
    || !finite(request.radiusMeters) || request.radiusMeters <= 0 || request.radiusMeters > 50_000
    || !['walking', 'bicycling', 'driving'].includes(request.travelMode)
    || request.maxMinutes !== undefined && (!finite(request.maxMinutes) || request.maxMinutes <= 0)
    || !validBudget(request.budget)) {
    throw new RecommendationRequestError()
  }
}

function searchable(place: Place): string[] {
  return [place.name, ...(place.categories ?? []), ...(place.tags ?? [])]
    .map(normalized)
    .filter(Boolean)
}

function matchesPreference(place: Place, request: RecommendationRequest): boolean {
  if (request.random) return true
  const values = searchable(place)
  const joined = values.join(' ')
  const category = normalized(text(request.category))
  const keywords = text(request.keywords).split(/[\s,，、/]+/).map(normalized).filter(Boolean)
  const categoryMatch = category
    ? restaurantCategoryAliases(request.category).some(alias => joined.includes(normalized(alias)))
    : false
  const keywordsMatch = keywords.length ? keywords.every(keyword => joined.includes(keyword)) : false
  return categoryMatch || keywordsMatch
}

function matchesBudget(place: Place, budget: RecommendationRequest['budget']): boolean {
  if (!budget || budget.min === undefined && budget.max === undefined) return true
  if (!finite(place.averageCost) || place.averageCost < 0) return false
  return (budget.min === undefined || place.averageCost >= budget.min)
    && (budget.max === undefined || place.averageCost <= budget.max)
}

function searchKeywords(request: RecommendationRequest): string {
  if (request.random) return '餐饮服务'
  if (text(request.keywords)) return text(request.keywords)
  return findRestaurantCategory(request.category)?.searchKeyword ?? text(request.category)
}

function withRouteTimes(
  candidates: RecommendationCandidate[],
  times: Array<number | undefined>,
  maxMinutes: number | undefined,
): RecommendationCandidate[] {
  return candidates.flatMap((candidate, index) => {
    const travelMinutes = times[index]
    if (travelMinutes !== undefined && maxMinutes !== undefined && travelMinutes > maxMinutes) return []
    return [{
      ...candidate,
      ...(travelMinutes === undefined ? {} : { travelMinutes }),
    }]
  })
}

export function createRecommendHandler(deps: {
  searchClient: RecommendationSearchClient
  routeClient: RouteTimesClient
}) {
  return async (request: RecommendationRequest): Promise<RecommendationResult> => {
    validate(request)
    const searchResult = await deps.searchClient.search({
      keywords: searchKeywords(request),
      center: request.center,
      city: '',
      radiusMeters: request.radiusMeters,
    })
    const candidates = searchResult.items
      .map(place => ({ place, distanceMeters: distanceMeters(request.center, place.location) }))
      .filter(candidate => candidate.distanceMeters <= request.radiusMeters
        && matchesPreference(candidate.place, request)
        && matchesBudget(candidate.place, request.budget))

    const preRanked = rankRecommendations(candidates, request).slice(0, 20)
    const routeCandidates: RecommendationCandidate[] = preRanked.map(item => ({
      place: item.place,
      distanceMeters: item.distanceMeters,
    }))
    let routed = routeCandidates
    if (routeCandidates.length > 0) {
      try {
        const times = await deps.routeClient.times(
          request.center,
          routeCandidates.map(candidate => candidate.place.location),
          request.travelMode,
        )
        routed = withRouteTimes(routeCandidates, times, request.maxMinutes)
      } catch {
        routed = routeCandidates
      }
    }

    const items = rankRecommendations(routed, request).slice(0, 10).map(item => ({
      ...item,
      travelTimeUnavailable: item.travelMinutes === undefined,
    }))
    return {
      items,
      stale: searchResult.stale,
      sourceUpdatedAt: searchResult.sourceUpdatedAt,
    }
  }
}

export function createLazyRouteTimesClient(
  createClient: () => RouteTimesClient,
): RouteTimesClient {
  return {
    times(origin, destinations, mode) {
      return Promise.resolve().then(() => createClient()).then(client => client.times(origin, destinations, mode))
    },
  }
}

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  init(options: { env: unknown }): {
    database(): CloudBaseCacheDatabase & CloudBaseRouteRateLimitDatabase & PublicPlacesDatabase
  }
}

export function main(
  event: RecommendationRequest,
  _context: unknown,
  injected?: unknown,
) {
  const sdk = selectCloudBaseSdk<CloudBaseSdk>(injected)
  validate(event)
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV })
  const database = app.database()
  const searchService = createPlaceSearchService({
    client: createAmapClient(),
    cache: createCloudBaseSearchCache(database),
    places: createCloudBasePublicPlaceStore(database),
  })
  return createRecommendHandler({
    searchClient: { search: query => searchService.searchPlaces(query) },
    routeClient: createLazyRouteTimesClient(() => createAmapRoutesClient({
      limiter: createCloudBaseRouteRateLimiter(database),
    })),
  })(event)
}
