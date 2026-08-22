import { distanceMeters } from '../../shared/geo'
import type { GeoPoint } from '../../shared/types'
import { applyBatchResult, type BranchItem, type FavoriteBatchResult } from '../../components/branch-picker/index'
import { addFavoriteBatch, listFavorites, searchPlaces, type PlaceSearchResult } from '../../services/cloud'
import type { Place } from '../../shared/favorites'
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
  /** Non-reactive input store: writing here never re-renders, so iOS same-layer inputs keep their text. */
  values?: { keywords: string; city: string }
  setData(data: Partial<PlaceSearchData>): void
  onLoad(options: Record<string, unknown>): void
  onKeywordInput(event: InputEvent): void
  onCityInput(event: InputEvent): void
  onSearch(): void
  onManualLocation(): void
  beginSearch(intent: number, locate: () => Promise<GeoPoint>): void
  onSelectionChange(event: PickerEvent): void
  onAddSelected(): Promise<void>
}

function textValue(value: unknown): string { return typeof value === 'string' ? value : '' }
function selectedIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function decodedQueryText(value: unknown): string {
  if (typeof value !== 'string') return ''
  try { return decodeURIComponent(value).trim() } catch { return value.trim() }
}

export function searchPrefill(options: Record<string, unknown>) {
  return { keywords: decodedQueryText(options.keywords), city: decodedQueryText(options.city) }
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

export type PlaceSearchInput = Omit<PlaceSearchQuery, 'center'>

export interface PlaceSearchController {
  refreshFavorites(): Promise<Set<string>>
  beginIntent(): number
  isCurrent(intent: number): boolean
  search(query: PlaceSearchQuery): Promise<{ branches: BranchItem[]; stale: boolean } | undefined>
  locateAndSearch(intent: number, input: PlaceSearchInput, locate: () => Promise<GeoPoint>): Promise<{ branches: BranchItem[]; stale: boolean } | undefined>
}

export function createPlaceSearchController(deps: {
  listFavorites(): Promise<Place[]>
  searchPlaces(query: PlaceSearchQuery): Promise<PlaceSearchResult>
}): PlaceSearchController {
  let latestRequestId = 0
  const refreshFavorites = async () => new Set((await deps.listFavorites()).map(place => place.poiId))
  const beginIntent = () => ++latestRequestId
  const isCurrent = (intent: number) => intent === latestRequestId

  const searchForIntent = async (requestId: number, query: PlaceSearchQuery) => {
    if (!isCurrent(requestId)) return undefined
    let existingPoiIds: Set<string>
    try {
      existingPoiIds = await refreshFavorites()
    } catch (error) {
      if (!isCurrent(requestId)) return undefined
      throw error
    }
    if (!isCurrent(requestId)) return undefined
    let result: PlaceSearchResult
    try {
      result = await deps.searchPlaces(query)
    } catch (error) {
      if (!isCurrent(requestId)) return undefined
      throw error
    }
    if (!isCurrent(requestId)) return undefined
    return {
      branches: result.items.map(place => ({
        ...place,
        distanceMeters: Math.round(distanceMeters(query.center, place.location)),
        ...(existingPoiIds.has(place.poiId) ? { status: 'existing' as const } : {}),
      })),
      stale: result.stale,
    }
  }

  return {
    refreshFavorites,
    beginIntent,
    isCurrent,
    async search(query) {
      return searchForIntent(beginIntent(), query)
    },
    async locateAndSearch(intent, input, locate) {
      let center: GeoPoint
      try {
        center = await locate()
      } catch (error) {
        if (!isCurrent(intent)) return undefined
        throw error
      }
      if (!isCurrent(intent)) return undefined
      return searchForIntent(intent, { ...input, center })
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

    onLoad(this: PlaceSearchPage, options: Record<string, unknown>) {
      const prefill = searchPrefill(options)
      this.values = { keywords: prefill.keywords, city: prefill.city }
      if (prefill.keywords || prefill.city) this.setData(prefill)
      void controller.refreshFavorites().catch(error => {
        if (this.data.status === 'idle') {
          this.setData({ status: 'error', errorMessage: `无法确认已有收藏：${visibleError(error)}` })
        }
      })
    },

    onKeywordInput(this: PlaceSearchPage, event: InputEvent) {
      this.values!.keywords = textValue(event.detail.value)
    },

    onCityInput(this: PlaceSearchPage, event: InputEvent) {
      this.values!.city = textValue(event.detail.value)
    },

    onSearch(this: PlaceSearchPage) {
      const intent = controller.beginIntent()
      if (!this.values!.keywords.trim() || !this.values!.city.trim()) {
        this.setData({ status: 'error', errorMessage: '请填写餐厅名称和城市' })
        return
      }
      this.beginSearch(intent, getCurrentLocation)
    },

    onManualLocation(this: PlaceSearchPage) {
      const intent = controller.beginIntent()
      if (!this.values!.keywords.trim() || !this.values!.city.trim()) {
        this.setData({ status: 'error', errorMessage: '请填写餐厅名称和城市' })
        return
      }
      this.beginSearch(intent, chooseManualLocation)
    },

    beginSearch(this: PlaceSearchPage, intent: number, locate: () => Promise<GeoPoint>) {
      const input: PlaceSearchInput = {
        keywords: this.values!.keywords.trim(), city: this.values!.city.trim(), radiusMeters: 5_000,
      }
      this.setData({ status: 'searching', branches: [], selectedPoiIds: [], errorMessage: '', stale: false })
      void controller.locateAndSearch(intent, input, locate).then(result => {
        if (!result || !controller.isCurrent(intent)) return
        const { branches } = result
        this.setData({ status: branches.length ? 'ready' : 'empty', branches, stale: result.stale })
      }).catch(error => {
        if (!controller.isCurrent(intent)) return
        this.setData({ status: 'error', errorMessage: visibleError(error) })
      })
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
