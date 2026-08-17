import type { GeoPoint } from '../../src/shared/types'

function toGeoPoint(location: { latitude: number; longitude: number }): GeoPoint {
  return { latitude: location.latitude, longitude: location.longitude }
}

export function getCurrentLocation(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: location => resolve(toGeoPoint(location)),
      fail: reject,
    })
  })
}

export function chooseManualLocation(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    wx.chooseLocation({
      success: location => resolve(toGeoPoint(location)),
      fail: reject,
    })
  })
}
