import { createHash } from 'node:crypto'

export interface FavoriteInsertResult {
  created: string[]
  existing: string[]
}

export interface FavoriteRepository {
  list(openid: string): Promise<unknown[]>
  findExisting(openid: string, poiIds: string[]): Promise<Set<string>>
  insert(openid: string, poiIds: string[]): Promise<FavoriteInsertResult>
  remove(openid: string, poiId: string): Promise<void>
}

interface CloudBaseCollection {
  where(query: Record<string, unknown>): CloudBaseCollection
  get(): Promise<{ data: Array<{ poiId: string }> }>
  add(options: { data: { _id: string; poiId: string; _openid: string } }): Promise<unknown>
  remove(): Promise<unknown>
}

export interface CloudBaseFavoritesDatabase {
  collection(name: 'favorites'): CloudBaseCollection
}

function favoriteDocumentId(openid: string, poiId: string) {
  return createHash('sha256').update(`${openid}\0${poiId}`).digest('hex')
}

function isDuplicateWrite(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'DATABASE_DUPLICATE_WRITE'
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
      const outcomes = await Promise.all(poiIds.map(async poiId => {
        try {
          await favorites.add({ data: { _id: favoriteDocumentId(openid, poiId), poiId, _openid: openid } })
          return { poiId, status: 'created' as const }
        } catch (error) {
          if (isDuplicateWrite(error)) return { poiId, status: 'existing' as const }
          throw error
        }
      }))
      return {
        created: outcomes.filter(outcome => outcome.status === 'created').map(outcome => outcome.poiId),
        existing: outcomes.filter(outcome => outcome.status === 'existing').map(outcome => outcome.poiId),
      }
    },
    async remove(openid, poiId) {
      await favorites.where({ _openid: openid, poiId }).remove()
    },
  }
}
