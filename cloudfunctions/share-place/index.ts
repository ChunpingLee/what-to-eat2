import type { Place } from '../../src/domain/favorites'

export interface SharePayload {
  v: 1
  poiId: string
}

export interface PublicPlaceRepository {
  findPublicByPoiId(poiId: string): Promise<unknown>
}

interface CloudBaseCollection {
  where(query: { poiId: string }): CloudBaseCollection
  limit(count: number): CloudBaseCollection
  get(): Promise<{ data: unknown[] }>
}

interface CloudBaseDatabase {
  collection(name: 'places'): CloudBaseCollection
}

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  init(options: { env: unknown }): { database(): CloudBaseDatabase }
}

const MAX_POI_ID_LENGTH = 128

function validPoiId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_POI_ID_LENGTH
}

/** Builds the complete data payload allowed to leave one user's private list. */
export function createSharePayload(input: { poiId: string }): SharePayload {
  if (!validPoiId(input?.poiId)) throw new Error('INVALID_SHARE_PAYLOAD')
  return { v: 1, poiId: input.poiId.trim() }
}

function optionalText(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalTextArray(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

/** Explicit projection prevents future private/cache fields from leaking in a share response. */
function publicPlace(value: unknown): Place | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const location = record.location
  if (!validPoiId(record.poiId) || typeof record.name !== 'string'
    || typeof location !== 'object' || location === null || Array.isArray(location)) return undefined
  const point = location as Record<string, unknown>
  if (typeof point.latitude !== 'number' || !Number.isFinite(point.latitude)
    || typeof point.longitude !== 'number' || !Number.isFinite(point.longitude)) return undefined

  const projected: Place = {
    poiId: record.poiId.trim(),
    name: record.name,
    location: { latitude: point.latitude, longitude: point.longitude },
  }
  const address = optionalText(record, 'address')
  const businessArea = optionalText(record, 'businessArea')
  const categories = optionalTextArray(record, 'categories')
  const rating = optionalNumber(record, 'rating')
  const averageCost = optionalNumber(record, 'averageCost')
  const tags = optionalTextArray(record, 'tags')
  const photos = optionalTextArray(record, 'photos')
  const businessStatus = optionalText(record, 'businessStatus')
  return {
    ...projected,
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

export function createCloudBasePublicPlaceRepository(database: CloudBaseDatabase): PublicPlaceRepository {
  return {
    async findPublicByPoiId(poiId) {
      const result = await database.collection('places').where({ poiId }).limit(1).get()
      return result.data[0]
    },
  }
}

export function createSharePlaceHandler(deps: { repo: PublicPlaceRepository }) {
  return async (event: SharePayload) => {
    if (event?.v !== 1 || !validPoiId(event.poiId)) throw new Error('INVALID_SHARE_PAYLOAD')
    const place = publicPlace(await deps.repo.findPublicByPoiId(event.poiId.trim()))
    if (!place) throw new Error('PLACE_NOT_FOUND')
    return { place }
  }
}

export function main(
  event: SharePayload,
  _context: unknown,
  sdk: CloudBaseSdk = require('@cloudbase/node-sdk') as CloudBaseSdk,
) {
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV })
  return createSharePlaceHandler({ repo: createCloudBasePublicPlaceRepository(app.database()) })(event)
}
