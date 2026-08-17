import { sortNearbyFavorites, type NearbyFavorite, type Place } from '../../../src/domain/favorites'
import type { GeoPoint } from '../../../src/shared/types'
import { buildShareDetailPath } from '../../../src/domain/share'

export type HomeFavorite = NearbyFavorite & { poiId: string; detailPath: string }

export type HomeState =
  | { status: 'ready'; items: HomeFavorite[]; showRecommend: true }
  | { status: 'empty'; items: []; showRecommend: true }
  | { status: 'error'; items: HomeFavorite[]; showRecommend: true; errorMessage: string }

export interface FavoritesApi {
  listFavorites(): Promise<Place[]>
}

export function createHomeController(api: FavoritesApi) {
  let lastSuccessfulItems: HomeFavorite[] = []

  return {
    async load(center: GeoPoint, radiusMeters: number): Promise<HomeState> {
      try {
        const items = sortNearbyFavorites(await api.listFavorites(), center, radiusMeters)
          .map(item => ({ ...item, poiId: item.place.poiId, detailPath: buildShareDetailPath(item.place.poiId) }))
        lastSuccessfulItems = items
        return items.length
          ? { status: 'ready', items, showRecommend: true }
          : { status: 'empty', items: [], showRecommend: true }
      } catch (error) {
        return {
          status: 'error',
          items: lastSuccessfulItems,
          showRecommend: true,
          errorMessage: error instanceof Error ? error.message : '加载失败',
        }
      }
    },
  }
}
