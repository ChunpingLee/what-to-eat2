import type { Place } from '../../src/domain/favorites'
import { SafeError } from '../../src/shared/errors'
import type { GeoPoint } from '../../src/shared/types'

export interface PlaceSearchQuery {
  keywords: string
  center: GeoPoint
  city: string
  radiusMeters: number
}

export interface AmapPoi {
  id: string
  name: string
  location: string
  address?: string
  business_area?: string
  type?: string
  tag?: string
  photos?: Array<{ url?: string }>
  business_status?: string
  biz_ext?: { rating?: string | number; cost?: string | number; business_status?: string } | unknown[]
}

export interface AmapResponse { pois?: AmapPoi[] }
export interface AmapHttpQuery { key: string; keywords: string; location: string; city: string; radius: number }
export type AmapHttp = (query: AmapHttpQuery) => Promise<AmapResponse>

export interface PlaceSearchClient { search(query: PlaceSearchQuery): Promise<Place[]> }

export class AmapTimeoutError extends SafeError {
  constructor() { super('AMAP_TIMEOUT', 'Place search timed out') }
}

function trimmed(value: string | undefined) {
  const result = value?.trim()
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

function split(value: string | undefined) {
  const items = value?.split(';').map(item => item.trim()).filter(Boolean)
  return items && items.length > 0 ? items : undefined
}

function mapPoi(poi: AmapPoi): Place | undefined {
  const [longitudeText, latitudeText] = poi.location.split(',')
  const longitude = Number(longitudeText)
  const latitude = Number(latitudeText)
  if (!poi.id || !poi.name || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined

  const bizExt = Array.isArray(poi.biz_ext) ? undefined : poi.biz_ext
  const photos = poi.photos?.flatMap(photo => {
    const url = trimmed(photo.url)
    return url ? [url] : []
  })
  return {
    poiId: poi.id,
    name: poi.name,
    location: { latitude, longitude },
    address: poi.address ?? '',
    businessArea: trimmed(poi.business_area),
    categories: split(poi.type) ?? [],
    rating: numeric(bizExt?.rating),
    averageCost: numeric(bizExt?.cost),
    tags: split(poi.tag),
    photos: photos && photos.length > 0 ? photos : undefined,
    businessStatus: trimmed(bizExt?.business_status) ?? trimmed(poi.business_status),
  }
}

async function fetchAmap(query: AmapHttpQuery): Promise<AmapResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const params = new URLSearchParams({
      key: query.key,
      keywords: query.keywords,
      location: query.location,
      city: query.city,
      radius: String(query.radius),
    })
    const response = await fetch(`https://restapi.amap.com/v5/place/text?${params}`, { signal: controller.signal })
    if (!response.ok) throw new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable')
    return await response.json() as AmapResponse
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new AmapTimeoutError()
    if (error instanceof SafeError) throw error
    throw new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable')
  } finally {
    clearTimeout(timer)
  }
}

export function createAmapClient({ key = process.env.AMAP_WEB_KEY, http = fetchAmap }: { key?: string; http?: AmapHttp } = {}): PlaceSearchClient {
  if (!key) throw new SafeError('AMAP_NOT_CONFIGURED', 'Place search is not configured')
  return {
    async search(query) {
      const response = await http({
        key,
        keywords: query.keywords.trim(),
        location: `${query.center.longitude},${query.center.latitude}`,
        city: query.city.trim(),
        radius: query.radiusMeters,
      })
      return (response.pois ?? []).flatMap(poi => {
        const mapped = mapPoi(poi)
        return mapped ? [mapped] : []
      })
    },
  }
}
