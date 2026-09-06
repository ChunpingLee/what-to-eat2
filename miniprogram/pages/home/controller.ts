import { sortNearbyFavorites, type NearbyFavorite, type Place } from '../../shared/favorites'
import type { GeoPoint } from '../../shared/types'
import { buildShareDetailPath } from '../../shared/share'

export type HomeFavorite = NearbyFavorite & { poiId: string; detailPath: string; emoji: string; distanceLabel: string }

const EMOJI_RULES: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /火锅|打边炉|豆捞/, emoji: '🍲' },
  { pattern: /烧烤|烤串|串串|烤肉|烤鱼/, emoji: '🍢' },
  { pattern: /川菜|湘菜|辣|麻辣|江湖菜/, emoji: '🌶️' },
  { pattern: /日本菜|日料|寿司|刺身|居酒屋|匠|鮨/, emoji: '🍣' },
  { pattern: /咖啡|cafe|café/i, emoji: '☕' },
  { pattern: /面|拉面|米线|粉/, emoji: '🍜' },
  { pattern: /茶|奶茶|饮品|柠檬/, emoji: '🧋' },
  { pattern: /粤菜|早茶|点心|烧腊|潮汕/, emoji: '🥟' },
  { pattern: /披萨|汉堡|意面|西餐|bistro|bistrot/i, emoji: '🍕' },
  { pattern: /甜品|蛋糕|烘焙|面包|甜点/, emoji: '🍰' },
]

export function categoryEmoji(place: Place): string {
  const text = [place.name, ...(place.categories ?? []), ...(place.tags ?? [])].join(' ')
  for (const rule of EMOJI_RULES) {
    if (rule.pattern.test(text)) return rule.emoji
  }
  return '🍽️'
}

export function formatDistanceLabel(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)} 米`
  const km = meters / 1_000
  return km >= 10 ? `${Math.round(km)} 公里` : `${km.toFixed(1).replace(/\.0$/, '')} 公里`
}

export type HomeState =
  | { status: 'ready'; items: HomeFavorite[]; showRecommend: true }
  | { status: 'empty'; items: []; showRecommend: true }
  | { status: 'error'; items: HomeFavorite[]; showRecommend: true; errorMessage: string }

export interface FavoritesApi {
  listFavorites(): Promise<Place[]>
}

export function createHomeController(api: FavoritesApi) {
  let lastSuccessfulItems: HomeFavorite[] = []

  return {
    async load(center: GeoPoint, radiusMeters: number): Promise<HomeState> {
      try {
        // radiusMeters <= 0 表示「全部」：不做距离过滤，仍按距离升序。
        const range = radiusMeters > 0 ? radiusMeters : Number.POSITIVE_INFINITY
        const items = sortNearbyFavorites(await api.listFavorites(), center, range)
          .map(item => ({
            ...item,
            poiId: item.place.poiId,
            detailPath: buildShareDetailPath(item.place.poiId),
            emoji: categoryEmoji(item.place),
            distanceLabel: formatDistanceLabel(item.distanceMeters),
          }))
        lastSuccessfulItems = items
        return items.length
          ? { status: 'ready', items, showRecommend: true }
          : { status: 'empty', items: [], showRecommend: true }
      } catch (error) {
        return {
          status: 'error',
          items: lastSuccessfulItems,
          showRecommend: true,
          errorMessage: error instanceof Error ? error.message : '加载失败',
        }
      }
    },
  }
}
