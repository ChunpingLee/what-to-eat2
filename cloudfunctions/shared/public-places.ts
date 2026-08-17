import { createHash } from 'node:crypto'
import type { Place } from '../../src/domain/favorites'

export interface PublicPlaceDocument extends Place { sourceUpdatedAt: string }

interface PublicPlaceDocumentReference {
  get(): Promise<{ data: unknown[] }>
  set(options: { data: PublicPlaceDocument }): Promise<unknown>
}

interface PublicPlaceCollection {
  doc(id: string): PublicPlaceDocumentReference
  where(query: { poiId: string }): {
    limit(count: number): { get(): Promise<{ data: unknown[] }> }
  }
}

export interface PublicPlacesDatabase {
  collection(name: 'places'): PublicPlaceCollection
}

export interface PublicPlaceStore {
  upsertMany(items: Place[], sourceUpdatedAt: string): Promise<void>
  findPublicByPoiId(poiId: string): Promise<unknown>
}

export class PublicPlacePersistenceError extends Error {
  readonly code = 'PUBLIC_PLACE_PERSIST_FAILED'
  constructor(readonly failedCount: number) {
    super('PUBLIC_PLACE_PERSIST_FAILED')
    this.name = 'PublicPlacePersistenceError'
  }
}

export function publicPlaceDocumentId(poiId: string) {
  return createHash('sha256').update(poiId).digest('hex')
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

export function normalizedPublicPlace(value: unknown): Place | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const poiId = text(record.poiId)
  const name = text(record.name)
  const location = record.location
  if (!poiId || !name || typeof location !== 'object' || location === null || Array.isArray(location)) return undefined
  const point = location as Record<string, unknown>
  const latitude = number(point.latitude)
  const longitude = number(point.longitude)
  if (latitude === undefined || longitude === undefined) return undefined
  const address = text(record.address)
  const businessArea = text(record.businessArea)
  const categories = textArray(record.categories)
  const rating = number(record.rating)
  const averageCost = number(record.averageCost)
  const tags = textArray(record.tags)
  const photos = textArray(record.photos)
  const businessStatus = text(record.businessStatus)
  return {
    poiId, name, location: { latitude, longitude },
    ...(address ? { address } : {}),
    ...(businessArea ? { businessArea } : {}),
    ...(categories ? { categories } : {}),
    ...(rating === undefined ? {} : { rating }),
    ...(averageCost === undefined ? {} : { averageCost }),
    ...(tags ? { tags } : {}),
    ...(photos ? { photos } : {}),
    ...(businessStatus ? { businessStatus } : {}),
  }
}

export function createCloudBasePublicPlaceStore(database: PublicPlacesDatabase): PublicPlaceStore {
  const places = database.collection('places')
  return {
    async upsertMany(items, sourceUpdatedAt) {
      const results = await Promise.allSettled(items.map(async item => {
        const place = normalizedPublicPlace(item)
        if (!place) throw new Error('INVALID_PUBLIC_PLACE')
        await places.doc(publicPlaceDocumentId(place.poiId)).set({ data: { ...place, sourceUpdatedAt } })
      }))
      const failedCount = results.filter(result => result.status === 'rejected').length
      if (failedCount) throw new PublicPlacePersistenceError(failedCount)
    },
    async findPublicByPoiId(poiId) {
      try {
        const direct = await places.doc(publicPlaceDocumentId(poiId)).get()
        if (direct.data[0]) return direct.data[0]
      } catch {
        // Compatibility fallback supports records created before deterministic IDs.
      }
      const legacy = await places.where({ poiId }).limit(1).get()
      return legacy.data[0]
    },
  }
}
