import { planFavoriteBatch } from '../../src/domain/favorites'
import {
  createCloudBaseFavoritesRepository,
  type CloudBaseFavoritesDatabase,
  type FavoriteRepository,
} from './repository'

type Event =
  | { action: 'list' }
  | { action: 'addBatch'; poiIds: string[] }
  | { action: 'remove'; poiId: string }

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
  return async (event: Event) => {
    const openid = deps.getOpenId()
    if (!openid) throw new Error('UNAUTHENTICATED')

    if (event.action === 'list') return { items: await deps.repo.list(openid) }
    if (event.action === 'remove') {
      await deps.repo.remove(openid, event.poiId)
      return { removed: event.poiId }
    }

    const existingSet = await deps.repo.findExisting(openid, event.poiIds)
    const plan = planFavoriteBatch(event.poiIds, existingSet)
    const inserted = await deps.repo.insert(openid, plan.toCreate)
    return {
      created: inserted.created,
      existing: [...plan.existing, ...inserted.existing],
      duplicateSelections: plan.duplicateSelections,
      failed: inserted.failed,
    }
  }
}

export const main = (event: Event, context: unknown, sdk: CloudBaseSdk = require('@cloudbase/node-sdk') as CloudBaseSdk) => {
  const cloudbase = sdk
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const database = app.database()
  const handler = createFavoritesHandler({
    getOpenId: () => cloudbase.getCloudbaseContext(context).OPENID,
    repo: createCloudBaseFavoritesRepository(database, poiIds => database.command.in(poiIds)),
  })
  return handler(event)
}
