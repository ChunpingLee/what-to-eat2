import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFavoritesHandler } from '../../cloudfunctions/favorites/index'
import { createCloudBaseFavoritesRepository } from '../../cloudfunctions/favorites/repository'

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
      list: vi.fn().mockResolvedValue([]),
      findExisting: vi.fn(),
      insert: vi.fn(),
      remove: vi.fn(),
    }
    const handler = createFavoritesHandler({ getOpenId: () => 'trusted-user', repo })

    await expect(handler({ action: 'list', openid: 'attacker' } as never)).resolves.toEqual({ items: [] })
    expect(repo.list).toHaveBeenCalledWith('trusted-user')
  })

  it('adds multiple branches and reports existing records', async () => {
    const repo = {
      list: vi.fn(),
      findExisting: vi.fn().mockResolvedValue(new Set(['p2'])),
      insert: vi.fn().mockResolvedValue({ created: ['p1'], existing: [] }),
      remove: vi.fn(),
    }
    const handler = createFavoritesHandler({ getOpenId: () => 'u1', repo })

    await expect(handler({ action: 'addBatch', poiIds: ['p1', 'p2', 'p1'] })).resolves.toEqual({
      created: ['p1'],
      existing: ['p2'],
      duplicateSelections: ['p1'],
    })
    expect(repo.findExisting).toHaveBeenCalledWith('u1', ['p1', 'p2', 'p1'])
    expect(repo.insert).toHaveBeenCalledWith('u1', ['p1'])
  })

  it('queries existing favorites by owner and poiId before inserting', async () => {
    const where = vi.fn().mockReturnThis()
    const get = vi.fn().mockResolvedValue({ data: [{ poiId: 'p2' }] })
    const add = vi.fn().mockResolvedValue(undefined)
    const collection = vi.fn().mockReturnValue({ where, get, add })
    const repo = createCloudBaseFavoritesRepository({ collection })

    await expect(repo.findExisting('u1', ['p1', 'p2'])).resolves.toEqual(new Set(['p2']))
    await repo.insert('u1', ['p1'])

    expect(where).toHaveBeenCalledWith({ _openid: 'u1', poiId: { $in: ['p1', 'p2'] } })
    expect(add).toHaveBeenCalledWith({
      data: { _id: '5a703d644abc1f2d890a19dc6090521e39ca583e7bd98ca41a896d974188f278', poiId: 'p1', _openid: 'u1' },
    })
  })

  it('atomically classifies one of two concurrent additions as existing', async () => {
    const records = new Map<string, { _id: string; poiId: string; _openid: string }>()
    const collection = () => ({
      where: (query: Record<string, unknown>) => ({
        get: async () => ({
          data: [...records.values()].filter(record => record._openid === query._openid && record.poiId === query.poiId),
        }),
        remove: async () => undefined,
      }),
      add: async ({ data }: { data: { _id: string; poiId: string; _openid: string } }) => {
        if (records.has(data._id)) throw { code: 'DATABASE_DUPLICATE_WRITE' }
        records.set(data._id, data)
      },
    })
    const repo = createCloudBaseFavoritesRepository({ collection } as never)
    const handler = createFavoritesHandler({ getOpenId: () => 'u1', repo })

    const results = await Promise.all([
      handler({ action: 'addBatch', poiIds: ['p1'] }),
      handler({ action: 'addBatch', poiIds: ['p1'] }),
    ])

    expect(records.size).toBe(1)
    expect(results.flatMap(result => result.created)).toEqual(['p1'])
    expect(results.flatMap(result => result.existing)).toEqual(['p1'])
  })
})
