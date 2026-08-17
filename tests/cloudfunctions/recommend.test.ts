import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Place } from '../../src/domain/favorites'
import type { RecommendationRequest } from '../../src/domain/recommendation'
import {
  createRecommendHandler,
  createLazyRouteTimesClient,
  type RecommendationSearchClient,
  type RouteTimesClient,
} from '../../cloudfunctions/recommend/index'
import { createAmapRouteHttp, createAmapRoutesClient } from '../../cloudfunctions/place-routes/amap-routes'
import { createAmapClient, createAmapHttp } from '../../cloudfunctions/place-search/amap-client'
import {
  buildRecommendationInput,
  createRecommendationController,
  createRecommendationSubmitter,
} from '../../miniprogram/pages/recommend/index'
import { FIXED_RESTAURANT_CATEGORIES } from '../../src/domain/restaurant-categories'

const unlimitedLimiter = { acquire: vi.fn().mockResolvedValue(undefined) }

const center = { latitude: 31.23, longitude: 121.47 }
const request: RecommendationRequest = {
  category: '火锅', random: false, center, radiusMeters: 5_000,
  travelMode: 'walking', maxMinutes: 20, budget: { max: 120 },
}

function place(index: number, overrides: Partial<Place> = {}): Place {
  return {
    poiId: `p${String(index).padStart(2, '0')}`,
    name: `火锅店 ${index}`,
    location: { latitude: center.latitude + index * 0.0001, longitude: center.longitude },
    categories: ['餐饮服务', '火锅'],
    rating: 4.5,
    averageCost: 80,
    businessStatus: '营业中',
    ...overrides,
  }
}

function dependencies(items: Place[], travelMinutes: Array<number | undefined> = items.map(() => 10)) {
  const searchClient: RecommendationSearchClient = {
    search: vi.fn().mockResolvedValue({ items, sourceUpdatedAt: '2026-08-17T00:00:00.000Z', stale: false }),
  }
  const routeClient: RouteTimesClient = { times: vi.fn().mockResolvedValue(travelMinutes) }
  return { searchClient, routeClient }
}

describe('recommend cloud function', () => {
  it('pre-ranks by distance and quality before requesting routes for at most twenty candidates', async () => {
    const places = Array.from({ length: 30 }, (_, index) => place(index + 1)).reverse()
    const deps = dependencies(places, Array.from({ length: 20 }, () => 10))

    await createRecommendHandler(deps)(request)

    expect(deps.routeClient.times).toHaveBeenCalledOnce()
    expect(deps.routeClient.times).toHaveBeenCalledWith(
      center,
      Array.from({ length: 20 }, (_, index) => place(index + 1).location),
      'walking',
    )
  })

  it('hard-filters radius, preference and budget before routing', async () => {
    const inRange = place(1)
    const deps = dependencies([
      inRange,
      place(2, { categories: ['餐饮服务', '烧烤'], name: '烧烤店' }),
      place(3, { averageCost: 121 }),
      place(4, { averageCost: undefined }),
      place(6, { location: { latitude: 32, longitude: 121.47 } }),
    ], [10])

    const result = await createRecommendHandler(deps)(request)

    expect(result.items.map(item => item.place.poiId)).toEqual([inRange.poiId])
    expect(deps.routeClient.times).toHaveBeenCalledWith(center, [inRange.location], 'walking')
  })

  it('does not filter on undocumented or unprovenanced business status values', async () => {
    const deps = dependencies([
      place(1, { businessStatus: '暂停营业' }),
      place(2, { businessStatus: '0' }),
      place(3, { businessStatus: undefined }),
    ], [10, 10, 10])

    const result = await createRecommendHandler(deps)(request)

    expect(result.items.map(item => item.place.poiId)).toEqual(['p01', 'p02', 'p03'])
  })

  it.each(FIXED_RESTAURANT_CATEGORIES)('uses shared aliases and search keyword for $label', async category => {
    const alias = category.aliases.find(value => value !== category.label) ?? category.aliases[0]
    const candidate = place(1, { name: `${alias}示例店`, categories: ['餐饮服务', alias], tags: [] })
    const deps = dependencies([candidate], [10])

    const result = await createRecommendHandler(deps)({ ...request, category: category.id })

    expect(result.items.map(item => item.place.poiId)).toEqual(['p01'])
    expect(deps.searchClient.search).toHaveBeenCalledWith(expect.objectContaining({ keywords: category.searchKeyword }))
    expect(result.items[0].reasons.join('')).toContain(category.label)
  })

  it('applies max minutes only to successful route times and keeps partial failures as unavailable', async () => {
    const deps = dependencies([place(1), place(2), place(3)], [12, undefined, 25])

    const result = await createRecommendHandler(deps)(request)

    expect(result.items).toHaveLength(2)
    expect(result.items.find(item => item.place.poiId === 'p01')).toMatchObject({
      travelMinutes: 12, travelTimeUnavailable: false,
    })
    expect(result.items.find(item => item.place.poiId === 'p02')).toMatchObject({
      travelTimeUnavailable: true,
    })
    expect(result.items.find(item => item.place.poiId === 'p02')).not.toHaveProperty('travelMinutes')
    expect(result.items.map(item => item.place.poiId)).not.toContain('p03')
  })

  it('keeps distance results and never claims the time limit passed when the route request fails', async () => {
    const deps = dependencies([place(1), place(2)])
    vi.mocked(deps.routeClient.times).mockRejectedValue(new Error('upstream timeout: secret response'))

    const result = await createRecommendHandler(deps)(request)

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ travelTimeUnavailable: true })
    expect(result.items[0]).not.toHaveProperty('travelMinutes')
  })

  it('defers route client construction so missing route configuration uses the distance fallback', async () => {
    const deps = dependencies([place(1)])
    deps.routeClient = createLazyRouteTimesClient(() => {
      throw new Error('route key missing')
    })

    await expect(createRecommendHandler(deps)(request)).resolves.toMatchObject({
      items: [{ place: { poiId: 'p01' }, travelTimeUnavailable: true }],
    })
  })

  it.each([
    { count: 0, expected: 0 },
    { count: 2, expected: 2 },
    { count: 14, expected: 10 },
  ])('returns $expected results for $count eligible candidates', async ({ count, expected }) => {
    const candidates = Array.from({ length: count }, (_, index) => place(index + 1))
    const deps = dependencies(candidates, candidates.slice(0, 20).map(() => 10))

    const result = await createRecommendHandler(deps)(request)

    expect(result.items).toHaveLength(expected)
    if (count === 0) expect(deps.routeClient.times).not.toHaveBeenCalled()
  })

  it('returns the same order for the same input, including random mode', async () => {
    const candidates = [place(3), place(1), place(2)]
    const deps = dependencies(candidates, [10, 10, 10])
    const handler = createRecommendHandler(deps)
    const randomRequest = { ...request, category: undefined, random: true }

    const first = await handler(randomRequest)
    const second = await handler(randomRequest)

    expect(second.items.map(item => item.place.poiId)).toEqual(first.items.map(item => item.place.poiId))
    expect(deps.searchClient.search).toHaveBeenCalledWith(expect.objectContaining({ keywords: '餐饮服务' }))
  })

  it('rejects requests that have no preference mode or use invalid filters before external calls', async () => {
    const deps = dependencies([])
    const handler = createRecommendHandler(deps)

    await expect(handler({ ...request, category: undefined, random: false })).rejects.toMatchObject({
      code: 'INVALID_RECOMMENDATION_REQUEST', message: '推荐条件无效',
    })
    await expect(handler({ ...request, radiusMeters: 0 })).rejects.toMatchObject({
      code: 'INVALID_RECOMMENDATION_REQUEST', message: '推荐条件无效',
    })
    expect(deps.searchClient.search).not.toHaveBeenCalled()
  })
})

describe('Amap route client', () => {
  it('maps walking, bicycling and driving to their real endpoints and rounds seconds up to minutes', async () => {
    const fetcher = vi.fn().mockImplementation(async (input: string) => {
      return { ok: true, json: async () => ({ status: '1', route: { paths: [{ cost: { duration: '601' } }] } }) }
    })
    const client = createAmapRoutesClient({ key: 'server-only', http: createAmapRouteHttp(fetcher as never), limiter: unlimitedLimiter })

    await expect(client.times(center, [place(1).location], 'walking')).resolves.toEqual([11])
    await expect(client.times(center, [place(1).location], 'bicycling')).resolves.toEqual([11])
    await expect(client.times(center, [place(1).location], 'driving')).resolves.toEqual([11])

    expect(fetcher.mock.calls.map(call => new URL(call[0] as string).pathname)).toEqual([
      '/v5/direction/walking', '/v5/direction/bicycling', '/v5/direction/driving',
    ])
    for (const [input] of fetcher.mock.calls) {
      const params = new URL(input as string).searchParams
      expect(params.get('key')).toBe('server-only')
      expect(params.get('origin')).toBe('121.47,31.23')
      expect(params.get('destination')).toBe('121.47,31.2301')
      expect(params.get('show_fields')).toBe('cost')
    }
  })

  it('represents one failed destination as unavailable without discarding successful routes', async () => {
    const http = vi.fn()
      .mockResolvedValueOnce({ status: '1', route: { paths: [{ cost: { duration: '60' } }] } })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ status: '1', route: { paths: [{ cost: { duration: '120' } }] } })
    const client = createAmapRoutesClient({ key: 'server-only', http, limiter: unlimitedLimiter })

    await expect(client.times(center, [place(1).location, place(2).location, place(3).location], 'walking'))
      .resolves.toEqual([1, undefined, 2])
  })

  it('throws a safe error without upstream details when every destination fails', async () => {
    const client = createAmapRoutesClient({
      key: 'server-only',
      http: vi.fn().mockResolvedValue({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }),
      limiter: unlimitedLimiter,
    })

    await expect(client.times(center, [place(1).location], 'walking')).rejects.toMatchObject({
      code: 'AMAP_ROUTES_UNAVAILABLE', message: '路线时间暂时无法计算',
    })
    await expect(client.times(center, [place(1).location], 'walking')).rejects.not.toThrow('INVALID_USER_KEY')
  })
})

describe('recommendation place search adapter', () => {
  it('supports coordinate-only nearby search without sending an invalid empty region restriction', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: '1', pois: [] }) })
    const client = createAmapClient({ key: 'server-only', http: createAmapHttp(fetcher as never) })

    await client.search({ keywords: '餐饮服务', center, city: '', radiusMeters: 5_000 })

    const params = new URL(fetcher.mock.calls[0][0] as string).searchParams
    expect(params.has('region')).toBe(false)
    expect(params.has('city_limit')).toBe(false)
    expect(params.get('page_size')).toBe('25')
  })

  it('ships coordinate-only search and twenty-five candidates in the deployable place-search build', async () => {
    const compiledPath = resolve(process.cwd(), 'cloudfunctions/place-search/dist/cloudfunctions/place-search/amap-client.js')
    const compiled = require(compiledPath) as typeof import('../../cloudfunctions/place-search/amap-client')
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: '1', pois: [] }) })
    const client = compiled.createAmapClient({ key: 'server-only', http: compiled.createAmapHttp(fetcher as never) })

    await client.search({ keywords: '餐饮服务', center, city: '', radiusMeters: 5_000 })

    const params = new URL(fetcher.mock.calls[0][0] as string).searchParams
    expect(params.has('region')).toBe(false)
    expect(params.has('city_limit')).toBe(false)
    expect(params.get('page_size')).toBe('25')
  })
})

describe('recommendation page contract', () => {
  const root = join(__dirname, '../..')
  const read = (path: string) => readFileSync(join(root, path), 'utf8')

  it('exposes every recommendation filter, explicit unavailable-time state, favorite and navigation actions', () => {
    const page = read('miniprogram/pages/recommend/index.wxml')
    const script = read('miniprogram/pages/recommend/index.ts')
    const cloud = read('miniprogram/services/cloud.ts')

    expect(page).toContain('固定品类')
    expect(page).toContain('任意关键词')
    expect(page).toContain('随便吃')
    expect(page).toContain('预算')
    expect(script).toContain('[1_000, 3_000, 5_000, 10_000]')
    expect(script).toContain('`${value / 1_000} 公里`')
    expect(script).toContain("{ label: '步行', value: 'walking' }")
    expect(script).toContain("{ label: '骑行', value: 'bicycling' }")
    expect(script).toContain("{ label: '驾车', value: 'driving' }")
    expect(page).toContain('最长时间')
    expect(page).toContain('出行时间未计算')
    expect(page).toContain('wx:for="{{item.reasons}}"')
    expect(page).toContain('bindtap="onAddFavorite"')
    expect(page).toContain('bindtap="onOpenLocation"')
    expect(page).toContain('bindtap="onManualLocation"')
    expect(page).toContain('wx:key="poiId"')
    expect(script).toContain('chooseManualLocation')
    expect(script).toContain('FIXED_RESTAURANT_CATEGORIES')
    expect(page).toContain('disabled="{{status === \'loading\'}}"')
    expect(cloud).toContain("name: 'recommend'")
  })

  it('keeps expressions legal for WXML and keeps the Amap key out of the mini-program package', () => {
    const page = read('miniprogram/pages/recommend/index.wxml')
    const clientBundle = [
      read('miniprogram/pages/recommend/index.ts'), page, read('miniprogram/services/cloud.ts'),
    ].join('\n')

    expect(page).not.toMatch(/\.(includes|map|filter|find)\s*\(/)
    expect(page).not.toMatch(/=>/)
    expect(clientBundle).not.toContain('AMAP_WEB_KEY')
    expect(clientBundle).not.toContain('restapi.amap.com')
  })
})

describe('recommendation page controller', () => {
  const result = {
    items: [], stale: false, sourceUpdatedAt: '2026-08-17T00:00:00.000Z',
  }
  const input = {
    category: '火锅', random: false, radiusMeters: 5_000,
    travelMode: 'walking' as const, maxMinutes: 30,
  }

  it('ignores an older recommendation response that completes after the latest intent', async () => {
    let resolveFirst!: (value: typeof result) => void
    let resolveSecond!: (value: typeof result) => void
    const first = new Promise<typeof result>(resolve => { resolveFirst = resolve })
    const second = new Promise<typeof result>(resolve => { resolveSecond = resolve })
    const recommend = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const controller = createRecommendationController({ recommendPlaces: recommend })

    const olderIntent = controller.beginIntent()
    const older = controller.locateAndRecommend(olderIntent, input, async () => center)
    await vi.waitFor(() => expect(recommend).toHaveBeenCalledTimes(1))
    const newerIntent = controller.beginIntent()
    const newer = controller.locateAndRecommend(newerIntent, { ...input, category: '烧烤' }, async () => center)
    await vi.waitFor(() => expect(recommend).toHaveBeenCalledTimes(2))
    resolveSecond(result)
    await expect(newer).resolves.toMatchObject({ status: 'success', result })
    resolveFirst(result)
    await expect(older).resolves.toBeUndefined()
  })

  it('ignores an older location failure after a newer request succeeds', async () => {
    let rejectOldLocation!: (error: Error) => void
    const oldLocation = new Promise<typeof center>((_resolve, reject) => { rejectOldLocation = reject })
    const recommend = vi.fn().mockResolvedValue(result)
    const controller = createRecommendationController({ recommendPlaces: recommend })

    const older = controller.locateAndRecommend(controller.beginIntent(), input, () => oldLocation)
    const newer = controller.locateAndRecommend(controller.beginIntent(), input, async () => center)
    await expect(newer).resolves.toMatchObject({ status: 'success' })
    rejectOldLocation(new Error('permission denied'))
    await expect(older).resolves.toBeUndefined()
  })

  it('snapshots the selected filters before asynchronous location starts', () => {
    const form = {
      preferenceMode: 'category' as const, category: '火锅', keywords: '', budgetMin: '', budgetMax: '120',
      maxMinutes: '30', radiusMeters: 5_000, travelMode: 'walking' as const,
    }
    const snapshot = buildRecommendationInput(form)
    form.category = '烧烤'
    form.budgetMax = '300'
    form.radiusMeters = 10_000

    expect(snapshot).toEqual({
      category: '火锅', random: false, budget: { min: undefined, max: 120 },
      maxMinutes: 30, radiusMeters: 5_000, travelMode: 'walking',
    })
  })

  it('allows only one cloud invocation while a submit is pending', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const callCloud = vi.fn().mockReturnValue(pending)
    const submitter = createRecommendationSubmitter()

    const first = submitter.run(callCloud)
    const duplicate = submitter.run(callCloud)

    expect(callCloud).toHaveBeenCalledOnce()
    await expect(duplicate).resolves.toBeUndefined()
    finish()
    await first
    await submitter.run(callCloud)
    expect(callCloud).toHaveBeenCalledTimes(2)
  })
})
