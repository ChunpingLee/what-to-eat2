import { sortNearbyFavorites, type Place } from '../../../src/domain/favorites'
import type { GeoPoint } from '../../../src/shared/types'

export type HomeState =
  | { status: 'ready'; items: ReturnType<typeof sortNearbyFavorites>; showRecommend: true }
  | { status: 'empty'; items: []; showRecommend: true }
  | { status: 'error'; items: ReturnType<typeof sortNearbyFavorites>; showRecommend: true; errorMessage: string }

export interface FavoritesApi {
  listFavorites(): Promise<Place[]>
}

export function createHomeController(api: FavoritesApi) {
  let lastSuccessfulItems: ReturnType<typeof sortNearbyFavorites> = []

  return {
    async load(center: GeoPoint, radiusMeters: number): Promise<HomeState> {
      try {
        const items = sortNearbyFavorites(await api.listFavorites(), center, radiusMeters)
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
