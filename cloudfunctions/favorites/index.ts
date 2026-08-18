import { planFavoriteBatch } from '../../src/domain/favorites'
import { selectCloudBaseSdk } from '../shared/cloudbase-sdk'
import {
  createCloudBaseFavoritesRepository,
  type CloudBaseFavoritesDatabase,
  type FavoriteRepository,
} from './repository'

type Event =
  | { action: 'list' }
  | { action: 'addBatch'; poiIds: string[] }
  | { action: 'remove'; poiId: string }

type EventResult<T extends Event> = T extends { action: 'list' }
  ? Awaited<ReturnType<FavoriteRepository['list']>>
  : T extends { action: 'remove'; poiId: infer PoiId }
    ? { removed: PoiId }
    : {
        created: string[]
        existing: string[]
        duplicateSelections: string[]
        failed: Array<{ poiId: string; code: string }>
      }

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  getCloudbaseContext(context: unknown): { OPENID?: string }
  init(options: { env: unknown }): {
    database(): CloudBaseFavoritesDatabase & {
      command: { in(poiIds: string[]): unknown }
    }
  }
}

export function createFavoritesHandler(deps: { getOpenId(): string | undefined; repo: FavoriteRepository }) {
  return async <T extends Event>(event: T): Promise<EventResult<T>> => {
    const openid = deps.getOpenId()
    if (!openid) throw new Error('UNAUTHENTICATED')

    if (event.action === 'list') return deps.repo.list(openid) as Promise<EventResult<T>>
    if (event.action === 'remove') {
      await deps.repo.remove(openid, event.poiId)
      return { removed: event.poiId } as EventResult<T>
    }

    const existingSet = await deps.repo.findExisting(openid, event.poiIds)
    const plan = planFavoriteBatch(event.poiIds, existingSet)
    const inserted = await deps.repo.insert(openid, plan.toCreate)
    return {
      created: inserted.created,
      existing: [...plan.existing, ...inserted.existing],
      duplicateSelections: plan.duplicateSelections,
      failed: inserted.failed,
    } as EventResult<T>
  }
}

export const main = (event: Event, context: unknown, injected?: unknown) => {
  const cloudbase = selectCloudBaseSdk<CloudBaseSdk>(injected)
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const database = app.database()
  const handler = createFavoritesHandler({
    getOpenId: () => cloudbase.getCloudbaseContext(context).OPENID,
    repo: createCloudBaseFavoritesRepository(database, poiIds => database.command.in(poiIds)),
  })
  return handler(event)
}
