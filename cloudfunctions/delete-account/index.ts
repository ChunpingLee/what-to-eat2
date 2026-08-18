import {
  accountStateFromDocumentData,
  accountDocumentId,
  type AccountTransaction,
} from '../shared/account-state'
import { selectCloudBaseSdk, wxContextFromEnv } from '../shared/cloudbase-sdk'

export const PERSONAL_COLLECTIONS = [
  'favorites',
  'imports',
  'recommendation_events',
  'users',
] as const

export type PersonalCollection = typeof PERSONAL_COLLECTIONS[number]
export const PERSONAL_DATA_COLLECTIONS = ['favorites', 'imports', 'recommendation_events'] as const
export type PersonalDataCollection = typeof PERSONAL_DATA_COLLECTIONS[number]

export interface DeleteOwnedResult {
  deleted: Partial<Record<PersonalCollection, number>>
}

export interface DeleteAccountRepository {
  beginDeletion(openid: string): Promise<void>
  deleteOwned(openid: string, collections: readonly PersonalDataCollection[]): Promise<DeleteOwnedResult>
  finishDeletion(openid: string): Promise<number>
}

interface CloudBaseQuery {
  limit(count: number): { get(): Promise<{ data: Array<{ _id: string }> }> }
}

interface CloudBaseCollection {
  where(query: { _openid: string }): CloudBaseQuery
  doc(id: string): { remove(): Promise<unknown> }
}

export interface CloudBaseDeleteDatabase {
  collection(name: PersonalCollection): CloudBaseCollection
  runTransaction<T>(callback: (transaction: AccountTransaction) => Promise<T>): Promise<T>
}

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  getCloudbaseContext(context: unknown): { OPENID?: string }
  init(options: { env: unknown }): { database(): CloudBaseDeleteDatabase }
}

export class DeleteAccountPartialFailure extends Error {
  readonly code = 'DELETE_ACCOUNT_PARTIAL_FAILURE'

  constructor(
    readonly collection: PersonalCollection,
    readonly failedIds: string[],
  ) {
    super('DELETE_ACCOUNT_PARTIAL_FAILURE')
    this.name = 'DeleteAccountPartialFailure'
  }
}

async function inBatches<T>(values: T[], concurrency: number, task: (value: T) => Promise<unknown>) {
  const failures: T[] = []
  for (let offset = 0; offset < values.length; offset += concurrency) {
    const batch = values.slice(offset, offset + concurrency)
    const results = await Promise.allSettled(batch.map(task))
    results.forEach((result, index) => {
      if (result.status === 'rejected') failures.push(batch[index])
    })
  }
  return failures
}

/**
 * Deletes stable document IDs page by page. Completed removals stay removed, so retrying
 * after DeleteAccountPartialFailure resumes from the remaining owner-scoped documents.
 */
export function createCloudBaseDeleteRepository(
  database: CloudBaseDeleteDatabase,
  options: { pageSize?: number; deleteConcurrency?: number; now?: () => Date } = {},
): DeleteAccountRepository {
  const pageSize = options.pageSize ?? 100
  const deleteConcurrency = options.deleteConcurrency ?? 20
  const now = options.now ?? (() => new Date())
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('INVALID_DELETE_PAGE_SIZE')
  if (!Number.isInteger(deleteConcurrency) || deleteConcurrency < 1) throw new Error('INVALID_DELETE_CONCURRENCY')

  return {
    async beginDeletion(openid) {
      await database.runTransaction(async transaction => {
        const id = accountDocumentId(openid)
        const account = transaction.collection('users').doc(id)
        const result = await account.get()
        const state = accountStateFromDocumentData(result.data)
        if (state?.status === 'deleting') return
        await account.set({
          _openid: openid, status: 'deleting', updatedAt: now().toISOString(),
        })
      })
    },
    async deleteOwned(openid, collections) {
      const deleted: Partial<Record<PersonalCollection, number>> = {}
      for (const name of collections) {
        let count = 0
        const collection = database.collection(name)
        while (true) {
          const result = await collection.where({ _openid: openid }).limit(pageSize).get()
          if (result.data.length === 0) break
          const ids = result.data.map(record => record._id).filter(id => typeof id === 'string' && id.length > 0)
          if (ids.length !== result.data.length) throw new DeleteAccountPartialFailure(name, ids)
          const failedIds = await inBatches(ids, deleteConcurrency, id => collection.doc(id).remove())
          count += ids.length - failedIds.length
          if (failedIds.length) throw new DeleteAccountPartialFailure(name, failedIds)
        }
        deleted[name] = count
      }
      return { deleted }
    },
    async finishDeletion(openid) {
      return database.runTransaction(async transaction => {
        const account = transaction.collection('users').doc(accountDocumentId(openid))
        const result = await account.get()
        const state = accountStateFromDocumentData(result.data)
        if (!state) return 0
        if (state.status !== 'deleting') throw new Error('ACCOUNT_DELETE_STATE_CHANGED')
        await account.remove()
        return 1
      })
    },
  }
}

export function createDeleteHandler(deps: { getOpenId(): string | undefined; repo: DeleteAccountRepository }) {
  return async (_event?: unknown) => {
    const openid = deps.getOpenId()
    if (!openid) throw new Error('UNAUTHENTICATED')
    await deps.repo.beginDeletion(openid)
    const result = await deps.repo.deleteOwned(openid, PERSONAL_DATA_COLLECTIONS)
    const users = await deps.repo.finishDeletion(openid)
    return { deleted: { ...result.deleted, users } }
  }
}

export function main(
  event: unknown,
  context: unknown,
  injected?: unknown,
) {
  const sdk = selectCloudBaseSdk<CloudBaseSdk>(injected)
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV })
  return createDeleteHandler({
    getOpenId: () => wxContextFromEnv().OPENID ?? sdk.getCloudbaseContext(context).OPENID,
    repo: createCloudBaseDeleteRepository(app.database()),
  })(event)
}
