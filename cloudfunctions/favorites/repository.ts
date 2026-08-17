import { createHash } from 'node:crypto'

export interface FavoriteInsertResult {
  created: string[]
  existing: string[]
  failed: Array<{ poiId: string; code: string }>
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

function safeErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && /^DATABASE_[A-Z_]+$/.test(code)) return code
  }
  return 'DATABASE_WRITE_FAILED'
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
      const outcomes = await Promise.allSettled(poiIds.map(async poiId => {
        try {
          await favorites.add({ data: { _id: favoriteDocumentId(openid, poiId), poiId, _openid: openid } })
          return { poiId, status: 'created' as const }
        } catch (error) {
          if (isDuplicateWrite(error)) {
            const id = favoriteDocumentId(openid, poiId)
            const confirmed = await favorites.where({ _id: id, _openid: openid, poiId }).get()
            if (confirmed.data.some(record => record.poiId === poiId)) return { poiId, status: 'existing' as const }
          }
          throw error
        }
      }))
      const successful = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : [])
      return {
        created: successful.filter(outcome => outcome.status === 'created').map(outcome => outcome.poiId),
        existing: successful.filter(outcome => outcome.status === 'existing').map(outcome => outcome.poiId),
        failed: outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
          ? [{ poiId: poiIds[index], code: safeErrorCode(outcome.reason) }]
          : []),
      }
    },
    async remove(openid, poiId) {
      await favorites.where({ _openid: openid, poiId }).remove()
    },
  }
}
