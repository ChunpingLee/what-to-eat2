import { describe, expect, it, vi } from 'vitest'
import { createPlaceSearchController, searchPrefill } from '../../miniprogram/pages/place-search/index'

const center = { latitude: 31.23, longitude: 121.47 }
const query = { keywords: '连锁店', city: '上海', center, radiusMeters: 5_000 }

describe('place search controller', () => {
  it('prefills decoded link-import keywords and city without trusting non-string query values', () => {
    expect(searchPrefill({ keywords: '%E7%A4%BA%E4%BE%8B%E7%81%AB%E9%94%85', city: '%E4%B8%8A%E6%B5%B7' }))
      .toEqual({ keywords: '示例火锅', city: '上海' })
    expect(searchPrefill({ keywords: '100%火锅', city: '上海' })).toEqual({ keywords: '100%火锅', city: '上海' })
    expect(searchPrefill({ keywords: ['unexpected'], city: undefined })).toEqual({ keywords: '', city: '' })
  })

  it('marks historical favorites as existing before they can be selected', async () => {
    const listFavorites = vi.fn().mockResolvedValue([{ poiId: 'old', name: '旧分店', location: center }])
    const searchPlaces = vi.fn().mockResolvedValue({
      items: [{ poiId: 'old', name: '旧分店', location: center }, { poiId: 'new', name: '新分店', location: center }],
      stale: false, sourceUpdatedAt: '2026-08-17T00:00:00.000Z',
    })
    const controller = createPlaceSearchController({ listFavorites, searchPlaces })

    await expect(controller.search(query)).resolves.toMatchObject({
      branches: [{ poiId: 'old', status: 'existing' }, { poiId: 'new' }],
    })
    expect(listFavorites).toHaveBeenCalledOnce()
    expect(searchPlaces).toHaveBeenCalledWith(query)
  })

  it('stops safely when the existing-favorites refresh fails', async () => {
    const listFavorites = vi.fn().mockRejectedValue(new Error('favorites unavailable'))
    const searchPlaces = vi.fn()
    const controller = createPlaceSearchController({ listFavorites, searchPlaces })

    await expect(controller.search(query)).rejects.toThrow('favorites unavailable')
    expect(searchPlaces).not.toHaveBeenCalled()
  })

  it('ignores an older search response that completes after the latest request', async () => {
    type SearchResult = { items: Array<{ poiId: string; name: string; location: typeof center }>; stale: boolean; sourceUpdatedAt: string }
    let resolveFirst!: (value: SearchResult) => void
    let resolveSecond!: (value: SearchResult) => void
    const first = new Promise<SearchResult>(resolve => { resolveFirst = resolve })
    const second = new Promise<SearchResult>(resolve => { resolveSecond = resolve })
    const searchPlaces = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const controller = createPlaceSearchController({ listFavorites: vi.fn().mockResolvedValue([]), searchPlaces })

    const older = controller.search(query)
    await vi.waitFor(() => expect(searchPlaces).toHaveBeenCalledTimes(1))
    const newer = controller.search({ ...query, keywords: '新查询' })
    await vi.waitFor(() => expect(searchPlaces).toHaveBeenCalledTimes(2))
    resolveSecond({ items: [{ poiId: 'new', name: '新结果', location: center }], stale: false, sourceUpdatedAt: 'now' })
    await expect(newer).resolves.toMatchObject({ branches: [{ poiId: 'new' }] })
    resolveFirst({ items: [{ poiId: 'old', name: '旧结果', location: center }], stale: false, sourceUpdatedAt: 'then' })
    await expect(older).resolves.toBeUndefined()
  })

  it('cancels an earlier delayed location intent before it can call place search', async () => {
    let resolveCurrent!: (value: typeof center) => void
    let resolveManual!: (value: typeof center) => void
    const currentLocation = new Promise<typeof center>(resolve => { resolveCurrent = resolve })
    const manualLocation = new Promise<typeof center>(resolve => { resolveManual = resolve })
    const searchPlaces = vi.fn().mockResolvedValue({ items: [{ poiId: 'manual', name: '手选结果', location: center }], stale: false, sourceUpdatedAt: 'now' })
    const controller = createPlaceSearchController({ listFavorites: vi.fn().mockResolvedValue([]), searchPlaces })

    const firstIntent = controller.beginIntent()
    const earlier = controller.locateAndSearch(firstIntent, { keywords: 'A', city: '上海', radiusMeters: 5_000 }, () => currentLocation)
    const secondIntent = controller.beginIntent()
    const later = controller.locateAndSearch(secondIntent, { keywords: 'B', city: '上海', radiusMeters: 3_000 }, () => manualLocation)

    resolveManual(center)
    await expect(later).resolves.toMatchObject({ branches: [{ poiId: 'manual' }] })
    resolveCurrent(center)
    await expect(earlier).resolves.toBeUndefined()
    expect(searchPlaces).toHaveBeenCalledTimes(1)
    expect(searchPlaces).toHaveBeenCalledWith({ keywords: 'B', city: '上海', center, radiusMeters: 3_000 })
  })
})
