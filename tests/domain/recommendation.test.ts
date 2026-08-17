import { describe, expect, it } from 'vitest'
import { rankRecommendations, type RecommendationCandidate, type RecommendationRequest } from '../../src/domain/recommendation'

const center = { latitude: 31.2304, longitude: 121.4737 }

function candidate(overrides: Omit<Partial<RecommendationCandidate>, 'place'> & { place?: Partial<RecommendationCandidate['place']> } = {}): RecommendationCandidate {
  const { place: placeOverrides, ...candidateOverrides } = overrides
  return {
    place: {
      poiId: 'hotpot',
      name: '麻辣火锅',
      location: center,
      ...placeOverrides,
    },
    distanceMeters: 0,
    ...candidateOverrides,
  }
}

const request: RecommendationRequest = {
  category: '火锅',
  keywords: '麻辣 牛肉',
  center,
  radiusMeters: 1_000,
  travelMode: 'walking',
  maxMinutes: 10,
  budget: { min: 60, max: 100 },
}

describe('rankRecommendations', () => {
  it('combines every available signal with the specified weights', () => {
    const [result] = rankRecommendations([candidate({
      travelMinutes: 0,
      place: {
        categories: ['火锅'], tags: ['麻辣', '牛肉'], rating: 5, averageCost: 80,
        address: '静安路 1 号', photos: ['https://example.com/hotpot.jpg'],
      },
    })], request)

    expect(result.score).toBe(100)
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('火锅'),
      expect.stringContaining('0 分钟'),
      expect.stringContaining('5'),
      expect.stringContaining('80'),
    ]))
    expect(result.reasons.some(reason => reason.includes('完整'))).toBe(false)
  })

  it('renormalizes weights when rating and cost are absent', () => {
    const [result] = rankRecommendations([candidate({
      distanceMeters: 500,
      place: { categories: ['火锅'] },
    })], request)

    expect(result.score).toBe(72.62)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.reasons.join('')).not.toContain('评分')
    expect(result.reasons.join('')).not.toContain('预算')
  })

  it('does not make absent preference, rating, or budget fields count as zero-valued signals', () => {
    const [result] = rankRecommendations([candidate({ distanceMeters: 0 })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
    })

    expect(result.score).toBe(100)
    expect(result.reasons).toEqual([expect.stringContaining('0 米')])
  })

  it('uses an actual route duration in place of straight-line distance', () => {
    const [result] = rankRecommendations([candidate({ distanceMeters: 0, travelMinutes: 6 })], {
      ...request,
      random: true,
      budget: undefined,
    })

    expect(result.score).toBe(40)
    expect(result.reasons).toEqual([expect.stringContaining('6 分钟')])
  })

  it('scores budget boundaries linearly outside the requested range', () => {
    const results = rankRecommendations([
      candidate({ place: { poiId: 'inside', averageCost: 80 } }),
      candidate({ place: { poiId: 'just-over', averageCost: 110 } }),
      candidate({ place: { poiId: 'far-over', averageCost: 160 } }),
    ], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
      budget: { min: 60, max: 100 },
    })

    expect(results.map(result => [result.place.poiId, result.score])).toEqual([
      ['inside', 90.74],
      ['just-over', 85.19],
      ['far-over', 68.52],
    ])
    expect(results[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining('80')]))
    expect(results[1].reasons.join('')).not.toContain('预算')
  })

  it('only produces preference reasons for a sufficiently strong real match', () => {
    const [result] = rankRecommendations([candidate({
      place: { name: '香辣川菜', categories: ['川菜'] },
    })], request)

    expect(result.reasons.join('')).not.toContain('匹配')
  })

  it('gives all exact keyword tokens the full preference score', () => {
    const [result] = rankRecommendations([candidate({
      distanceMeters: 1_000,
      place: { tags: ['麻辣', '牛肉'] },
    })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
      keywords: '麻辣 牛肉',
    })

    expect(result.score).toBe(51.19)
    expect(result.reasons).toEqual([expect.stringContaining('麻辣 牛肉')])
  })

  it('uses the lower full-substring score when keywords are not exact tokens', () => {
    const [result] = rankRecommendations([candidate({
      distanceMeters: 1_000,
      place: { name: '麻辣牛肉锅' },
    })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
      keywords: '麻辣 牛肉',
    })

    expect(result.score).toBe(43.08)
    expect(result.reasons).toEqual([expect.stringContaining('麻辣 牛肉')])
  })

  it('does not generate a preference reason for a partial keyword match', () => {
    const [result] = rankRecommendations([candidate({
      distanceMeters: 1_000,
      place: { name: '麻辣锅' },
    })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
      keywords: '麻辣 牛肉',
    })

    expect(result.score).toBe(21.54)
    expect(result.reasons).toEqual([])
  })

  it('does not turn a whitespace category into a preference match when keywords miss', () => {
    const [result] = rankRecommendations([candidate({ distanceMeters: 0 })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
      category: '   ',
      keywords: '未命中',
    })

    expect(result.score).toBe(46.15)
    expect(result.reasons).toEqual([expect.stringContaining('0 米')])
  })

  it('lets a matching keyword alone determine the preference when category is whitespace', () => {
    const [result] = rankRecommendations([candidate({
      distanceMeters: 1_000,
      place: { tags: ['牛肉'] },
    })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
      category: '   ',
      keywords: '牛肉',
    })

    expect(result.score).toBe(51.19)
    expect(result.reasons).toEqual([expect.stringContaining('牛肉')])
  })

  it('deduplicates normalized keywords before calculating a partial-match score', () => {
    const candidateWithOneKeyword = candidate({
      distanceMeters: 1_000,
      place: { tags: ['麻辣'] },
    })
    const baseRequest = { center, radiusMeters: 1_000, travelMode: 'walking' as const }

    const [unique] = rankRecommendations([candidateWithOneKeyword], { ...baseRequest, keywords: '麻辣 牛肉' })
    const [repeated] = rankRecommendations([candidateWithOneKeyword], { ...baseRequest, keywords: '麻辣 麻辣 牛肉' })

    expect(repeated.score).toBe(21.19)
    expect(repeated).toEqual(unique)
  })

  it.each([NaN, Infinity, -1])('rejects invalid candidate distanceMeters: %s', distanceMeters => {
    expect(() => rankRecommendations([candidate({ distanceMeters })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
    })).toThrow('Invalid candidate distanceMeters for hotpot')
  })

  it.each([NaN, Infinity, -1])('rejects invalid candidate travelMinutes: %s', travelMinutes => {
    expect(() => rankRecommendations([candidate({ travelMinutes })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
    })).toThrow('Invalid candidate travelMinutes for hotpot')
  })

  it('does not cite unmatched keywords when an exact category was the signal', () => {
    const [result] = rankRecommendations([candidate({
      distanceMeters: 1_000,
      place: { categories: ['火锅'] },
    })], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
      category: '火锅',
      keywords: '牛肉',
    })

    expect(result.score).toBe(51.19)
    expect(result.reasons).toEqual([expect.stringContaining('火锅')])
    expect(result.reasons.join('')).not.toContain('牛肉')
  })

  it('does not filter places whose business status is unknown', () => {
    const results = rankRecommendations([
      candidate({ place: { poiId: 'unknown-status', businessStatus: undefined } }),
      candidate({ place: { poiId: 'open-status', businessStatus: '营业中' } }),
    ], { ...request, random: true, budget: undefined })

    expect(results.map(result => result.place.poiId)).toEqual(['open-status', 'unknown-status'])
  })

  it('breaks score ties by distance, rating, then poi id', () => {
    const results = rankRecommendations([
      candidate({ distanceMeters: 133.33333333333334, place: { poiId: 'far-b', rating: 5 } }),
      candidate({ distanceMeters: 133.33333333333334, place: { poiId: 'far-a', rating: 5 } }),
      candidate({ distanceMeters: 0, place: { poiId: 'near', rating: 4 } }),
    ], {
      center,
      radiusMeters: 1_000,
      travelMode: 'walking',
    })

    expect(results.map(result => result.place.poiId)).toEqual(['near', 'far-a', 'far-b'])
  })
})
