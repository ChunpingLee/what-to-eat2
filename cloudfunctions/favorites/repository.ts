import { createHash } from 'node:crypto'
import type { Place } from '../../src/domain/favorites'
import { normalizedPublicPlace, publicPlaceDocumentId } from '../shared/public-places'
import {
  AccountDeletingError,
  ensureAccountWritable,
  type AccountTransaction,
} from '../shared/account-state'

export interface FavoriteInsertResult {
  created: string[]
  existing: string[]
  failed: Array<{ poiId: string; code: string }>
}

export interface FavoriteRepository {
  list(openid: string): Promise<{ items: Place[]; unresolved: string[] }>
  findExisting(openid: string, poiIds: string[]): Promise<Set<string>>
  insert(openid: string, poiIds: string[]): Promise<FavoriteInsertResult>
  remove(openid: string, poiId: string): Promise<void>
}

interface CloudBaseCollection {
  where(query: Record<string, unknown>): CloudBaseCollection
  get(): Promise<{ data: Array<{ poiId: string; createdAt?: unknown }> }>
  remove(): Promise<unknown>
}

export interface CloudBaseFavoritesDatabase {
  collection(name: 'favorites' | 'places'): CloudBaseCollection & {
    doc(id: string): { get(): Promise<{ data: unknown[] }> }
  }
  runTransaction<T>(callback: (transaction: AccountTransaction) => Promise<T>): Promise<T>
}

function favoriteDocumentId(openid: string, poiId: string) {
  return createHash('sha256').update(`${openid}\0${poiId}`).digest('hex')
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
  now: () => Date = () => new Date(),
): FavoriteRepository {
  const favorites = database.collection('favorites')
  const places = database.collection('places')

  return {
    async list(openid) {
      const result = await favorites.where({ _openid: openid }).get()
      const records = [...result.data].sort((left, right) => {
        const leftCreated = typeof left.createdAt === 'string' ? left.createdAt : ''
        const rightCreated = typeof right.createdAt === 'string' ? right.createdAt : ''
        return leftCreated.localeCompare(rightCreated) || left.poiId.localeCompare(right.poiId)
      })
      const resolved = await Promise.all(records.map(async record => {
        const found = await places.doc(publicPlaceDocumentId(record.poiId)).get()
        return { poiId: record.poiId, place: normalizedPublicPlace(found.data[0]) }
      }))
      return {
        items: resolved.flatMap(item => item.place ? [item.place] : []),
        unresolved: resolved.flatMap(item => item.place ? [] : [item.poiId]),
      }
    },
    async findExisting(openid, poiIds) {
      if (poiIds.length === 0) return new Set()
      const result = await favorites.where({ _openid: openid, poiId: inQuery(poiIds) }).get()
      return new Set(result.data.map(record => record.poiId))
    },
    async insert(openid, poiIds) {
      const outcomes = await Promise.allSettled(poiIds.map(poiId => database.runTransaction(async transaction => {
        const createdAt = now().toISOString()
        await ensureAccountWritable(transaction, openid, createdAt)
        const id = favoriteDocumentId(openid, poiId)
        const favorite = transaction.collection('favorites').doc(id)
        const found = await favorite.get()
        if (found.data.some(value => typeof value === 'object' && value !== null
          && (value as { poiId?: unknown }).poiId === poiId)) return { poiId, status: 'existing' as const }
        await favorite.set({ data: { _id: id, poiId, _openid: openid, createdAt } })
        return { poiId, status: 'created' as const }
      })))
      const deleting = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
        && outcome.reason instanceof AccountDeletingError)
      if (deleting) throw deleting.reason
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
      await database.runTransaction(async transaction => {
        await ensureAccountWritable(transaction, openid, now().toISOString())
        await transaction.collection('favorites').doc(favoriteDocumentId(openid, poiId)).remove()
      })
    },
  }
}
