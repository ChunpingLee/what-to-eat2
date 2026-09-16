import { createHash } from 'node:crypto'
import type { Place } from '../../src/domain/favorites'
import { SafeError, safePlaceSearchError } from '../../src/shared/errors'
import type { PlaceSearchClient, PlaceSearchQuery } from './amap-client'
import type { PublicPlaceStore } from '../shared/public-places'

export interface PlaceSearchResult { items: Place[]; sourceUpdatedAt: string; stale: boolean }
export interface CachedPlaceSearch { key: string; cachedAt: number; result: Omit<PlaceSearchResult, 'stale'> }
export interface PlaceSearchCache {
  get(key: string): Promise<CachedPlaceSearch | undefined>
  set(entry: CachedPlaceSearch): Promise<void>
}

export const FRESH_CACHE_TTL_MS = 30 * 60 * 1_000
export const STALE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000
type PlaceSearchDiagnosticStage = 'CACHE_READ' | 'AMAP_SEARCH' | 'CACHE_WRITE'

async function atStage<T>(stage: PlaceSearchDiagnosticStage, task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    const safe = error instanceof SafeError
      ? error as SafeError & { diagnosticStage?: PlaceSearchDiagnosticStage }
      : Object.assign(new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable'), {
        diagnosticStage: stage,
      })
    safe.diagnosticStage = stage
    throw safe
  }
}

function normalizeText(value: string) { return value.trim().toLocaleLowerCase('zh-CN') }

export function cacheKeyFor(query: PlaceSearchQuery) {
  const normalized = JSON.stringify({
    keywords: normalizeText(query.keywords),
    latitude: query.center.latitude,
    longitude: query.center.longitude,
    city: normalizeText(query.city),
    radiusMeters: query.radiusMeters,
    types: query.types ? normalizeText(query.types) : '',
    // 仅翻页请求单独缓存；page 1/缺省保持与旧 key 完全一致，兼容既有缓存条目。
    ...(query.page !== undefined && query.page > 1 ? { page: query.page } : {}),
  })
  return createHash('sha256').update(normalized).digest('hex')
}

export function createMemorySearchCache(): PlaceSearchCache & { keyFor(query: PlaceSearchQuery): string } {
  const entries = new Map<string, CachedPlaceSearch>()
  return {
    keyFor: cacheKeyFor,
    async get(key) { return entries.get(key) },
    async set(entry) { entries.set(entry.key, entry) },
  }
}

function validate(query: PlaceSearchQuery) {
  if (!query || typeof query !== 'object'
    || typeof query.keywords !== 'string'
    || (query.types !== undefined && (typeof query.types !== 'string' || !query.types.trim()))
    || (!query.keywords.trim() && !(typeof query.types === 'string' && query.types.trim()))
    || typeof query.city !== 'string'
    || !query.center || typeof query.center !== 'object'
    || !Number.isFinite(query.center.latitude) || query.center.latitude < -90 || query.center.latitude > 90
    || !Number.isFinite(query.center.longitude) || query.center.longitude < -180 || query.center.longitude > 180
    || !Number.isFinite(query.radiusMeters) || query.radiusMeters <= 0 || query.radiusMeters > 50_000
    || (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1 || query.page > 100))) {
    throw new SafeError('INVALID_SEARCH_QUERY', 'Invalid place search query')
  }
}

export interface PlacePersistenceWarning { code: 'PUBLIC_PLACE_PERSIST_FAILED'; failedCount: number }

export function createPlaceSearchService(deps: {
  client: PlaceSearchClient
  cache: PlaceSearchCache
  places?: Pick<PublicPlaceStore, 'upsertMany'>
  onPlacePersistenceWarning?(warning: PlacePersistenceWarning): void
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  const persistPlaces = async (result: Omit<PlaceSearchResult, 'stale'>) => {
    if (!deps.places) return
    try {
      await deps.places.upsertMany(result.items, result.sourceUpdatedAt)
    } catch (error) {
      const failedCount = typeof error === 'object' && error !== null && 'failedCount' in error
        && typeof (error as { failedCount?: unknown }).failedCount === 'number'
        ? (error as { failedCount: number }).failedCount
        : result.items.length
      const warning = { code: 'PUBLIC_PLACE_PERSIST_FAILED' as const, failedCount }
      if (deps.onPlacePersistenceWarning) deps.onPlacePersistenceWarning(warning)
      else console.error(warning)
    }
  }
  return {
    async searchPlaces(query: PlaceSearchQuery): Promise<PlaceSearchResult> {
      validate(query)
      const key = cacheKeyFor(query)
      const cached = await atStage('CACHE_READ', () => deps.cache.get(key))
      const currentTime = now()
      if (cached && currentTime - cached.cachedAt <= FRESH_CACHE_TTL_MS) {
        await persistPlaces(cached.result)
        return { ...cached.result, stale: false }
      }

      try {
        const items = await atStage('AMAP_SEARCH', () => deps.client.search({
          ...query,
          keywords: query.keywords.trim(),
          city: query.city.trim(),
        }))
        const result = { items, sourceUpdatedAt: new Date(currentTime).toISOString() }
        await atStage('CACHE_WRITE', () => deps.cache.set({ key, cachedAt: currentTime, result }))
        await persistPlaces(result)
        return { ...result, stale: false }
      } catch (error) {
        if (error instanceof SafeError && error.code === 'AMAP_TIMEOUT'
          && cached && currentTime - cached.cachedAt <= STALE_CACHE_MAX_AGE_MS) {
          await persistPlaces(cached.result)
          return { ...cached.result, stale: true }
        }
        throw safePlaceSearchError(error)
      }
    },
  }
}

interface CloudBaseCacheCollection {
  doc(key: string): { get(): Promise<{ data: unknown }>; set(documentBody: CachedPlaceSearch): Promise<unknown> }
}

export interface CloudBaseCacheDatabase { collection(name: 'place_search_cache'): CloudBaseCacheCollection }

function cachedSearchFromDocument(data: unknown): CachedPlaceSearch | undefined {
  const first = Array.isArray(data) ? data[0] : data
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return undefined
  const record = first as Record<string, unknown>
  const candidate = typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record
  if (typeof candidate.key !== 'string' || !Number.isFinite(candidate.cachedAt)
    || typeof candidate.result !== 'object' || candidate.result === null || Array.isArray(candidate.result)) return undefined
  const result = candidate.result as Record<string, unknown>
  if (!Array.isArray(result.items) || typeof result.sourceUpdatedAt !== 'string') return undefined
  return candidate as unknown as CachedPlaceSearch
}

export function createCloudBaseSearchCache(database: CloudBaseCacheDatabase): PlaceSearchCache {
  const collection = database.collection('place_search_cache')
  return {
    async get(key) {
      const result = await collection.doc(key).get()
      return cachedSearchFromDocument(result.data)
    },
    async set(entry) { await collection.doc(entry.key).set(entry) },
  }
}
