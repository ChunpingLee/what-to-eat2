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

function normalizeText(value: string) { return value.trim().toLocaleLowerCase('zh-CN') }

export function cacheKeyFor(query: PlaceSearchQuery) {
  const normalized = JSON.stringify({
    keywords: normalizeText(query.keywords),
    latitude: query.center.latitude,
    longitude: query.center.longitude,
    city: normalizeText(query.city),
    radiusMeters: query.radiusMeters,
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
  if (!query.keywords.trim() || !Number.isFinite(query.center.latitude) || !Number.isFinite(query.center.longitude)
    || !Number.isFinite(query.radiusMeters) || query.radiusMeters <= 0) {
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
      const cached = await deps.cache.get(key)
      const currentTime = now()
      if (cached && currentTime - cached.cachedAt <= FRESH_CACHE_TTL_MS) {
        await persistPlaces(cached.result)
        return { ...cached.result, stale: false }
      }

      try {
        const items = await deps.client.search({
          ...query,
          keywords: query.keywords.trim(),
          city: query.city.trim(),
        })
        const result = { items, sourceUpdatedAt: new Date(currentTime).toISOString() }
        await deps.cache.set({ key, cachedAt: currentTime, result })
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
  doc(key: string): { get(): Promise<{ data: CachedPlaceSearch[] }>; set(options: { data: CachedPlaceSearch }): Promise<unknown> }
}

export interface CloudBaseCacheDatabase { collection(name: 'place_search_cache'): CloudBaseCacheCollection }

export function createCloudBaseSearchCache(database: CloudBaseCacheDatabase): PlaceSearchCache {
  const collection = database.collection('place_search_cache')
  return {
    async get(key) {
      const result = await collection.doc(key).get()
      return result.data[0]
    },
    async set(entry) { await collection.doc(entry.key).set({ data: entry }) },
  }
}
