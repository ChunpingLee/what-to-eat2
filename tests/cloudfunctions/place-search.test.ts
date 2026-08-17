import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AmapTimeoutError, createAmapClient } from '../../cloudfunctions/place-search/amap-client'
import { createPlaceSearchService, createMemorySearchCache } from '../../cloudfunctions/place-search/cache'

const query = {
  keywords: ' 店 ',
  center: { latitude: 31.23, longitude: 121.47 },
  city: ' 上海 ',
  radiusMeters: 5_000,
}

describe('place search cloud function', () => {
  it('maps optional Amap fields without inventing values', async () => {
    const http = vi.fn().mockResolvedValue({
      pois: [{
        id: 'p1', name: '店', location: '121.47,31.23', address: '路 1 号',
        type: '餐饮服务;中餐厅', business_area: '', biz_ext: [], photos: [],
      }],
    })
    const result = await createAmapClient({ key: 'server-only', http }).search(query)

    expect(result[0]).toMatchObject({
      poiId: 'p1', name: '店', location: { latitude: 31.23, longitude: 121.47 },
      categories: ['餐饮服务', '中餐厅'], rating: undefined, averageCost: undefined,
      tags: undefined, photos: undefined, businessStatus: undefined,
    })
    expect(http).toHaveBeenCalledWith(expect.objectContaining({
      key: 'server-only', keywords: '店', city: '上海', location: '121.47,31.23', radius: 5_000,
    }))
  })

  it('uses a normalized cache key containing every query parameter', async () => {
    const client = { search: vi.fn().mockResolvedValue([{ poiId: 'p1', name: '店', location: query.center, address: '路 1 号', categories: [] }]) }
    const service = createPlaceSearchService({ client, cache: createMemorySearchCache(), now: () => 1_000_000 })

    const first = await service.searchPlaces(query)
    const second = await service.searchPlaces({ ...query, keywords: '店', city: '上海' })
    const differentRadius = await service.searchPlaces({ ...query, keywords: '店', city: '上海', radiusMeters: 3_000 })

    expect(first).toMatchObject({ stale: false, items: [{ poiId: 'p1' }] })
    expect(second).toEqual(first)
    expect(differentRadius.stale).toBe(false)
    expect(client.search).toHaveBeenCalledTimes(2)
  })

  it('returns an expired cache entry as stale only after an Amap timeout and within 24 hours', async () => {
    const cache = createMemorySearchCache()
    const cachedAt = 1_000_000 - 31 * 60 * 1_000
    await cache.set({
      key: cache.keyFor(query), cachedAt,
      result: { items: [{ poiId: 'cached', name: '旧店', location: query.center, address: '旧路', categories: [] }], sourceUpdatedAt: new Date(cachedAt).toISOString() },
    })
    const client = { search: vi.fn().mockRejectedValue(new AmapTimeoutError()) }
    const service = createPlaceSearchService({ client, cache, now: () => 1_000_000 })

    await expect(service.searchPlaces(query)).resolves.toMatchObject({ stale: true, items: [{ poiId: 'cached' }], sourceUpdatedAt: new Date(cachedAt).toISOString() })
  })

  it('does not use stale data for a timeout without an eligible cache entry', async () => {
    const client = { search: vi.fn().mockRejectedValue(new AmapTimeoutError()) }
    const service = createPlaceSearchService({ client, cache: createMemorySearchCache(), now: () => 1_000_000 })

    await expect(service.searchPlaces(query)).rejects.toMatchObject({ code: 'AMAP_TIMEOUT', message: 'Place search timed out' })
  })

  it('provides a deployable CloudBase entrypoint', () => {
    const packageRoot = resolve(process.cwd(), 'cloudfunctions/place-search')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { main: string }
    const entry = resolve(packageRoot, manifest.main)

    expect(existsSync(entry)).toBe(true)
    expect(require(entry).main).toBeTypeOf('function')
  })
})
