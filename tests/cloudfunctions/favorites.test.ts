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
      insert: vi.fn().mockResolvedValue(undefined),
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
    expect(add).toHaveBeenCalledWith({ data: { poiId: 'p1', _openid: 'u1' } })
  })
})
