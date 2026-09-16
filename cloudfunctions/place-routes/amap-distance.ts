import { SafeError } from '../../src/shared/errors'
import type { GeoPoint } from '../../src/shared/types'
import { createHttpsJsonFetch } from '../shared/https-json'

/**
 * 高德距离测量（/v3/distance）：一次调用最多 100 个起点 + 1 个终点，替代逐条路径规划。
 * 接口形态是“多起点 → 单终点”，因此把餐厅作为 origins、用户位置作为 destination（方向
 * 与真实出行相反）：步行基本对称；驾车含路况，高峰期与反向略有差异，作为推荐估算可接受。
 * 步行（type=3）单侧距离上限 5 公里，超出后该条无 duration，按“时间不可得”降级。
 * 距离测量与路径规划是独立服务配额，且单次推荐最多 2 次调用，不走逐条限流器。
 */
export interface DistanceTimesClient {
  times(origin: GeoPoint, destinations: GeoPoint[], mode: 'walking' | 'driving'): Promise<Array<number | undefined>>
}

export interface AmapDistanceHttpQuery {
  key: string
  origins: string
  destination: string
  /** 高德距离测量类型：1 驾车（含路况）、3 步行（≤5km）。 */
  type: '1' | '3'
}

export interface AmapDistanceResponse { status?: unknown; results?: unknown }

export type AmapDistanceHttp = (query: AmapDistanceHttpQuery) => Promise<AmapDistanceResponse>

/** 单次调用最多 100 个起点（高德文档上限）。 */
const DISTANCE_MAX_ORIGINS = 100

const DISTANCE_TYPE_BY_MODE: Record<'walking' | 'driving', '1' | '3'> = {
  walking: '3',
  driving: '1',
}

type FetchLike = (input: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export function createAmapDistanceHttp(fetcher: FetchLike = createHttpsJsonFetch()): AmapDistanceHttp {
  return async query => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const params = new URLSearchParams({
        key: query.key,
        origins: query.origins,
        destination: query.destination,
        type: query.type,
      })
      const response = await fetcher(`https://restapi.amap.com/v3/distance?${params}`, { signal: controller.signal })
      if (!response.ok) throw new SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable')
      return await response.json() as AmapDistanceResponse
    } catch (error) {
      if (error instanceof SafeError) throw error
      throw new SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable')
    } finally {
      clearTimeout(timer)
    }
  }
}

function validPoint(point: unknown): point is GeoPoint {
  if (typeof point !== 'object' || point === null || Array.isArray(point)) return false
  const candidate = point as Partial<GeoPoint>
  return Number.isFinite(candidate.latitude) && candidate.latitude! >= -90 && candidate.latitude! <= 90
    && Number.isFinite(candidate.longitude) && candidate.longitude! >= -180 && candidate.longitude! <= 180
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function createAmapDistanceClient({
  key = process.env.AMAP_WEB_KEY,
  http = createAmapDistanceHttp(),
}: { key?: string; http?: AmapDistanceHttp } = {}): DistanceTimesClient {
  if (!key) throw new SafeError('AMAP_NOT_CONFIGURED', 'Place travel times are not configured')
  return {
    async times(origin, destinations, mode) {
      if (mode !== 'walking' && mode !== 'driving'
        || !validPoint(origin)
        || !Array.isArray(destinations) || destinations.length > DISTANCE_MAX_ORIGINS
        || destinations.some(point => !validPoint(point))) {
        throw new SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable')
      }
      if (destinations.length === 0) return []
      const response = await http({
        key,
        origins: destinations.map(point => `${point.longitude},${point.latitude}`).join('|'),
        destination: `${origin.longitude},${origin.latitude}`,
        type: DISTANCE_TYPE_BY_MODE[mode],
      })
      if (response.status !== '1' || !Array.isArray(response.results)) {
        throw new SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable')
      }
      // 响应按 origin_id（1 基）对应入参顺序；单条缺失或无 duration（如步行超 5km）→ undefined。
      const minutes: Array<number | undefined> = destinations.map(() => undefined)
      for (const value of response.results) {
        const row = record(value)
        const id = Number(row?.origin_id)
        const raw = row?.duration
        const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
        if (Number.isInteger(id) && id >= 1 && id <= destinations.length
          && Number.isFinite(seconds) && seconds >= 0) {
          minutes[id - 1] = Math.ceil(seconds / 60)
        }
      }
      if (minutes.every(item => item === undefined)) {
        throw new SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable')
      }
      return minutes
    },
  }
}
