import { AmapRoutesError, createAmapRoutesClient } from './amap-routes'
import {
  createCloudBaseRouteRateLimiter,
  type CloudBaseRouteRateLimitDatabase,
} from './rate-limiter'
import type { GeoPoint, TravelMode } from '../../src/shared/types'

export interface PlaceRoutesEvent {
  origin: GeoPoint
  destinations: GeoPoint[]
  mode: TravelMode
}

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  init(options: { env: unknown }): { database(): CloudBaseRouteRateLimitDatabase }
}

export async function main(
  event: PlaceRoutesEvent,
  _context: unknown,
  sdk: CloudBaseSdk = require('@cloudbase/node-sdk') as CloudBaseSdk,
) {
  try {
    if (!event || typeof event !== 'object' || !Array.isArray(event.destinations)
      || !['walking', 'bicycling', 'driving'].includes(event.mode)) {
      throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
    }
    const database = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV }).database()
    const limiter = createCloudBaseRouteRateLimiter(database)
    return { times: await createAmapRoutesClient({ limiter }).times(event.origin, event.destinations, event.mode) }
  } catch (error) {
    if (error instanceof AmapRoutesError) throw error
    throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
  }
}
