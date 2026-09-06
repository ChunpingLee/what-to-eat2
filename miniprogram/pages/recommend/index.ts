import type { RecommendationRequest } from '../../../src/domain/recommendation'
import type { GeoPoint, TravelMode } from '../../shared/types'
import type { RecommendationItem, RecommendationResult } from '../../../cloudfunctions/recommend/index'
import { FIXED_RESTAURANT_CATEGORIES } from '../../shared/restaurant-categories'
import { addFavoriteBatch, recommendPlaces } from '../../services/cloud'
import { chooseManualLocation, getCurrentLocation } from '../../services/location'
import { formatDistanceLabel } from '../home/controller'

type RecommendationStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'locationRequired' | 'error'
type PreferenceMode = 'any' | 'category' | 'keywords' | 'random'

interface SelectOption<T> { label: string; value: T; selected: boolean }

interface DisplayBars {
  /** 0-100 进度，仅由真实存在的数据推导（与打分口径一致）。 */
  proximity?: number
  proximityLabel?: string
  rating?: number
  ratingLabel?: string
}

interface DisplayItem extends RecommendationItem, DisplayBars {
  poiId: string
  added: boolean
  rankIndex: number
  scorePct: number
  metaText: string
  costText?: string
  walkText?: string
  driveText?: string
}

interface RecommendationData {
  status: RecommendationStatus
  preferenceMode: PreferenceMode
  category: string
  keywords: string
  budgetMin: string
  budgetMax: string
  maxMinutes: string
  radiusMeters: number
  travelMode: TravelMode
  categoryOptions: Array<SelectOption<string>>
  radiusOptions: Array<SelectOption<number>>
  travelOptions: Array<SelectOption<TravelMode>>
  items: DisplayItem[]
  stale: boolean
  sourceUpdatedAt: string
  errorMessage: string
  savingPoiId: string
  filtersOpen: boolean
  filterSummary: string
}

interface DatasetEvent {
  currentTarget: { dataset: Record<string, unknown> }
}

interface InputEvent { detail: { value?: unknown } }

interface RecommendationPage {
  data: RecommendationData
  /** Non-reactive input store: writing here never re-renders, so iOS same-layer inputs keep their text. */
  values?: { keywords: string; budgetMin: string; budgetMax: string; maxMinutes: string }
  setData(data: Partial<RecommendationData>): void
  getTabBar?(): { setData(data: { selected: number }): void } | undefined
  onLoad(): void
  onShow(): void
  onCategory(event: DatasetEvent): void
  onAnyCategory(): void
  onToggleFilters(): void
  refreshFilterSummary(): void
  onKeywordFocus(): void
  onKeywordInput(event: InputEvent): void
  onRandom(): void
  onBudgetMinInput(event: InputEvent): void
  onBudgetMaxInput(event: InputEvent): void
  onMaxMinutesInput(event: InputEvent): void
  onRadius(event: DatasetEvent): void
  onTravelMode(event: DatasetEvent): void
  onRecommend(): void
  onManualLocation(): void
  beginRecommendation(locate: typeof getCurrentLocation): void
  runRecommendation(intent: number, input: RecommendationInput, locate: typeof getCurrentLocation): Promise<void>
  onAddFavorite(event: DatasetEvent): Promise<void>
  onOpenLocation(event: DatasetEvent): void
}

const radiusValues = [1_000, 3_000, 5_000, 10_000]
const travelValues: Array<{ label: string; value: TravelMode }> = [
  { label: '步行', value: 'walking' },
  { label: '骑行', value: 'bicycling' },
  { label: '驾车', value: 'driving' },
]

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function finiteOptional(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function options<T>(values: Array<{ label: string; value: T }>, selected: T): Array<SelectOption<T>> {
  return values.map(option => ({ ...option, selected: option.value === selected }))
}

function categoryOptions(selected: string, enabled = true) {
  return FIXED_RESTAURANT_CATEGORIES.map(category => ({
    label: category.label,
    value: category.id,
    selected: enabled && category.id === selected,
  }))
}

function radiusOptions(selected: number) {
  return options(radiusValues.map(value => ({ label: `${value / 1_000} 公里`, value })), selected)
}

function travelOptions(selected: TravelMode) {
  return options(travelValues, selected)
}

function visibleError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '暂时无法推荐，请稍后重试'
}

type RecommendationForm = Pick<RecommendationData,
  'preferenceMode' | 'category' | 'keywords' | 'budgetMin' | 'budgetMax' | 'maxMinutes' | 'radiusMeters' | 'travelMode'>
export type RecommendationInput = Omit<RecommendationRequest, 'center'>

export function buildRecommendationInput(data: RecommendationForm): RecommendationInput {
  const min = finiteOptional(data.budgetMin)
  const max = finiteOptional(data.budgetMax)
  const maxMinutes = finiteOptional(data.maxMinutes)
  const budget = min === undefined && max === undefined ? undefined : { min, max }
  return {
    ...(data.preferenceMode === 'category' ? { category: data.category } : {}),
    ...(data.preferenceMode === 'keywords' ? { keywords: data.keywords.trim() } : {}),
    // 「不限」与「随便吃」都不带品类/关键词偏好：服务端按 random 口径搜索全部餐厅。
    random: data.preferenceMode === 'random' || data.preferenceMode === 'any',
    radiusMeters: data.radiusMeters,
    travelMode: data.travelMode,
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
    ...(budget === undefined ? {} : { budget }),
  }
}

const TRAVEL_LABELS: Record<TravelMode, string> = {
  walking: '步行',
  bicycling: '骑行',
  driving: '驾车',
}

function categoryLabel(category: string): string {
  return FIXED_RESTAURANT_CATEGORIES.find(option => option.id === category)?.label ?? ''
}

/** 折叠筛选条的一行摘要，例如「不限 · 5公里 · 驾车 · ≤30分钟」。 */
export function buildFilterSummary(data: RecommendationForm): string {
  const parts: string[] = []
  if (data.preferenceMode === 'random') parts.push('随便吃')
  else if (data.preferenceMode === 'keywords') parts.push(data.keywords.trim() ? `“${data.keywords.trim()}”` : '关键词')
  else if (data.preferenceMode === 'category') parts.push(categoryLabel(data.category) || '选品类')
  else parts.push('不限品类')
  parts.push(`${data.radiusMeters / 1_000}公里`)
  parts.push(TRAVEL_LABELS[data.travelMode])
  const maxMinutes = finiteOptional(data.maxMinutes)
  if (maxMinutes !== undefined) parts.push(`≤${maxMinutes}分钟`)
  const min = finiteOptional(data.budgetMin)
  const max = finiteOptional(data.budgetMax)
  if (min !== undefined || max !== undefined) {
    parts.push(`人均${min === undefined ? '不限' : min}-${max === undefined ? '不限' : max}元`)
  }
  return parts.join(' · ')
}

export function buildRecommendationRequest(data: RecommendationForm, center: GeoPoint): RecommendationRequest {
  return { ...buildRecommendationInput(data), center }
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** 与 src/domain/recommendation 打分口径一致：有 maxMinutes 用时间，否则用距离/半径。 */
export function toDisplayItem(
  item: RecommendationItem,
  rankIndex: number,
  ctx: { maxMinutes?: number; radiusMeters: number; travelMode: TravelMode },
): DisplayItem {
  const maxMinutes = ctx.maxMinutes !== undefined && ctx.maxMinutes > 0 ? ctx.maxMinutes : undefined
  const bars: DisplayBars = {}
  if (maxMinutes !== undefined && item.travelMinutes !== undefined) {
    bars.proximity = Math.round(clamp01(1 - item.travelMinutes / maxMinutes) * 100)
    bars.proximityLabel = `路程 ${item.travelMinutes} 分钟`
  } else if (item.distanceMeters <= ctx.radiusMeters) {
    bars.proximity = Math.round(clamp01(1 - item.distanceMeters / ctx.radiusMeters) * 100)
    bars.proximityLabel = `距离 ${formatDistanceLabel(item.distanceMeters)}`
  } else if (item.travelMinutes !== undefined) {
    bars.proximityLabel = `路程 ${item.travelMinutes} 分钟`
  } else {
    bars.proximityLabel = `距离 ${formatDistanceLabel(item.distanceMeters)}`
  }
  if (item.place.rating !== undefined && item.place.rating > 0) {
    bars.rating = Math.round(clamp01(item.place.rating / 5) * 100)
    bars.ratingLabel = `评分 ${item.place.rating}`
  }
  // 步行/驾车时间用 chips 单独展示；骑行（无 chip 的方式）保留在 meta 行。
  const distanceText = formatDistanceLabel(item.distanceMeters)
  const metaText = ctx.travelMode === 'bicycling' && item.travelMinutes !== undefined
    ? `${distanceText} · 骑行约 ${item.travelMinutes} 分钟`
    : distanceText
  return {
    ...item,
    ...bars,
    poiId: item.place.poiId,
    added: false,
    rankIndex,
    scorePct: Math.round(item.score),
    metaText,
    ...(item.walkingMinutes !== undefined ? { walkText: `🚶 步行 ${item.walkingMinutes} 分钟` } : {}),
    ...(item.drivingMinutes !== undefined ? { driveText: `🚗 驾车 ${item.drivingMinutes} 分钟` } : {}),
    ...(item.place.averageCost !== undefined && item.place.averageCost > 0
      ? { costText: `人均 ¥${item.place.averageCost}` }
      : {}),
  }
}

export function createRecommendationController(deps: {
  recommendPlaces(request: RecommendationRequest): Promise<RecommendationResult>
}) {
  let latestIntent = 0
  const beginIntent = () => ++latestIntent
  const isCurrent = (intent: number) => intent === latestIntent
  return {
    beginIntent,
    isCurrent,
    async locateAndRecommend(
      intent: number,
      input: RecommendationInput,
      locate: () => Promise<GeoPoint>,
    ): Promise<{ status: 'success'; result: RecommendationResult } | { status: 'locationRequired' } | undefined> {
      if (!isCurrent(intent)) return undefined
      let center: GeoPoint
      try {
        center = await locate()
      } catch {
        return isCurrent(intent) ? { status: 'locationRequired' } : undefined
      }
      if (!isCurrent(intent)) return undefined
      try {
        const result = await deps.recommendPlaces({ ...input, center })
        return isCurrent(intent) ? { status: 'success', result } : undefined
      } catch (error) {
        if (!isCurrent(intent)) return undefined
        throw error
      }
    },
  }
}

const controller = createRecommendationController({ recommendPlaces })

export function createRecommendationSubmitter() {
  let pending = false
  return {
    async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (pending) return undefined
      pending = true
      try {
        return await operation()
      } finally {
        pending = false
      }
    },
  }
}

const submitter = createRecommendationSubmitter()

const initialData: RecommendationData = {
  status: 'idle',
  preferenceMode: 'any',
  category: 'hotpot',
  keywords: '',
  budgetMin: '',
  budgetMax: '',
  maxMinutes: '',
  radiusMeters: 5_000,
  travelMode: 'driving',
  categoryOptions: categoryOptions('hotpot', false),
  radiusOptions: radiusOptions(5_000),
  travelOptions: travelOptions('driving'),
  items: [],
  stale: false,
  sourceUpdatedAt: '',
  errorMessage: '',
  savingPoiId: '',
  filtersOpen: false,
  filterSummary: '不限品类 · 5公里 · 驾车',
}

if (typeof Page === 'function') {
  Page<RecommendationPage>({
    data: initialData,

    onLoad(this: RecommendationPage) {
      this.values = { keywords: '', budgetMin: '', budgetMax: '', maxMinutes: '' }
      // 进入即默认搜索：附近 5 公里、驾车、不限品类。
      this.beginRecommendation(getCurrentLocation)
    },

    onShow(this: RecommendationPage) {
      this.getTabBar?.()?.setData({ selected: 1 })
    },

    onCategory(this: RecommendationPage, event: DatasetEvent) {
      const category = textValue(event.currentTarget.dataset.category)
      this.setData({ preferenceMode: 'category', category, categoryOptions: categoryOptions(category) })
      this.refreshFilterSummary()
    },

    onAnyCategory(this: RecommendationPage) {
      if (this.data.preferenceMode !== 'any') {
        this.setData({ preferenceMode: 'any', categoryOptions: categoryOptions(this.data.category, false) })
        this.refreshFilterSummary()
      }
    },

    onToggleFilters(this: RecommendationPage) {
      this.refreshFilterSummary()
      this.setData({ filtersOpen: !this.data.filtersOpen })
    },

    refreshFilterSummary(this: RecommendationPage) {
      this.setData({ filterSummary: buildFilterSummary({ ...this.data, ...this.values! }) })
    },

    onKeywordFocus(this: RecommendationPage) {
      // Switch preference mode on focus (before typing) — setData during composition clears iOS inputs.
      if (this.data.preferenceMode !== 'keywords') {
        this.setData({ preferenceMode: 'keywords', categoryOptions: categoryOptions(this.data.category, false) })
      }
    },

    onKeywordInput(this: RecommendationPage, event: InputEvent) {
      this.values!.keywords = textValue(event.detail.value)
    },

    onRandom(this: RecommendationPage) {
      this.setData({ preferenceMode: 'random', categoryOptions: categoryOptions(this.data.category, false) })
      this.refreshFilterSummary()
    },

    onBudgetMinInput(this: RecommendationPage, event: InputEvent) {
      this.values!.budgetMin = textValue(event.detail.value)
    },

    onBudgetMaxInput(this: RecommendationPage, event: InputEvent) {
      this.values!.budgetMax = textValue(event.detail.value)
    },

    onMaxMinutesInput(this: RecommendationPage, event: InputEvent) {
      this.values!.maxMinutes = textValue(event.detail.value)
    },

    onRadius(this: RecommendationPage, event: DatasetEvent) {
      const radiusMeters = Number(event.currentTarget.dataset.radius)
      if (radiusValues.includes(radiusMeters)) {
        this.setData({ radiusMeters, radiusOptions: radiusOptions(radiusMeters) })
        this.refreshFilterSummary()
      }
    },

    onTravelMode(this: RecommendationPage, event: DatasetEvent) {
      const value = textValue(event.currentTarget.dataset.mode)
      if (value === 'walking' || value === 'bicycling' || value === 'driving') {
        this.setData({ travelMode: value, travelOptions: travelOptions(value) })
        this.refreshFilterSummary()
      }
    },

    onRecommend(this: RecommendationPage) {
      this.beginRecommendation(getCurrentLocation)
    },

    onManualLocation(this: RecommendationPage) {
      this.beginRecommendation(chooseManualLocation)
    },

    beginRecommendation(this: RecommendationPage, locate: typeof getCurrentLocation) {
      if (this.data.status === 'loading') return
      const intent = controller.beginIntent()
      const input = buildRecommendationInput({ ...this.data, ...this.values! })
      if (this.data.preferenceMode === 'keywords' && !input.keywords) {
        this.setData({ status: 'error', errorMessage: '请输入想吃的关键词' })
        return
      }
      this.refreshFilterSummary()
      this.setData({ status: 'loading', items: [], stale: false, errorMessage: '' })
      void submitter.run(() => this.runRecommendation(intent, input, locate))
    },

    async runRecommendation(
      this: RecommendationPage,
      intent: number,
      input: RecommendationInput,
      locate: typeof getCurrentLocation,
    ) {
      try {
        const outcome = await controller.locateAndRecommend(intent, input, locate)
        if (!outcome) return
        if (outcome.status === 'locationRequired') {
          this.setData({ status: 'locationRequired', errorMessage: '' })
          return
        }
        const { result } = outcome
        const ctx = {
          maxMinutes: finiteOptional(this.values!.maxMinutes),
          radiusMeters: this.data.radiusMeters,
          travelMode: this.data.travelMode,
        }
        const items = result.items.map((item, index) => toDisplayItem(item, index, ctx))
        this.setData({
          status: items.length ? 'ready' : 'empty',
          items,
          stale: result.stale,
          sourceUpdatedAt: result.sourceUpdatedAt,
        })
      } catch (error) {
        this.setData({ status: 'error', errorMessage: visibleError(error) })
      }
    },

    async onAddFavorite(this: RecommendationPage, event: DatasetEvent) {
      const poiId = textValue(event.currentTarget.dataset.poiId)
      if (!poiId || this.data.savingPoiId) return
      this.setData({ savingPoiId: poiId, errorMessage: '' })
      try {
        const result = await addFavoriteBatch([poiId])
        const completed = result.created.includes(poiId) || result.existing.includes(poiId)
        if (completed) {
          this.setData({ items: this.data.items.map(item => item.place.poiId === poiId ? { ...item, added: true } : item) })
        } else {
          this.setData({ errorMessage: '收藏失败，请重试' })
        }
      } catch (error) {
        this.setData({ errorMessage: visibleError(error) })
      } finally {
        this.setData({ savingPoiId: '' })
      }
    },

    onOpenLocation(this: RecommendationPage, event: DatasetEvent) {
      const latitude = Number(event.currentTarget.dataset.latitude)
      const longitude = Number(event.currentTarget.dataset.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
      wx.openLocation({
        latitude,
        longitude,
        name: textValue(event.currentTarget.dataset.name),
        address: textValue(event.currentTarget.dataset.address),
        scale: 16,
      })
    },
  })
}
