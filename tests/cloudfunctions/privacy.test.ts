import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSharePayload, createSharePlaceHandler, main as shareMain } from '../../cloudfunctions/share-place/index'
import {
  PERSONAL_COLLECTIONS,
  PERSONAL_DATA_COLLECTIONS,
  createCloudBaseDeleteRepository,
  createDeleteHandler,
  main as deleteMain,
} from '../../cloudfunctions/delete-account/index'
import { createCloudBaseFavoritesRepository } from '../../cloudfunctions/favorites/repository'
import { publicPlaceDocumentId } from '../../cloudfunctions/shared/public-places'
import {
  createPlaceDetailController,
  parseShareOptions,
  sharePathFor,
} from '../../miniprogram/pages/place-detail/index'
import { createDeleteAccountAction } from '../../miniprogram/pages/settings/index'
import {
  SHARE_DETAIL_PATH_MAX_UTF8_BYTES,
  buildShareDetailPath,
} from '../../src/domain/share'

describe('private place sharing', () => {
  it('contains only the version and POI id in a share payload', () => {
    expect(createSharePayload({ poiId: 'p1', owner: 'u1', note: '私密备注' } as never)).toEqual({ v: 1, poiId: 'p1' })
  })

  it('resolves the shared POI from the public place repository', async () => {
    const publicPlace = {
      poiId: 'p1', name: '示例餐厅', address: '人民路 1 号',
      location: { latitude: 31.23, longitude: 121.47 }, categories: ['餐饮'],
    }
    const repo = {
      findPublicByPoiId: vi.fn().mockResolvedValue({ ...publicPlace, owner: 'u1', note: '私密备注', _openid: 'u1' }),
    }
    const handler = createSharePlaceHandler({ repo })

    await expect(handler({ v: 1, poiId: 'p1', owner: 'attacker', note: '不应读取' } as never))
      .resolves.toEqual({ place: publicPlace })
    expect(repo.findPublicByPoiId).toHaveBeenCalledWith('p1')
  })

  it('rejects malformed share parameters before querying places', async () => {
    const repo = { findPublicByPoiId: vi.fn() }
    const handler = createSharePlaceHandler({ repo })

    await expect(handler({ v: 2, poiId: 'p1' } as never)).rejects.toThrow('INVALID_SHARE_PAYLOAD')
    await expect(handler({ v: 1, poiId: '' })).rejects.toThrow('INVALID_SHARE_PAYLOAD')
    expect(repo.findPublicByPoiId).not.toHaveBeenCalled()
  })

  it('runs the production resolver against only the places collection', async () => {
    const where = vi.fn().mockReturnThis()
    const limit = vi.fn().mockReturnThis()
    const place = {
      poiId: 'p1', name: '公开餐厅',
      location: { latitude: 31.23, longitude: 121.47 },
    }
    const get = vi.fn().mockResolvedValue({ data: [place] })
    const doc = vi.fn().mockReturnValue({ get })
    const database = { collection: vi.fn().mockReturnValue({ doc, where, limit, get }) }
    const sdk = { SYMBOL_CURRENT_ENV: Symbol('current'), init: vi.fn().mockReturnValue({ database: () => database }) }

    await expect(shareMain({ v: 1, poiId: 'p1' }, {}, sdk as never)).resolves.toEqual({ place })
    expect(database.collection).toHaveBeenCalledTimes(1)
    expect(database.collection).toHaveBeenCalledWith('places')
    expect(doc).toHaveBeenCalledWith(publicPlaceDocumentId('p1'))
    expect(where).not.toHaveBeenCalled()
  })
})

describe('share receiver and account settings', () => {
  it('builds a detail share path containing only version and encoded POI id', () => {
    const poiId = 'poi/1 ?%&#'
    const expected = '/pages/place-detail/index?v=1&poiId=poi%2F1%20%3F%25%26%23'
    expect(sharePathFor(poiId)).toBe(expected)
    expect(buildShareDetailPath(poiId)).toBe(expected)
    expect(parseShareOptions({ v: '1', poiId: 'poi%2F1%20%3F%25%26%23', owner: 'victim', note: '私密' }))
      .toEqual({ v: 1, poiId })
  })

  it('rejects a raw-valid POI id when its encoded UTF-8 share path exceeds the stable limit', () => {
    expect(SHARE_DETAIL_PATH_MAX_UTF8_BYTES).toBe(512)
    const longChinesePoiId = '店'.repeat(80)

    expect(() => buildShareDetailPath(longChinesePoiId)).toThrow('INVALID_SHARE_PAYLOAD')
    expect(() => createSharePayload({ poiId: longChinesePoiId })).toThrow('INVALID_SHARE_PAYLOAD')
  })

  it('re-resolves the public POI and adds it only after the receiver taps favorite', async () => {
    const place = {
      poiId: 'p1', name: '公开餐厅', address: '人民路 1 号',
      location: { latitude: 31.23, longitude: 121.47 }, categories: ['餐饮'],
    }
    const api = {
      resolveSharedPlace: vi.fn().mockResolvedValue(place),
      addFavoriteBatch: vi.fn().mockResolvedValue({
        created: ['p1'], existing: [], duplicateSelections: [], failed: [],
      }),
    }
    const controller = createPlaceDetailController(api)

    await expect(controller.load({ v: 1, poiId: 'p1' })).resolves.toEqual(place)
    expect(api.addFavoriteBatch).not.toHaveBeenCalled()
    await expect(controller.addFavorite()).resolves.toMatchObject({ created: ['p1'] })
    expect(api.addFavoriteBatch).toHaveBeenCalledWith(['p1'])
  })

  it('does not delete account data when the second confirmation is cancelled', async () => {
    const deleteAccount = vi.fn()
    const action = createDeleteAccountAction({
      confirm: vi.fn().mockResolvedValue(false), deleteAccount, relaunch: vi.fn(),
    })

    await expect(action()).resolves.toEqual({ deleted: false })
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('deletes and clears local navigation only after explicit confirmation', async () => {
    const deleteAccount = vi.fn().mockResolvedValue({ deleted: { favorites: 2 } })
    const relaunch = vi.fn()
    const action = createDeleteAccountAction({
      confirm: vi.fn().mockResolvedValue(true), deleteAccount, relaunch,
    })

    await expect(action()).resolves.toEqual({ deleted: true })
    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(relaunch).toHaveBeenCalledWith('/pages/home/index')
  })

  it('registers detail and settings pages with share, navigation, favorite and deletion controls', () => {
    const app = JSON.parse(readFileSync(resolve(process.cwd(), 'miniprogram/app.json'), 'utf8')) as { pages: string[] }
    const detail = readFileSync(resolve(process.cwd(), 'miniprogram/pages/place-detail/index.wxml'), 'utf8')
    const settings = readFileSync(resolve(process.cwd(), 'miniprogram/pages/settings/index.wxml'), 'utf8')

    expect(app.pages).toEqual(expect.arrayContaining(['pages/place-detail/index', 'pages/settings/index']))
    expect(detail).toContain('open-type="share"')
    expect(detail).toContain('bindtap="onOpenLocation"')
    expect(detail).toContain('bindtap="onAddFavorite"')
    expect(settings).toContain('bindtap="onDeleteAccount"')
  })

  it('keeps the internal privacy inventory out of WeChat platform configuration', () => {
    expect(existsSync(resolve(process.cwd(), 'miniprogram/privacy.json'))).toBe(false)
    const inventory = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/privacy-data-inventory.json'), 'utf8')) as {
      classification?: string
      platformDeclarationComplete?: boolean
      dataPractices?: Array<{ data?: string }>
    }
    expect(inventory.classification).toBe('INTERNAL_DATA_INVENTORY_NOT_WECHAT_CONFIGURATION')
    expect(inventory.platformDeclarationComplete).toBe(false)
    expect(inventory.dataPractices?.map(item => item.data)).toEqual(['位置', '收藏', '导入链接', '推荐反馈'])
    const app = JSON.parse(readFileSync(resolve(process.cwd(), 'miniprogram/app.json'), 'utf8')) as {
      requiredPrivateInfos?: string[]
    }
    expect(app.requiredPrivateInfos).toEqual(['getLocation', 'chooseLocation'])
  })
})

describe('account deletion', () => {
  it('deletes only personal collections owned by the trusted context', async () => {
    const repo = {
      beginDeletion: vi.fn().mockResolvedValue(undefined),
      deleteOwned: vi.fn().mockResolvedValue({ deleted: {} }),
      finishDeletion: vi.fn().mockResolvedValue(undefined),
    }
    const handler = createDeleteHandler({ getOpenId: () => 'u1', repo })

    await handler({ owner: 'victim' } as never)

    expect(repo.beginDeletion).toHaveBeenCalledWith('u1')
    expect(repo.deleteOwned).toHaveBeenCalledWith('u1', ['favorites', 'imports', 'recommendation_events'])
    expect(repo.finishDeletion).toHaveBeenCalledWith('u1')
    expect(PERSONAL_COLLECTIONS).not.toContain('places')
    expect(PERSONAL_DATA_COLLECTIONS).not.toContain('users')
  })

  it('refuses deletion without a trusted OpenID', async () => {
    const repo = { beginDeletion: vi.fn(), deleteOwned: vi.fn(), finishDeletion: vi.fn() }
    const handler = createDeleteHandler({ getOpenId: () => undefined, repo })

    await expect(handler()).rejects.toThrow('UNAUTHENTICATED')
    expect(repo.deleteOwned).not.toHaveBeenCalled()
  })

  it('paginates beyond one database query limit', async () => {
    const records = Array.from({ length: 205 }, (_, index) => ({ _id: `f${index}`, _openid: 'u1' }))
    const get = vi.fn(async () => ({ data: records.filter(record => record._openid === 'u1').slice(0, 100) }))
    const remove = vi.fn(async (id: string) => {
      const record = records.find(item => item._id === id)
      if (record) record._openid = 'deleted'
    })
    const database = fakeDeleteDatabase(get, remove)
    const repo = createCloudBaseDeleteRepository(database as never, { pageSize: 100, deleteConcurrency: 10 })

    await expect(repo.deleteOwned('u1', ['favorites'])).resolves.toEqual({ deleted: { favorites: 205 } })
    expect(get).toHaveBeenCalledTimes(4)
    expect(remove).toHaveBeenCalledTimes(205)
  })

  it('is safe to retry after a partially failed page', async () => {
    const records = [
      { _id: 'a', _openid: 'u1' },
      { _id: 'b', _openid: 'u1' },
      { _id: 'other', _openid: 'u2' },
    ]
    let failB = true
    const get = vi.fn(async () => ({ data: records.filter(record => record._openid === 'u1').slice(0, 100) }))
    const remove = vi.fn(async (id: string) => {
      if (id === 'b' && failB) throw new Error('temporary failure')
      const record = records.find(item => item._id === id)
      if (record) record._openid = 'deleted'
    })
    const repo = createCloudBaseDeleteRepository(fakeDeleteDatabase(get, remove) as never)

    await expect(repo.deleteOwned('u1', ['favorites', 'imports'])).rejects.toMatchObject({
      code: 'DELETE_ACCOUNT_PARTIAL_FAILURE', collection: 'favorites', failedIds: ['b'],
    })
    expect(records.find(record => record._id === 'a')?._openid).toBe('deleted')
    expect(records.find(record => record._id === 'other')?._openid).toBe('u2')

    failB = false
    await expect(repo.deleteOwned('u1', ['favorites', 'imports'])).resolves.toEqual({
      deleted: { favorites: 1, imports: 0 },
    })
  })

  it('locks writes before sweeping, rejects a write after the final empty page, and allows an explicit new account later', async () => {
    const database = accountLifecycleDatabase()
    const favorites = createCloudBaseFavoritesRepository(database as never, ids => ({ $in: ids }))
    const deletion = createCloudBaseDeleteRepository(database as never)
    await expect(favorites.insert('u1', ['before-delete'])).resolves.toMatchObject({ created: ['before-delete'] })

    await deletion.beginDeletion('u1')
    await deletion.deleteOwned('u1', PERSONAL_DATA_COLLECTIONS)
    await expect(favorites.insert('u1', ['after-empty-page'])).rejects.toMatchObject({ code: 'ACCOUNT_DELETING' })
    await deletion.finishDeletion('u1')

    expect(database.ownerRecords('u1')).toEqual([])
    await expect(favorites.insert('u1', ['new-account-favorite'])).resolves.toMatchObject({
      created: ['new-account-favorite'],
    })
    expect(database.ownerRecords('u1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'active' }),
      expect.objectContaining({ poiId: 'new-account-favorite' }),
    ]))
  })

  it('uses CloudBase context in the production entrypoint', async () => {
    const get = vi.fn().mockResolvedValue({ data: [] })
    const database = fakeDeleteDatabase(get, vi.fn())
    const sdk = {
      SYMBOL_CURRENT_ENV: Symbol('current'),
      init: vi.fn().mockReturnValue({ database: () => database }),
      getCloudbaseContext: vi.fn().mockReturnValue({ OPENID: 'context-user' }),
    }

    await expect(deleteMain({ owner: 'attacker' } as never, { requestId: 'r1' }, sdk as never)).resolves.toEqual({
      deleted: { favorites: 0, imports: 0, recommendation_events: 0, users: 0 },
    })
    expect(sdk.getCloudbaseContext).toHaveBeenCalledWith({ requestId: 'r1' })
    expect(database.collection).not.toHaveBeenCalledWith('places')
  })

  it('ships deployable CommonJS entrypoints for both cloud functions', () => {
    for (const name of ['share-place', 'delete-account']) {
      const packageRoot = resolve(process.cwd(), 'cloudfunctions', name)
      const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { main: string }
      const entry = resolve(packageRoot, manifest.main)
      expect(existsSync(entry)).toBe(true)
      expect(require(entry).main).toBeTypeOf('function')
    }
  })
})

function fakeDeleteDatabase(
  get: () => Promise<{ data: Array<{ _id: string }> }>,
  remove: (id: string) => Promise<void>,
) {
  return {
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      collection: () => ({
        doc: () => ({ get: async () => ({ data: [] }), set: async () => undefined, remove: async () => undefined }),
      }),
    }),
    collection: vi.fn((name: string) => ({
      where: vi.fn((query: Record<string, unknown>) => ({
        limit: vi.fn(() => ({ get })),
      })),
      doc: vi.fn((id: string) => ({ remove: () => remove(id) })),
      name,
    })),
  }
}

function accountLifecycleDatabase() {
  const names = ['favorites', 'imports', 'recommendation_events', 'users', 'places'] as const
  const records = Object.fromEntries(names.map(name => [name, new Map<string, Record<string, unknown>>()])) as
    Record<typeof names[number], Map<string, Record<string, unknown>>>
  let queue: Promise<unknown> = Promise.resolve()
  const doc = (name: typeof names[number], id: string) => ({
    get: async () => ({ data: records[name].has(id) ? [records[name].get(id)] : [] }),
    set: async ({ data }: { data: Record<string, unknown> }) => { records[name].set(id, data) },
    remove: async () => { records[name].delete(id) },
  })
  return {
    runTransaction<T>(callback: (transaction: { collection(name: typeof names[number]): { doc(id: string): ReturnType<typeof doc> } }) => Promise<T>) {
      const operation = queue.then(() => callback({ collection: name => ({ doc: id => doc(name, id) }) }))
      queue = operation.then(() => undefined, () => undefined)
      return operation
    },
    collection(name: typeof names[number]) {
      return {
        doc: (id: string) => doc(name, id),
        where(query: Record<string, unknown>) {
          const values = () => [...records[name].values()].filter(record => {
            const inValues = typeof query.poiId === 'object' && query.poiId !== null && '$in' in query.poiId
              ? (query.poiId as { $in: string[] }).$in : undefined
            return (!query._openid || record._openid === query._openid)
              && (!query.poiId || inValues?.includes(record.poiId as string) || record.poiId === query.poiId)
          })
          return {
            get: async () => ({ data: values() }),
            limit: (count: number) => ({ get: async () => ({ data: values().slice(0, count) }) }),
          }
        },
      }
    },
    ownerRecords(openid: string) {
      return names.flatMap(name => [...records[name].values()].filter(record => record._openid === openid))
    },
  }
}
