import { describe, expect, it } from 'vitest'
import { planFavoriteBatch, sortNearbyFavorites } from '../../src/domain/favorites'

const center = { latitude: 31.2304, longitude: 121.4737 }
const places = [
  { poiId: 'far', name: '同名店（远店）', location: { latitude: 31.2504, longitude: 121.4737 }, address: '远路 2 号', categories: ['餐饮'] },
  { poiId: 'near', name: '同名店（近店）', location: { latitude: 31.2314, longitude: 121.4737 }, address: '近路 1 号', categories: ['餐饮'] },
]

describe('favorites', () => {
  it('sorts favorites strictly nearest first', () => {
    expect(sortNearbyFavorites(places, center, 5_000).map(item => item.place.poiId)).toEqual(['near', 'far'])
  })

  it('separates new, existing and duplicate selections', () => {
    expect(planFavoriteBatch(['near', 'far', 'near'], new Set(['far']))).toEqual({ toCreate: ['near'], existing: ['far'], duplicateSelections: ['near'] })
  })
})
