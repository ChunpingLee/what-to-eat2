import { describe, expect, it } from 'vitest'
import { distanceMeters } from '../../src/domain/geo'

describe('distanceMeters', () => {
  it('returns zero for the same point', () => {
    expect(distanceMeters({ latitude: 31.2304, longitude: 121.4737 }, { latitude: 31.2304, longitude: 121.4737 })).toBe(0)
  })

  it('calculates a stable great-circle distance', () => {
    const meters = distanceMeters(
      { latitude: 31.2304, longitude: 121.4737 },
      { latitude: 31.2243, longitude: 121.4768 },
    )
    expect(meters).toBeGreaterThan(700)
    expect(meters).toBeLessThan(800)
  })
})
