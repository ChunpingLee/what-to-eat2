import { expect, it, vi } from 'vitest'
import { createHomeController } from '../../miniprogram/pages/home/controller'

it('sorts returned favorites and exposes empty recommendation fallback', async () => {
  const api = { listFavorites: vi.fn().mockResolvedValue([]) }
  const controller = createHomeController(api)

  await expect(controller.load({ latitude: 31.23, longitude: 121.47 }, 5_000))
    .resolves.toMatchObject({ status: 'empty', showRecommend: true })
})

it('keeps the last successful items when refresh fails', async () => {
  const nearby = {
    poiId: 'near', name: '近店', location: { latitude: 31.231, longitude: 121.47 }, address: '近路', categories: ['餐饮'],
  }
  const api = { listFavorites: vi.fn().mockResolvedValueOnce([nearby]).mockRejectedValueOnce(new Error('network')) }
  const controller = createHomeController(api)

  await controller.load({ latitude: 31.23, longitude: 121.47 }, 5_000)

  await expect(controller.load({ latitude: 31.23, longitude: 121.47 }, 5_000))
    .resolves.toMatchObject({ status: 'error', items: [{ place: nearby }], showRecommend: true })
})

it('adds a direct POI id to every favorite card for stable rendering keys', async () => {
  const api = {
    listFavorites: vi.fn().mockResolvedValue([
      { poiId: 'near', name: '近店', location: { latitude: 31.231, longitude: 121.47 }, address: '近路', categories: ['餐饮'] },
    ]),
  }
  const controller = createHomeController(api)

  await expect(controller.load({ latitude: 31.23, longitude: 121.47 }, 5_000))
    .resolves.toMatchObject({
      items: [{ poiId: 'near', detailPath: '/pages/place-detail/index?v=1&poiId=near' }],
    })
})

it('pre-encodes the complete detail path instead of exposing a raw POI id to WXML', async () => {
  const poiId = 'poi/1 ?%&#'
  const api = {
    listFavorites: vi.fn().mockResolvedValue([
      { poiId, name: '特殊分店', location: { latitude: 31.231, longitude: 121.47 } },
    ]),
  }
  const controller = createHomeController(api)

  await expect(controller.load({ latitude: 31.23, longitude: 121.47 }, 5_000)).resolves.toMatchObject({
    items: [{ detailPath: '/pages/place-detail/index?v=1&poiId=poi%2F1%20%3F%25%26%23' }],
  })
})
