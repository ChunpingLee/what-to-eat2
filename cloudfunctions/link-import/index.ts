import type { Place } from '../../src/domain/favorites'
import type { GeoPoint } from '../../src/shared/types'
import { createAmapClient } from '../place-search/amap-client'
import { createCloudBaseSearchCache, createPlaceSearchService, type CloudBaseCacheDatabase } from '../place-search/cache'
import { selectCloudBaseSdk } from '../shared/cloudbase-sdk'
import { parseAmapPage } from './parsers/amap'
import { parseDianpingPage } from './parsers/dianping'
import { parseMeituanPage } from './parsers/meituan'
import type { PlaceHint } from './parsers/shared'
import { createCloudBasePublicPlaceStore, type PublicPlacesDatabase } from '../shared/public-places'
import {
  LinkImportError,
  fetchAllowedPage,
  parseAllowedUrl,
  platformForUrl,
  unavailableLink,
  type FetchedPage,
} from './url-policy'

export type ImportResult =
  | { status: 'matched'; candidates: Place[] }
  | { status: 'search'; keywords: string }
  | { status: 'manual' }

export interface LinkImporterDependencies {
  fetchPage(url: string): Promise<FetchedPage>
  matchPlaces(hint: PlaceHint): Promise<Place[]>
}

function parserFor(url: string): (html: string) => PlaceHint | undefined {
  const platform = platformForUrl(url)
  if (platform === 'meituan') return parseMeituanPage
  if (platform === 'dianping') return parseDianpingPage
  return parseAmapPage
}

function safeError(error: unknown): LinkImportError {
  return error instanceof LinkImportError ? error : unavailableLink()
}

export function createLinkImporter(deps: LinkImporterDependencies) {
  return async (url: string): Promise<ImportResult> => {
    parseAllowedUrl(url)
    let page: FetchedPage
    try {
      page = await deps.fetchPage(url)
    } catch (error) {
      throw safeError(error)
    }

    let hint: PlaceHint | undefined
    try {
      hint = parserFor(page.url)(page.body)
    } catch {
      return { status: 'manual' }
    }
    if (!hint?.name) return { status: 'manual' }

    try {
      const candidates = await deps.matchPlaces(hint)
      const unique = [...new Map(candidates.map(candidate => [candidate.poiId, candidate])).values()]
      if (unique.length) return { status: 'matched', candidates: unique }
    } catch {
      // A failed POI lookup still leaves a safe keyword for the existing search page.
    }
    return { status: 'search', keywords: hint.name }
  }
}

export async function importLink(url: string, deps?: LinkImporterDependencies): Promise<ImportResult> {
  return createLinkImporter(deps ?? { fetchPage: fetchAllowedPage, matchPlaces: async () => [] })(url)
}

interface LinkImportEvent {
  url?: unknown
  center?: unknown
  city?: unknown
}

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  init(options: { env: unknown }): { database(): CloudBaseCacheDatabase & PublicPlacesDatabase }
}

function centerFrom(value: unknown): GeoPoint | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const center = value as Record<string, unknown>
  return typeof center.latitude === 'number' && Number.isFinite(center.latitude)
    && typeof center.longitude === 'number' && Number.isFinite(center.longitude)
    ? { latitude: center.latitude, longitude: center.longitude }
    : undefined
}

export async function main(
  event: LinkImportEvent,
  _context: unknown,
  injected?: unknown,
): Promise<ImportResult> {
  const sdk = selectCloudBaseSdk<CloudBaseSdk>(injected)
  try {
    if (typeof event?.url !== 'string') throw unavailableLink()
    const center = centerFrom(event.center)
    const eventCity = typeof event.city === 'string' ? event.city.trim() : ''
    let service: ReturnType<typeof createPlaceSearchService> | undefined
    const matchPlaces = async (hint: PlaceHint): Promise<Place[]> => {
      const city = hint.city?.trim() || eventCity
      if (!center || !city) return []
      if (!service) {
        const cloudbase = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV })
        const database = cloudbase.database()
        service = createPlaceSearchService({
          client: createAmapClient(),
          cache: createCloudBaseSearchCache(database),
          places: createCloudBasePublicPlaceStore(database),
        })
      }
      return (await service.searchPlaces({ keywords: hint.name, city, center, radiusMeters: 5_000 })).items
    }
    return await createLinkImporter({ fetchPage: fetchAllowedPage, matchPlaces })(event.url)
  } catch (error) {
    throw safeError(error)
  }
}
