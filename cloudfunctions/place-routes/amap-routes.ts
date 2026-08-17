import type { GeoPoint, TravelMode } from '../../src/shared/types'

export interface RouteTimesClient {
  times(origin: GeoPoint, destinations: GeoPoint[], mode: TravelMode): Promise<Array<number | undefined>>
}

export interface AmapRouteHttpQuery {
  key: string
  origin: string
  destination: string
  mode: TravelMode
}

export type AmapRouteHttp = (query: AmapRouteHttpQuery) => Promise<unknown>

export class AmapRoutesError extends Error {
  readonly code: 'AMAP_ROUTES_NOT_CONFIGURED' | 'AMAP_ROUTES_UNAVAILABLE'

  constructor(code: AmapRoutesError['code'], message: string) {
    super(message)
    this.name = 'AmapRoutesError'
    this.code = code
  }
}

type FetchLike = (input: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

const endpointByMode: Record<TravelMode, string> = {
  walking: '/v5/direction/walking',
  bicycling: '/v5/direction/bicycling',
  driving: '/v5/direction/driving',
}

function coordinate(point: GeoPoint): string {
  return `${point.longitude},${point.latitude}`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? record(value[0]) : undefined
}

function durationSeconds(response: unknown): number | undefined {
  const body = record(response)
  if (body?.status !== '1') return undefined
  const path = firstRecord(record(body.route)?.paths)
  const raw = record(path?.cost)?.duration
  const duration = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined
}

export function createAmapRouteHttp(fetcher: FetchLike = fetch): AmapRouteHttp {
  return async query => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const params = new URLSearchParams({
        key: query.key,
        origin: query.origin,
        destination: query.destination,
        show_fields: 'cost',
      })
      const response = await fetcher(`https://restapi.amap.com${endpointByMode[query.mode]}?${params}`, {
        signal: controller.signal,
      })
      if (!response.ok) throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
      return await response.json()
    } catch (error) {
      if (error instanceof AmapRoutesError) throw error
      throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
    } finally {
      clearTimeout(timer)
    }
  }
}

function validPoint(point: GeoPoint): boolean {
  return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
    && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180
}

export function createAmapRoutesClient({
  key = process.env.AMAP_WEB_KEY,
  http = createAmapRouteHttp(),
}: { key?: string; http?: AmapRouteHttp } = {}): RouteTimesClient {
  if (!key) throw new AmapRoutesError('AMAP_ROUTES_NOT_CONFIGURED', '路线服务未配置')
  return {
    async times(origin, destinations, mode) {
      if (!validPoint(origin) || destinations.length > 20 || destinations.some(point => !validPoint(point))) {
        throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
      }
      if (destinations.length === 0) return []
      const settled = await Promise.allSettled(destinations.map(async destination => {
        const response = await http({
          key,
          origin: coordinate(origin),
          destination: coordinate(destination),
          mode,
        })
        const seconds = durationSeconds(response)
        if (seconds === undefined) throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
        return Math.ceil(seconds / 60)
      }))
      const result = settled.map(item => item.status === 'fulfilled' ? item.value : undefined)
      if (result.every(item => item === undefined)) {
        throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
      }
      return result
    },
  }
}
