import type { Place } from '../shared/favorites'
import type { GeoPoint } from '../shared/types'
import type { RecommendationRequest } from '../../src/domain/recommendation'
import type { RecommendationResult } from '../../cloudfunctions/recommend/index'

interface FavoritesListResult {
  items: Place[]
  unresolved: string[]
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

export type LinkImportResult =
  | { status: 'matched'; candidates: Place[] }
  | { status: 'search'; keywords: string }
  | { status: 'manual' }

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

export async function importSharedLink(input: {
  url: string
  center?: GeoPoint
  city?: string
}): Promise<LinkImportResult> {
  const response = await wx.cloud.callFunction<LinkImportResult>({
    name: 'link-import',
    data: input,
  })
  return response.result
}

export async function recommendPlaces(request: RecommendationRequest): Promise<RecommendationResult> {
  const response = await wx.cloud.callFunction<RecommendationResult>({
    name: 'recommend',
    data: request,
  })
  return response.result
}

export async function resolveSharedPlace(payload: { v: 1; poiId: string }): Promise<Place> {
  const response = await wx.cloud.callFunction<{ place: Place }>({
    name: 'share-place',
    data: payload,
  })
  return response.result.place
}

export async function deleteAccount(): Promise<{ deleted: Record<string, number> }> {
  const response = await wx.cloud.callFunction<{ deleted: Record<string, number> }>({
    name: 'delete-account',
    data: {},
  })
  return response.result
}
