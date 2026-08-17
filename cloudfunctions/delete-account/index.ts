export const PERSONAL_COLLECTIONS = [
  'favorites',
  'imports',
  'recommendation_events',
  'users',
] as const

export type PersonalCollection = typeof PERSONAL_COLLECTIONS[number]

export interface DeleteOwnedResult {
  deleted: Partial<Record<PersonalCollection, number>>
}

export interface DeleteAccountRepository {
  deleteOwned(openid: string, collections: readonly PersonalCollection[]): Promise<DeleteOwnedResult>
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
  options: { pageSize?: number; deleteConcurrency?: number } = {},
): DeleteAccountRepository {
  const pageSize = options.pageSize ?? 100
  const deleteConcurrency = options.deleteConcurrency ?? 20
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('INVALID_DELETE_PAGE_SIZE')
  if (!Number.isInteger(deleteConcurrency) || deleteConcurrency < 1) throw new Error('INVALID_DELETE_CONCURRENCY')

  return {
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
  }
}

export function createDeleteHandler(deps: { getOpenId(): string | undefined; repo: DeleteAccountRepository }) {
  return async (_event?: unknown) => {
    const openid = deps.getOpenId()
    if (!openid) throw new Error('UNAUTHENTICATED')
    return deps.repo.deleteOwned(openid, PERSONAL_COLLECTIONS)
  }
}

export function main(
  event: unknown,
  context: unknown,
  sdk: CloudBaseSdk = require('@cloudbase/node-sdk') as CloudBaseSdk,
) {
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV })
  return createDeleteHandler({
    getOpenId: () => sdk.getCloudbaseContext(context).OPENID,
    repo: createCloudBaseDeleteRepository(app.database()),
  })(event)
}
