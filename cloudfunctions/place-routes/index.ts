import { AmapRoutesError, createAmapRoutesClient } from './amap-routes'
import type { GeoPoint, TravelMode } from '../../src/shared/types'

export interface PlaceRoutesEvent {
  origin: GeoPoint
  destinations: GeoPoint[]
  mode: TravelMode
}

export async function main(event: PlaceRoutesEvent) {
  try {
    return { times: await createAmapRoutesClient().times(event.origin, event.destinations, event.mode) }
  } catch (error) {
    if (error instanceof AmapRoutesError) throw error
    throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
  }
}
