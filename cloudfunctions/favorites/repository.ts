export interface FavoriteRepository {
  list(openid: string): Promise<unknown[]>
  findExisting(openid: string, poiIds: string[]): Promise<Set<string>>
  insert(openid: string, poiIds: string[]): Promise<void>
  remove(openid: string, poiId: string): Promise<void>
}

interface CloudBaseCollection {
  where(query: Record<string, unknown>): CloudBaseCollection
  get(): Promise<{ data: Array<{ poiId: string }> }>
  add(options: { data: { poiId: string; _openid: string } }): Promise<unknown>
  remove(): Promise<unknown>
}

export interface CloudBaseFavoritesDatabase {
  collection(name: 'favorites'): CloudBaseCollection
}

export function createCloudBaseFavoritesRepository(
  database: CloudBaseFavoritesDatabase,
  inQuery: (poiIds: string[]) => unknown = poiIds => ({ $in: poiIds }),
): FavoriteRepository {
  const favorites = database.collection('favorites')

  return {
    async list(openid) {
      const result = await favorites.where({ _openid: openid }).get()
      return result.data
    },
    async findExisting(openid, poiIds) {
      if (poiIds.length === 0) return new Set()
      const result = await favorites.where({ _openid: openid, poiId: inQuery(poiIds) }).get()
      return new Set(result.data.map(record => record.poiId))
    },
    async insert(openid, poiIds) {
      await Promise.all(poiIds.map(poiId => favorites.add({ data: { poiId, _openid: openid } })))
    },
    async remove(openid, poiId) {
      await favorites.where({ _openid: openid, poiId }).remove()
    },
  }
}
