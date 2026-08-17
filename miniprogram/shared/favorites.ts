import { distanceMeters } from './geo'
import type { GeoPoint } from './types'

export interface Place {
  poiId: string
  name: string
  location: GeoPoint
  address?: string
  businessArea?: string
  categories?: string[]
  rating?: number
  averageCost?: number
  tags?: string[]
  photos?: string[]
  businessStatus?: string
}
export type FavoriteSource = 'search' | 'link' | 'recommendation' | 'share'
export interface Favorite { poiId: string; note?: string; source: FavoriteSource; createdAt: string }
export interface NearbyFavorite { place: Place; distanceMeters: number }

export function sortNearbyFavorites(places: Place[], center: GeoPoint, radiusMeters: number): NearbyFavorite[] {
  return places
    .map(place => ({ place, distanceMeters: distanceMeters(center, place.location) }))
    .filter(item => item.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.place.poiId.localeCompare(b.place.poiId))
}

export function planFavoriteBatch(selected: string[], existing: Set<string>) {
  const seen = new Set<string>()
  const toCreate: string[] = [], duplicateSelections: string[] = [], existingIds: string[] = []
  for (const poiId of selected) {
    if (seen.has(poiId)) { duplicateSelections.push(poiId); continue }
    seen.add(poiId)
    if (existing.has(poiId)) existingIds.push(poiId); else toCreate.push(poiId)
  }
  return { toCreate, existing: existingIds, duplicateSelections }
}
