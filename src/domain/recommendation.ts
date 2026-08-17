import type { Place } from './favorites'
import { recommendationReasons, type RecommendationSignal } from './recommendation-reasons'
import type { GeoPoint, TravelMode } from '../shared/types'

export interface RecommendationRequest {
  category?: string
  keywords?: string
  random?: boolean
  center: GeoPoint
  radiusMeters: number
  travelMode: TravelMode
  maxMinutes?: number
  budget?: { min?: number; max?: number }
}

export interface RecommendationCandidate {
  place: Place
  distanceMeters: number
  travelMinutes?: number
}

export interface RankedPlace {
  place: Place
  distanceMeters: number
  travelMinutes?: number
  score: number
  reasons: string[]
}

const WEIGHTS = {
  preference: 35,
  proximity: 30,
  rating: 20,
  budget: 10,
  completeness: 5,
} as const

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const normalized = (value: string) => value.trim().toLocaleLowerCase('zh-CN')
const nonEmpty = (value: string | undefined): value is string => Boolean(value?.trim())
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const presentStrings = (values: string[] | undefined) => values?.filter(nonEmpty).map(normalized) ?? []
const optionalNormalized = (value: string | undefined) => value === undefined ? undefined : normalized(value) || undefined

function preferenceSignal(candidate: RecommendationCandidate, request: RecommendationRequest): RecommendationSignal | undefined {
  if (request.random) return undefined
  const category = optionalNormalized(request.category)
  const keywords = [...new Set(request.keywords?.split(/[\s,，、/]+/).map(normalized).filter(Boolean) ?? [])]
  if (!category && keywords.length === 0) return undefined

  const searchable = [...presentStrings(candidate.place.categories), ...presentStrings(candidate.place.tags), normalized(candidate.place.name)]
  if (searchable.length === 0) return undefined
  const joined = searchable.join(' ')
  const categoryScore = category === undefined ? undefined : searchable.includes(category) ? 1 : joined.includes(category) ? 0.8 : 0
  const keywordMatches = keywords.map(keyword => ({ keyword, exact: searchable.includes(keyword), substring: joined.includes(keyword) }))
  const keywordScore = keywords.length === 0 ? undefined
    : keywordMatches.every(match => match.exact) ? 1
      : keywordMatches.every(match => match.substring) ? 0.8
        : keywordMatches.filter(match => match.substring).length / keywordMatches.length * 0.8
  const rawScore = Math.max(categoryScore ?? 0, keywordScore ?? 0)
  const actual = categoryScore !== undefined && categoryScore >= (keywordScore ?? 0)
    ? request.category as string
    : request.keywords as string
  return { key: 'preference', rawScore, weight: WEIGHTS.preference, actual }
}

function proximitySignal(candidate: RecommendationCandidate, request: RecommendationRequest): RecommendationSignal | undefined {
  if (finite(request.maxMinutes) && request.maxMinutes > 0 && finite(candidate.travelMinutes) && candidate.travelMinutes >= 0) {
    return {
      key: 'travelTime', rawScore: clamp(1 - candidate.travelMinutes / request.maxMinutes),
      weight: WEIGHTS.proximity, actual: candidate.travelMinutes,
    }
  }
  if (!finite(candidate.distanceMeters) || candidate.distanceMeters < 0) return undefined
  return {
    key: 'distance', rawScore: clamp(1 - candidate.distanceMeters / request.radiusMeters),
    weight: WEIGHTS.proximity, actual: candidate.distanceMeters,
  }
}

function ratingSignal(place: Place): RecommendationSignal | undefined {
  if (!finite(place.rating) || place.rating < 0 || place.rating > 5) return undefined
  return { key: 'rating', rawScore: clamp(place.rating / 5), weight: WEIGHTS.rating, actual: place.rating }
}

function budgetSignal(place: Place, budget: RecommendationRequest['budget']): RecommendationSignal | undefined {
  if (!finite(place.averageCost) || place.averageCost < 0 || !budget) return undefined
  const min = finite(budget.min) && budget.min >= 0 ? budget.min : undefined
  const max = finite(budget.max) && budget.max >= 0 ? budget.max : undefined
  if (min === undefined && max === undefined || min !== undefined && max !== undefined && min > max) return undefined

  const inside = (min === undefined || place.averageCost >= min) && (max === undefined || place.averageCost <= max)
  if (inside) return { key: 'budget', rawScore: 1, weight: WEIGHTS.budget, actual: place.averageCost }

  const difference = min !== undefined && place.averageCost < min ? min - place.averageCost : place.averageCost - (max as number)
  const referenceSpan = min !== undefined && max !== undefined
    ? Math.max(max - min, 1)
    : Math.max(min ?? max ?? 0, 1)
  return { key: 'budget', rawScore: clamp(1 - difference / referenceSpan), weight: WEIGHTS.budget, actual: place.averageCost }
}

function completenessSignal(place: Place): RecommendationSignal | undefined {
  const fields = [
    nonEmpty(place.address),
    presentStrings(place.categories).length > 0,
    finite(place.rating),
    finite(place.averageCost),
    presentStrings(place.tags).length > 0,
    presentStrings(place.photos).length > 0,
  ]
  const present = fields.filter(Boolean).length
  return present === 0 ? undefined : {
    key: 'completeness', rawScore: present / fields.length, weight: WEIGHTS.completeness, actual: present,
  }
}

function score(signals: RecommendationSignal[]): number {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0)
  if (totalWeight === 0) return 0
  const weighted = signals.reduce((sum, signal) => sum + signal.rawScore * signal.weight, 0) / totalWeight * 100
  return Math.round(weighted * 100) / 100
}

function comparableRating(place: Place): number {
  return finite(place.rating) && place.rating >= 0 && place.rating <= 5 ? place.rating : -1
}

function validateCandidate(candidate: RecommendationCandidate): void {
  if (!finite(candidate.distanceMeters) || candidate.distanceMeters < 0) {
    throw new RangeError(`Invalid candidate distanceMeters for ${candidate.place.poiId}`)
  }
  if (candidate.travelMinutes !== undefined && (!finite(candidate.travelMinutes) || candidate.travelMinutes < 0)) {
    throw new RangeError(`Invalid candidate travelMinutes for ${candidate.place.poiId}`)
  }
}

export function rankRecommendations(candidates: RecommendationCandidate[], request: RecommendationRequest): RankedPlace[] {
  if (!finite(request.radiusMeters) || request.radiusMeters <= 0) throw new RangeError('radiusMeters must be greater than 0')
  candidates.forEach(validateCandidate)

  return candidates.map(candidate => {
    const signals = [
      preferenceSignal(candidate, request),
      proximitySignal(candidate, request),
      ratingSignal(candidate.place),
      budgetSignal(candidate.place, request.budget),
      completenessSignal(candidate.place),
    ].filter((signal): signal is RecommendationSignal => signal !== undefined)
    return {
      place: candidate.place,
      distanceMeters: candidate.distanceMeters,
      ...(candidate.travelMinutes === undefined ? {} : { travelMinutes: candidate.travelMinutes }),
      score: score(signals),
      reasons: recommendationReasons(signals),
    }
  }).sort((a, b) => b.score - a.score
    || a.distanceMeters - b.distanceMeters
    || comparableRating(b.place) - comparableRating(a.place)
    || a.place.poiId.localeCompare(b.place.poiId))
}
