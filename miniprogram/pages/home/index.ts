import type { GeoPoint } from '../../shared/types'
import { listFavorites } from '../../services/cloud'
import { chooseManualLocation, getCurrentLocation } from '../../services/location'
import { createHomeController, type HomeFavorite } from './controller'

const controller = createHomeController({ listFavorites })
/** 0 表示「全部」：不按距离过滤，仅按距离升序展示全部收藏。 */
const radiusOptions = [0, 1, 3, 5, 10] as const

type DisplayStatus = 'loading' | 'ready' | 'empty' | 'locationRequired' | 'error'

interface HomeData {
  status: DisplayStatus
  center?: GeoPoint
  radiusMeters: number
  radiusOptions: readonly number[]
  items: HomeFavorite[]
  showRecommend: boolean
  errorMessage: string
}

interface RadiusEvent {
  currentTarget: { dataset: { radius: number } }
}

interface OpenLocationEvent {
  currentTarget: { dataset: Record<string, unknown> }
}

interface HomePage {
  data: HomeData
  setData(data: Partial<HomeData>): void
  getTabBar?(): { setData(data: { selected: number }): void } | undefined
  onLoad(): void
  onShow(): void
  loadHome(center: GeoPoint, radiusMeters: number): Promise<void>
  requestCurrentLocation(): Promise<void>
  onRadiusChange(event: RadiusEvent): void
  onManualLocation(): void
  onRetry(): void
  onOpenLocation(event: OpenLocationEvent): void
}

Page<HomePage>({
  data: {
    status: 'loading',
    radiusMeters: 0,
    radiusOptions,
    items: [],
    showRecommend: true,
    errorMessage: '',
  },

  onLoad(this: HomePage) {
    void this.requestCurrentLocation()
  },

  onShow(this: HomePage) {
    this.getTabBar?.()?.setData({ selected: 0 })
  },

  async loadHome(this: HomePage, center: GeoPoint, radiusMeters: number) {
    this.setData({ status: 'loading', center, radiusMeters, errorMessage: '' })
    const state = await controller.load(center, radiusMeters)
    this.setData({
      status: state.status,
      center,
      radiusMeters,
      items: state.items,
      showRecommend: state.showRecommend,
      errorMessage: state.status === 'error' ? state.errorMessage : '',
    })
  },

  async requestCurrentLocation(this: HomePage) {
    try {
      await this.loadHome(await getCurrentLocation(), this.data.radiusMeters)
    } catch {
      this.setData({ status: 'locationRequired', errorMessage: '' })
    }
  },

  onRadiusChange(this: HomePage, event: RadiusEvent) {
    const radiusMeters = event.currentTarget.dataset.radius * 1_000
    if (this.data.center) void this.loadHome(this.data.center, radiusMeters)
    else this.setData({ radiusMeters })
  },

  onManualLocation(this: HomePage) {
    void chooseManualLocation()
      .then(center => this.loadHome(center, this.data.radiusMeters))
      .catch(() => this.setData({ status: 'locationRequired' }))
  },

  onRetry(this: HomePage) {
    if (this.data.center) void this.loadHome(this.data.center, this.data.radiusMeters)
    else void this.requestCurrentLocation()
  },

  onOpenLocation(this: HomePage, event: OpenLocationEvent) {
    const latitude = Number(event.currentTarget.dataset.latitude)
    const longitude = Number(event.currentTarget.dataset.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    wx.openLocation({
      latitude,
      longitude,
      name: typeof event.currentTarget.dataset.name === 'string' ? event.currentTarget.dataset.name : '',
      address: typeof event.currentTarget.dataset.address === 'string' ? event.currentTarget.dataset.address : '',
      scale: 16,
    })
  },

})
