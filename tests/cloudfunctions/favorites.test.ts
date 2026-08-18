import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFavoritesHandler, main } from '../../cloudfunctions/favorites/index'
import { createCloudBaseFavoritesRepository } from '../../cloudfunctions/favorites/repository'
import { publicPlaceDocumentId } from '../../cloudfunctions/shared/public-places'
import { createHomeController } from '../../miniprogram/pages/home/controller'
import { accountDocumentId } from '../../cloudfunctions/shared/account-state'

describe('favorites cloud function', () => {
  it('provides CloudBase\'s root index handler module', () => {
    const entry = resolve(process.cwd(), 'cloudfunctions/favorites/index.js')

    expect(existsSync(entry)).toBe(true)
    expect(require(entry).main).toBeTypeOf('function')
  })

  it('loads the entrypoint declared by the deployable package', () => {
    const packageRoot = resolve(process.cwd(), 'cloudfunctions/favorites')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { main: string }
    const entry = resolve(packageRoot, manifest.main)

    expect(existsSync(entry)).toBe(true)
    expect(require(entry).main).toBeTypeOf('function')
  })

  it('uses trusted context and ignores a forged owner', async () => {
    const repo = {
      list: vi.fn().mockResolvedValue({ items: [], unresolved: [] }),
      findExisting: vi.fn(),
      insert: vi.fn(),
      remove: vi.fn(),
    }
    const handler = createFavoritesHandler({ getOpenId: () => 'trusted-user', repo })

    await expect(handler({ action: 'list', openid: 'attacker' } as never)).resolves.toEqual({ items: [], unresolved: [] })
    expect(repo.list).toHaveBeenCalledWith('trusted-user')
  })

  it('runs the production main with the OpenID from CloudBase context', async () => {
    const where = vi.fn().mockReturnThis()
    const get = vi.fn().mockResolvedValue({ data: [] })
    const database = { command: { in: vi.fn() }, collection: vi.fn().mockReturnValue({ where, get }) }
    const sdk = {
      SYMBOL_CURRENT_ENV: Symbol('current'),
      init: vi.fn().mockReturnValue({ database: () => database }),
      getCloudbaseContext: vi.fn().mockReturnValue({ OPENID: 'context-user' }),
    }

    await expect(main({ action: 'list' }, { requestId: 'request-1' }, sdk as never)).resolves.toEqual({ items: [], unresolved: [] })
    expect(sdk.getCloudbaseContext).toHaveBeenCalledWith({ requestId: 'request-1' })
    expect(where).toHaveBeenCalledWith({ _openid: 'context-user' })
  })

  it('adds multiple branches and reports existing records', async () => {
    const repo = {
      list: vi.fn(),
      findExisting: vi.fn().mockResolvedValue(new Set(['p2'])),
      insert: vi.fn().mockResolvedValue({ created: ['p1'], existing: [], failed: [] }),
      remove: vi.fn(),
    }
    const handler = createFavoritesHandler({ getOpenId: () => 'u1', repo })

    await expect(handler({ action: 'addBatch', poiIds: ['p1', 'p2', 'p1'] })).resolves.toEqual({
      created: ['p1'],
      existing: ['p2'],
      duplicateSelections: ['p1'],
      failed: [],
    })
    expect(repo.findExisting).toHaveBeenCalledWith('u1', ['p1', 'p2', 'p1'])
    expect(repo.insert).toHaveBeenCalledWith('u1', ['p1'])
  })

  it('queries existing favorites by owner and poiId before inserting', async () => {
    const database = transactionalFavoritesDatabase()
    database.records.favorites.set('existing', { _id: 'existing', poiId: 'p2', _openid: 'u1' })
    const repo = createCloudBaseFavoritesRepository(database as never, ids => ({ $in: ids }), () => new Date(0))

    await expect(repo.findExisting('u1', ['p1', 'p2'])).resolves.toEqual(new Set(['p2']))
    await expect(repo.insert('u1', ['p1'])).resolves.toMatchObject({ created: ['p1'] })

    expect([...database.records.favorites.values()]).toContainEqual({
      _id: '5a703d644abc1f2d890a19dc6090521e39ca583e7bd98ca41a896d974188f278',
      poiId: 'p1', _openid: 'u1', createdAt: new Date(0).toISOString(),
    })
    expect([...database.records.users.values()]).toContainEqual(expect.objectContaining({
      _openid: 'u1', status: 'active',
    }))
  })

  it('atomically classifies one of two concurrent additions as existing', async () => {
    const database = transactionalFavoritesDatabase()
    const repo = createCloudBaseFavoritesRepository(database as never)
    const handler = createFavoritesHandler({ getOpenId: () => 'u1', repo })

    const results = await Promise.all([
      handler({ action: 'addBatch', poiIds: ['p1'] }),
      handler({ action: 'addBatch', poiIds: ['p1'] }),
    ])

    expect(database.records.favorites.size).toBe(1)
    expect(results.flatMap(result => result.created)).toEqual(['p1'])
    expect(results.flatMap(result => result.existing)).toEqual(['p1'])
  })

  it('returns partial batch results without rolling back successful writes', async () => {
    const database = transactionalFavoritesDatabase('denied')
    const repo = createCloudBaseFavoritesRepository(database as never)
    await repo.insert('u1', ['existing'])
    const handler = createFavoritesHandler({ getOpenId: () => 'u1', repo })

    await expect(handler({ action: 'addBatch', poiIds: ['created', 'existing', 'denied'] })).resolves.toEqual({
      created: ['created'], existing: ['existing'], duplicateSelections: [], failed: [{ poiId: 'denied', code: 'DATABASE_PERMISSION_DENIED' }],
    })
  })

  it('resolves favorite records to ordered public places that home can distance-sort', async () => {
    const near = { poiId: 'near', name: '近店', location: { latitude: 31.231, longitude: 121.47 } }
    const far = { poiId: 'far', name: '远店', location: { latitude: 31.24, longitude: 121.47 } }
    const favorites = [
      { poiId: 'far', _openid: 'u1', createdAt: '2026-08-17T00:00:00.000Z' },
      { poiId: 'near', _openid: 'u1', createdAt: '2026-08-17T00:01:00.000Z' },
    ]
    const places = new Map([
      [publicPlaceDocumentId('near'), near], [publicPlaceDocumentId('far'), far],
    ])
    const repo = createCloudBaseFavoritesRepository(favoriteReadDatabase(favorites, places) as never)

    await expect(repo.list('u1')).resolves.toEqual({ items: [far, near], unresolved: [] })
    const home = createHomeController({ listFavorites: async () => (await repo.list('u1')).items })
    await expect(home.load({ latitude: 31.23, longitude: 121.47 }, 5_000)).resolves.toMatchObject({
      status: 'ready', items: [{ place: near }, { place: far }],
    })
  })

  it('skips missing public POIs and reports their ids as unresolved', async () => {
    const found = { poiId: 'found', name: '已解析', location: { latitude: 31.23, longitude: 121.47 } }
    const favorites = [
      { poiId: 'missing', _openid: 'u1', createdAt: '2026-08-17T00:00:00.000Z' },
      { poiId: 'found', _openid: 'u1', createdAt: '2026-08-17T00:01:00.000Z' },
    ]
    const places = new Map([[publicPlaceDocumentId('found'), found]])
    const repo = createCloudBaseFavoritesRepository(favoriteReadDatabase(favorites, places) as never)

    await expect(repo.list('u1')).resolves.toEqual({ items: [found], unresolved: ['missing'] })
  })

  it('rejects add and remove writes when the trusted account state is deleting', async () => {
    const userId = accountDocumentId('u1')
    const database = {
      runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => ({ data: name === 'users' && id === userId
              ? [{ _id: userId, _openid: 'u1', status: 'deleting' }] : [] }),
            set: vi.fn(), remove: vi.fn(),
          }),
        }),
      })),
      collection: () => ({
        where: () => ({ get: async () => ({ data: [] }), remove: vi.fn() }),
        add: vi.fn(),
        doc: () => ({ get: async () => ({ data: [] }) }),
      }),
    }
    const repo = createCloudBaseFavoritesRepository(database as never)

    await expect(repo.insert('u1', ['p1'])).rejects.toMatchObject({ code: 'ACCOUNT_DELETING' })
    await expect(repo.remove('u1', 'p1')).rejects.toMatchObject({ code: 'ACCOUNT_DELETING' })
  })
})

function favoriteReadDatabase(
  favorites: Array<{ poiId: string; _openid: string; createdAt: string }>,
  places: Map<string, object>,
) {
  return {
    collection(name: string) {
      if (name === 'favorites') return {
        where: () => ({ get: async () => ({ data: favorites }) }),
      }
      return {
        doc: (id: string) => ({ get: async () => ({ data: places.has(id) ? [places.get(id)] : [] }) }),
      }
    },
  }
}

function transactionalFavoritesDatabase(failingPoiId?: string) {
  const records = {
    favorites: new Map<string, Record<string, unknown>>(),
    users: new Map<string, Record<string, unknown>>(),
    places: new Map<string, Record<string, unknown>>(),
  }
  let transactionQueue: Promise<unknown> = Promise.resolve()
  const transactionCollection = (name: keyof typeof records) => ({
    doc: (id: string) => ({
      get: async () => ({ data: records[name].get(id) }),
      set: async (body: Record<string, unknown>) => {
        if (Object.prototype.hasOwnProperty.call(body, '_id')) {
          throw { code: 'INVALID_PARAM', message: '不能更新_id的值' }
        }
        if (name === 'favorites' && body.poiId === failingPoiId) throw { code: 'DATABASE_PERMISSION_DENIED' }
        records[name].set(id, { ...body, _id: id })
      },
      remove: async () => { records[name].delete(id) },
    }),
  })
  return {
    records,
    runTransaction<T>(callback: (transaction: { collection(name: keyof typeof records): ReturnType<typeof transactionCollection> }) => Promise<T>) {
      const operation = transactionQueue.then(() => callback({ collection: transactionCollection }))
      transactionQueue = operation.then(() => undefined, () => undefined)
      return operation
    },
    collection(name: keyof typeof records) {
      return {
        where(query: Record<string, unknown>) {
          return {
            async get() {
              const included = query.poiId && typeof query.poiId === 'object' && '$in' in (query.poiId as object)
                ? (query.poiId as { $in: string[] }).$in : undefined
              return { data: [...records[name].values()].filter(record =>
                (!query._openid || record._openid === query._openid)
                && (!query.poiId || included?.includes(record.poiId as string) || record.poiId === query.poiId)) }
            },
          }
        },
        doc(id: string) { return transactionCollection(name).doc(id) },
      }
    },
  }
}
