import type { Place } from '../../src/domain/favorites'

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
