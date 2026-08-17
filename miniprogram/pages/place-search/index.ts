import { distanceMeters } from '../../../src/domain/geo'
import type { GeoPoint } from '../../../src/shared/types'
import { applyBatchResult, type BranchItem, type FavoriteBatchResult } from '../../components/branch-picker/index'
import { addFavoriteBatch, listFavorites, searchPlaces, type PlaceSearchResult } from '../../services/cloud'
import type { Place } from '../../../src/domain/favorites'
import { chooseManualLocation, getCurrentLocation } from '../../services/location'

type SearchStatus = 'idle' | 'searching' | 'ready' | 'empty' | 'error'

interface PlaceSearchData {
  keywords: string
  city: string
  status: SearchStatus
  branches: BranchItem[]
  selectedPoiIds: string[]
  submitting: boolean
  errorMessage: string
  stale: boolean
}

interface InputEvent { detail: { value?: unknown } }
interface PickerEvent { detail: { poiIds?: unknown } }

interface PlaceSearchPage {
  data: PlaceSearchData
  setData(data: Partial<PlaceSearchData>): void
  onLoad(): void
  onKeywordInput(event: InputEvent): void
  onCityInput(event: InputEvent): void
  onSearch(): void
  onManualLocation(): void
  search(center: GeoPoint): Promise<void>
  onSelectionChange(event: PickerEvent): void
  onAddSelected(): Promise<void>
}

function textValue(value: unknown): string { return typeof value === 'string' ? value : '' }
function selectedIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function visibleError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '搜索或收藏失败，请重试'
}

export interface PlaceSearchQuery {
  keywords: string
  city: string
  center: GeoPoint
  radiusMeters: number
}

export interface PlaceSearchController {
  refreshFavorites(): Promise<Set<string>>
  search(query: PlaceSearchQuery): Promise<{ branches: BranchItem[]; stale: boolean } | undefined>
}

export function createPlaceSearchController(deps: {
  listFavorites(): Promise<Place[]>
  searchPlaces(query: PlaceSearchQuery): Promise<PlaceSearchResult>
}): PlaceSearchController {
  let latestRequestId = 0
  const refreshFavorites = async () => new Set((await deps.listFavorites()).map(place => place.poiId))

  return {
    refreshFavorites,
    async search(query) {
      const requestId = ++latestRequestId
      let existingPoiIds: Set<string>
      try {
        existingPoiIds = await refreshFavorites()
      } catch (error) {
        if (requestId !== latestRequestId) return undefined
        throw error
      }
      if (requestId !== latestRequestId) return undefined
      let result: PlaceSearchResult
      try {
        result = await deps.searchPlaces(query)
      } catch (error) {
        if (requestId !== latestRequestId) return undefined
        throw error
      }
      if (requestId !== latestRequestId) return undefined
      return {
        branches: result.items.map(place => ({
          ...place,
          distanceMeters: Math.round(distanceMeters(query.center, place.location)),
          ...(existingPoiIds.has(place.poiId) ? { status: 'existing' as const } : {}),
        })),
        stale: result.stale,
      }
    },
  }
}

const controller = createPlaceSearchController({ listFavorites, searchPlaces })

if (typeof Page === 'function') {
  Page<PlaceSearchPage>({
    data: {
      keywords: '', city: '', status: 'idle', branches: [], selectedPoiIds: [],
      submitting: false, errorMessage: '', stale: false,
    },

    onLoad(this: PlaceSearchPage) {
      void controller.refreshFavorites().catch(error => {
        if (this.data.status === 'idle') {
          this.setData({ status: 'error', errorMessage: `无法确认已有收藏：${visibleError(error)}` })
        }
      })
    },

    onKeywordInput(this: PlaceSearchPage, event: InputEvent) {
      this.setData({ keywords: textValue(event.detail.value) })
    },

    onCityInput(this: PlaceSearchPage, event: InputEvent) {
      this.setData({ city: textValue(event.detail.value) })
    },

    onSearch(this: PlaceSearchPage) {
      if (!this.data.keywords.trim() || !this.data.city.trim()) {
        this.setData({ status: 'error', errorMessage: '请填写餐厅名称和城市' })
        return
      }
      void getCurrentLocation().then(center => this.search(center)).catch(() => {
        this.setData({ status: 'error', errorMessage: '需要当前位置才能搜索附近分店' })
      })
    },

    onManualLocation(this: PlaceSearchPage) {
      if (!this.data.keywords.trim() || !this.data.city.trim()) {
        this.setData({ status: 'error', errorMessage: '请填写餐厅名称和城市' })
        return
      }
      void chooseManualLocation().then(center => this.search(center)).catch(() => {
        this.setData({ status: 'error', errorMessage: '未选择地点，无法搜索附近分店' })
      })
    },

    async search(this: PlaceSearchPage, center: GeoPoint) {
      this.setData({ status: 'searching', branches: [], selectedPoiIds: [], errorMessage: '', stale: false })
      try {
        const result = await controller.search({
          keywords: this.data.keywords.trim(), city: this.data.city.trim(), center, radiusMeters: 5_000,
        })
        if (!result) return
        const { branches } = result
        this.setData({ status: branches.length ? 'ready' : 'empty', branches, stale: result.stale })
      } catch (error) {
        this.setData({ status: 'error', errorMessage: visibleError(error) })
      }
    },

    onSelectionChange(this: PlaceSearchPage, event: PickerEvent) {
      const selectable = new Set(this.data.branches
        .filter(item => item.status !== 'created' && item.status !== 'existing')
        .map(item => item.poiId))
      this.setData({ selectedPoiIds: selectedIds(event.detail.poiIds).filter(poiId => selectable.has(poiId)) })
    },

    async onAddSelected(this: PlaceSearchPage) {
      if (this.data.submitting || this.data.selectedPoiIds.length === 0) return
      this.setData({ submitting: true, errorMessage: '' })
      try {
        const result = await addFavoriteBatch(this.data.selectedPoiIds)
        const branches = applyBatchResult(this.data.branches, result as FavoriteBatchResult)
        const completed = new Set([...result.created, ...result.existing])
        this.setData({
          branches,
          selectedPoiIds: this.data.selectedPoiIds.filter(poiId => !completed.has(poiId)),
        })
      } catch (error) {
        this.setData({ errorMessage: visibleError(error) })
      } finally {
        this.setData({ submitting: false })
      }
    },
  })
}
