import type { GeoPoint } from '../../../src/shared/types'
import { listFavorites } from '../../services/cloud'
import { chooseManualLocation, getCurrentLocation } from '../../services/location'
import { createHomeController, type HomeFavorite } from './controller'

const controller = createHomeController({ listFavorites })
const radiusOptions = [1, 3, 5, 10] as const

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

interface HomePage {
  data: HomeData
  setData(data: Partial<HomeData>): void
  onLoad(): void
  loadHome(center: GeoPoint, radiusMeters: number): Promise<void>
  requestCurrentLocation(): Promise<void>
  onRadiusChange(event: RadiusEvent): void
  onManualLocation(): void
  onRetry(): void
}

Page<HomePage>({
  data: {
    status: 'loading',
    radiusMeters: 5_000,
    radiusOptions,
    items: [],
    showRecommend: true,
    errorMessage: '',
  },

  onLoad(this: HomePage) {
    void this.requestCurrentLocation()
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

})
