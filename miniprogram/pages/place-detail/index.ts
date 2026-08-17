import type { Place } from '../../shared/favorites'
import type { FavoriteBatchResult } from '../../services/cloud'
import { addFavoriteBatch, resolveSharedPlace } from '../../services/cloud'
import { buildShareDetailPath, validateSharePoiId } from '../../shared/share'

export interface ShareOptions { v: 1; poiId: string }

export function parseShareOptions(options: Record<string, unknown>): ShareOptions {
  if (options.v !== '1' && options.v !== 1) throw new Error('INVALID_SHARE_PAYLOAD')
  if (typeof options.poiId !== 'string' || !options.poiId) throw new Error('INVALID_SHARE_PAYLOAD')
  let poiId: string
  try { poiId = decodeURIComponent(options.poiId).trim() } catch { throw new Error('INVALID_SHARE_PAYLOAD') }
  return { v: 1, poiId: validateSharePoiId(poiId) }
}

export function sharePathFor(poiId: string) {
  return buildShareDetailPath(poiId)
}

export function createPlaceDetailController(api: {
  resolveSharedPlace(payload: ShareOptions): Promise<Place>
  addFavoriteBatch(poiIds: string[]): Promise<FavoriteBatchResult>
}) {
  let loadedPlace: Place | undefined
  return {
    async load(payload: ShareOptions) {
      loadedPlace = await api.resolveSharedPlace(payload)
      return loadedPlace
    },
    async addFavorite() {
      if (!loadedPlace) throw new Error('PLACE_NOT_LOADED')
      return api.addFavoriteBatch([loadedPlace.poiId])
    },
  }
}

type DetailStatus = 'loading' | 'ready' | 'error'

interface DetailData {
  status: DetailStatus
  place?: Place
  categoriesText: string
  adding: boolean
  favoriteAdded: boolean
  errorMessage: string
}

interface PlaceDetailPage {
  data: DetailData
  setData(data: Partial<DetailData>): void
  onLoad(options: Record<string, unknown>): void
  onOpenLocation(): void
  onAddFavorite(): Promise<void>
  onShareAppMessage(): MiniProgramShareMessage
}

const controller = createPlaceDetailController({ resolveSharedPlace, addFavoriteBatch })

function visibleError(error: unknown) {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

if (typeof Page === 'function') {
  Page<PlaceDetailPage>({
    data: { status: 'loading', categoriesText: '', adding: false, favoriteAdded: false, errorMessage: '' },

    onLoad(this: PlaceDetailPage, options: Record<string, unknown>) {
      let payload: ShareOptions
      try { payload = parseShareOptions(options) } catch (error) {
        this.setData({ status: 'error', errorMessage: visibleError(error) })
        return
      }
      void controller.load(payload).then(place => {
        this.setData({ status: 'ready', place, categoriesText: place.categories?.join('、') || '', errorMessage: '' })
      }).catch(error => this.setData({ status: 'error', errorMessage: visibleError(error) }))
    },

    onOpenLocation(this: PlaceDetailPage) {
      const place = this.data.place
      if (!place) return
      wx.openLocation({
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        name: place.name,
        address: place.address || '',
        scale: 17,
      })
    },

    async onAddFavorite(this: PlaceDetailPage) {
      if (this.data.adding || !this.data.place) return
      this.setData({ adding: true, errorMessage: '' })
      try {
        const result = await controller.addFavorite()
        const poiId = this.data.place.poiId
        const succeeded = result.created.includes(poiId) || result.existing.includes(poiId)
        this.setData({ favoriteAdded: succeeded })
        if (!succeeded) throw new Error(result.failed[0]?.code || 'FAVORITE_WRITE_FAILED')
      } catch (error) {
        this.setData({ errorMessage: visibleError(error) })
      } finally {
        this.setData({ adding: false })
      }
    },

    onShareAppMessage(this: PlaceDetailPage) {
      const poiId = this.data.place?.poiId
      return {
        title: '分享一家餐厅',
        path: poiId ? sharePathFor(poiId) : '/pages/home/index',
      }
    },
  })
}
