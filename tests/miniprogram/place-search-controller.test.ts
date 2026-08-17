import { describe, expect, it, vi } from 'vitest'
import { createPlaceSearchController } from '../../miniprogram/pages/place-search/index'

const center = { latitude: 31.23, longitude: 121.47 }
const query = { keywords: '连锁店', city: '上海', center, radiusMeters: 5_000 }

describe('place search controller', () => {
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
})
