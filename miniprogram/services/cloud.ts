import type { Place } from '../../src/domain/favorites'
import type { GeoPoint } from '../../src/shared/types'

interface FavoritesListResult {
  items: Place[]
}

export async function listFavorites(): Promise<Place[]> {
  const response = await wx.cloud.callFunction<FavoritesListResult>({
    name: 'favorites',
    data: { action: 'list' },
  })
  return response.result.items
}

export interface PlaceSearchResult {
  items: Place[]
  sourceUpdatedAt: string
  stale: boolean
}

export interface FavoriteBatchResult {
  created: string[]
  existing: string[]
  duplicateSelections: string[]
  failed: Array<{ poiId: string; code: string }>
}

export async function searchPlaces(query: {
  keywords: string
  center: GeoPoint
  city: string
  radiusMeters: number
}): Promise<PlaceSearchResult> {
  const response = await wx.cloud.callFunction<PlaceSearchResult>({
    name: 'place-search',
    data: query,
  })
  return response.result
}

export async function addFavoriteBatch(poiIds: string[]): Promise<FavoriteBatchResult> {
  const response = await wx.cloud.callFunction<FavoriteBatchResult>({
    name: 'favorites',
    data: { action: 'addBatch', poiIds },
  })
  return response.result
}
