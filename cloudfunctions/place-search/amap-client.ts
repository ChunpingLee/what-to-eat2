import type { Place } from '../../src/domain/favorites'
import { SafeError } from '../../src/shared/errors'
import type { GeoPoint } from '../../src/shared/types'
import { createHttpsJsonFetch } from '../shared/https-json'

export interface PlaceSearchQuery {
  keywords: string
  center: GeoPoint
  city: string
  radiusMeters: number
}

export interface AmapResponse { status?: unknown; pois?: unknown; info?: unknown; infocode?: unknown }
export interface AmapHttpQuery {
  key: string
  keywords: string
  location: string
  radius: number
  region?: string
  cityLimit: boolean
  showFields: string
  pageSize?: number
}
export type AmapHttp = (query: AmapHttpQuery) => Promise<AmapResponse>

export interface PlaceSearchClient { search(query: PlaceSearchQuery): Promise<Place[]> }
export type AmapDiagnostic =
  | { event: 'AMAP_API_REJECTED'; status?: string; infocode?: string }
  | { event: 'AMAP_HTTP_FAILED'; errorName: string; errorCode?: string; source?: string }

export class AmapTimeoutError extends SafeError {
  constructor() { super('AMAP_TIMEOUT', 'Place search timed out') }
}

function trimmed(value: unknown) {
  const result = typeof value === 'string' ? value.trim() : undefined
  return result || undefined
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function split(value: unknown) {
  const text = trimmed(value)
  const items = text?.split(';').map(item => item.trim()).filter(Boolean)
  return items && items.length > 0 ? items : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function mapPoi(value: unknown): Place | undefined {
  const poi = record(value)
  const location = trimmed(poi?.location)
  const id = trimmed(poi?.id)
  const name = trimmed(poi?.name)
  if (!poi || !location || !id || !name) return undefined
  const [longitudeText, latitudeText] = location.split(',')
  const longitude = Number(longitudeText)
  const latitude = Number(latitudeText)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined

  const business = record(poi.business)
  const photos = Array.isArray(poi.photos) ? poi.photos.flatMap(photo => {
    const url = trimmed(record(photo)?.url)
    return url ? [url] : []
  }) : undefined
  const address = trimmed(poi.address)
  const categories = split(poi.type)
  const businessArea = trimmed(business?.business_area)
  const rating = numeric(business?.rating)
  const averageCost = numeric(business?.cost)
  const tags = split(business?.tag)
  const businessStatus = trimmed(business?.business_status) ?? trimmed(poi.business_status)
  return {
    poiId: id,
    name,
    location: { latitude, longitude },
    ...(address ? { address } : {}),
    ...(categories ? { categories } : {}),
    ...(businessArea ? { businessArea } : {}),
    ...(rating === undefined ? {} : { rating }),
    ...(averageCost === undefined ? {} : { averageCost }),
    ...(tags ? { tags } : {}),
    ...(photos && photos.length > 0 ? { photos } : {}),
    ...(businessStatus ? { businessStatus } : {}),
  }
}

type FetchLike = (input: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export function createAmapHttp(
  fetcher: FetchLike = createHttpsJsonFetch(),
  diagnostic: (value: AmapDiagnostic) => void = value => console.error(value),
): AmapHttp {
  return async query => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const params = new URLSearchParams({
        key: query.key,
        keywords: query.keywords,
        location: query.location,
        radius: String(query.radius),
        show_fields: query.showFields,
      })
      if (query.region) {
        params.set('region', query.region)
        params.set('city_limit', String(query.cityLimit))
      }
      if (query.pageSize !== undefined) params.set('page_size', String(query.pageSize))
      const response = await fetcher(`https://restapi.amap.com/v5/place/around?${params}`, { signal: controller.signal })
      if (!response.ok) throw new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable')
      return await response.json() as AmapResponse
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new AmapTimeoutError()
      if (error instanceof SafeError) throw error
      const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined
      const source = error instanceof Error
        ? error.stack?.match(/\/var\/user\/[^?():\s]+:\d+:\d+/)?.[0]
        : undefined
      diagnostic({
        event: 'AMAP_HTTP_FAILED',
        errorName: error instanceof Error ? error.name.slice(0, 64) : typeof error,
        ...(typeof record?.code === 'string' ? { errorCode: record.code.slice(0, 64) } : {}),
        ...(source ? { source } : {}),
      })
      throw new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable')
    } finally {
      clearTimeout(timer)
    }
  }
}

export function createAmapClient({
  key = process.env.AMAP_WEB_KEY,
  http = createAmapHttp(),
  diagnostic = value => console.error(value),
}: { key?: string; http?: AmapHttp; diagnostic?: (value: AmapDiagnostic) => void } = {}): PlaceSearchClient {
  if (!key) throw new SafeError('AMAP_NOT_CONFIGURED', 'Place search is not configured')
  return {
    async search(query) {
      const response = await http({
        key,
        keywords: query.keywords.trim(),
        location: `${query.center.longitude},${query.center.latitude}`,
        radius: query.radiusMeters,
        ...(query.city.trim() ? { region: query.city.trim() } : {}),
        cityLimit: Boolean(query.city.trim()),
        showFields: 'business,photos',
        pageSize: 25,
      })
      if (response.status !== '1' || !Array.isArray(response.pois)) {
        diagnostic({
          event: 'AMAP_API_REJECTED',
          ...(typeof response.status === 'string' ? { status: response.status.slice(0, 16) } : {}),
          ...(typeof response.infocode === 'string' ? { infocode: response.infocode.slice(0, 32) } : {}),
        })
        throw new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable')
      }
      return response.pois.flatMap(poi => {
        const mapped = mapPoi(poi)
        return mapped ? [mapped] : []
      })
    },
  }
}
