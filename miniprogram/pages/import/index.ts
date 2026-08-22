import { distanceMeters } from '../../shared/geo'
import type { GeoPoint } from '../../shared/types'
import { applyBatchResult, type BranchItem, type FavoriteBatchResult } from '../../components/branch-picker/index'
import {
  addFavoriteBatch,
  importSharedLink,
  listFavorites,
  type LinkImportResult,
} from '../../services/cloud'
import { getCurrentLocation } from '../../services/location'

type ImportStatus = 'idle' | 'importing' | 'matched' | 'search' | 'manual' | 'error'

interface ImportData {
  url: string
  city: string
  status: ImportStatus
  branches: BranchItem[]
  selectedPoiIds: string[]
  submitting: boolean
  keywords: string
  searchUrl: string
  errorMessage: string
}

interface InputEvent { detail: { value?: unknown } }
interface PickerEvent { detail: { poiIds?: unknown } }

interface ImportPage {
  data: ImportData
  setData(data: Partial<ImportData>): void
  onUrlInput(event: InputEvent): void
  onCityInput(event: InputEvent): void
  onImport(): Promise<void>
  publishResult(result: LinkImportResult, center?: GeoPoint): Promise<void>
  onSelectionChange(event: PickerEvent): void
  onAddSelected(): Promise<void>
}

function inputText(value: unknown): string { return typeof value === 'string' ? value : '' }
function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

// URLSearchParams is a Web API absent from the Mini Program appservice runtime.
export function buildSearchUrl(keywords: string, city: string) {
  const trimmed = city.trim()
  const query = `keywords=${encodeURIComponent(keywords)}` + (trimmed ? `&city=${encodeURIComponent(trimmed)}` : '')
  return `/pages/place-search/index?${query}`
}

if (typeof Page === 'function') {
  Page<ImportPage>({
    data: {
      url: '', city: '', status: 'idle', branches: [], selectedPoiIds: [], submitting: false,
      keywords: '', searchUrl: '/pages/place-search/index', errorMessage: '',
    },

    onUrlInput(this: ImportPage, event: InputEvent) { this.setData({ url: inputText(event.detail.value) }) },
    onCityInput(this: ImportPage, event: InputEvent) { this.setData({ city: inputText(event.detail.value) }) },

    async onImport(this: ImportPage) {
      const url = this.data.url.trim()
      if (!url) { this.setData({ status: 'error', errorMessage: '请粘贴分享链接' }); return }
      this.setData({ status: 'importing', branches: [], selectedPoiIds: [], errorMessage: '' })
      let center: GeoPoint | undefined
      try { center = await getCurrentLocation() } catch { /* matching can degrade to keyword search */ }
      try {
        await this.publishResult(await importSharedLink({
          url,
          ...(center ? { center } : {}),
          ...(this.data.city.trim() ? { city: this.data.city.trim() } : {}),
        }), center)
      } catch {
        this.setData({ status: 'error', errorMessage: '链接导入失败，请检查链接后重试' })
      }
    },

    async publishResult(this: ImportPage, result: LinkImportResult, center?: GeoPoint) {
      if (result.status === 'search') {
        const keywords = result.keywords
        this.setData({ status: 'search', keywords, searchUrl: buildSearchUrl(keywords, this.data.city) })
        return
      }
      if (result.status === 'manual') { this.setData({ status: 'manual' }); return }
      let existing = new Set<string>()
      try { existing = new Set((await listFavorites()).map(item => item.poiId)) } catch { /* best-effort existing marks; addBatch dedupes server-side */ }
      const branches = result.candidates.map(place => ({
        ...place,
        distanceMeters: center ? Math.round(distanceMeters(center, place.location)) : 0,
        ...(existing.has(place.poiId) ? { status: 'existing' as const } : {}),
      }))
      this.setData({ status: 'matched', branches })
    },

    onSelectionChange(this: ImportPage, event: PickerEvent) {
      const selectable = new Set(this.data.branches
        .filter(item => item.status !== 'created' && item.status !== 'existing')
        .map(item => item.poiId))
      this.setData({ selectedPoiIds: ids(event.detail.poiIds).filter(id => selectable.has(id)) })
    },

    async onAddSelected(this: ImportPage) {
      if (this.data.submitting || !this.data.selectedPoiIds.length) return
      this.setData({ submitting: true, errorMessage: '' })
      try {
        const result = await addFavoriteBatch(this.data.selectedPoiIds)
        const branches = applyBatchResult(this.data.branches, result as FavoriteBatchResult)
        const complete = new Set([...result.created, ...result.existing])
        this.setData({ branches, selectedPoiIds: this.data.selectedPoiIds.filter(id => !complete.has(id)) })
      } catch {
        this.setData({ errorMessage: '加入收藏失败，请重试' })
      } finally {
        this.setData({ submitting: false })
      }
    },
  })
}
