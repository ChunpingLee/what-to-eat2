# “最想吃啥”微信小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可公开发布的微信小程序，让每位用户查看附近的私密收藏，并在没有合适收藏时获得可解释的附近餐馆推荐。

**Architecture:** 微信原生 TypeScript 小程序负责页面和授权交互；CloudBase 云函数从可信上下文取得 OpenID，封装收藏、链接解析、高德 POI/路线调用及推荐排序；CloudBase 文档数据库保存私密用户数据和公共 POI 缓存。领域算法保持为无平台依赖的纯 TypeScript 模块，以便在本地用 Vitest 测试。

**Tech Stack:** 微信原生小程序、TypeScript、CloudBase 云函数、CloudBase 文档数据库、高德 Web 服务 API、Vitest、ESLint、Prettier

## Global Constraints

- 首版唯一公共餐馆数据源为高德 Web 服务 API。
- 收藏首页默认 5 公里，可切换 1、3、5、10 公里，并严格按距离升序排列。
- 同时支持公里半径和步行、骑行、驾车最长时间筛选。
- 用户身份只能来自 CloudBase 可信调用上下文，客户端用户标识必须忽略或拒绝。
- `favorites`、`imports`、`recommendation_events` 仅创建者可读写；第三方密钥只保存在云端。
- 收藏唯一性语义为 `OpenID + POI ID`；同名分店允许单选或多选，重复分店不得重复写入。
- 不保存持续位置轨迹，不保存第三方账号密码、Cookie 或登录态。
- 缺失评分、人均、图片、营业状态或路线时间时不得推断或伪造。
- 不抓取大众点评必吃榜、高德扫街榜或任何非公开账户数据。
- 首版不实现美团/大众点评账户收藏自动读取，也不实现截图 OCR 批量导入。
- 推荐目标返回 3 至 10 家；不足 3 家时按实际数量展示。
- 每项实现遵循测试先行：先观察失败，再写最小实现，再验证通过。

---

## Milestone 1：可用的私密收藏小程序

### Task 1: 建立工程骨架与地理距离领域模块

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/shared/types.ts`
- Create: `src/domain/geo.ts`
- Test: `tests/domain/geo.test.ts`

**Interfaces:**
- Produces: `GeoPoint`, `TravelMode`, `distanceMeters(from, to): number`，供收藏排序、搜索和推荐共同使用。

- [ ] **Step 1: 写工程配置和失败测试**

```json
// package.json
{
  "name": "most-want-to-eat",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "cloudfunctions/**/*.ts", "miniprogram/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'], clearMocks: true },
})
```

```ts
// tests/domain/geo.test.ts
import { describe, expect, it } from 'vitest'
import { distanceMeters } from '../../src/domain/geo'

describe('distanceMeters', () => {
  it('returns zero for the same point', () => {
    expect(distanceMeters({ latitude: 31.2304, longitude: 121.4737 }, { latitude: 31.2304, longitude: 121.4737 })).toBe(0)
  })

  it('calculates a stable great-circle distance', () => {
    const meters = distanceMeters(
      { latitude: 31.2304, longitude: 121.4737 },
      { latitude: 31.2243, longitude: 121.4768 },
    )
    expect(meters).toBeGreaterThan(700)
    expect(meters).toBeLessThan(800)
  })
})
```

- [ ] **Step 2: 安装依赖并验证测试失败**

Run: `npm install && npm test -- tests/domain/geo.test.ts`  
Expected: FAIL，提示无法解析 `src/domain/geo`。

- [ ] **Step 3: 实现共享类型和 Haversine 距离**

```ts
// src/shared/types.ts
export interface GeoPoint { latitude: number; longitude: number }
export type TravelMode = 'walking' | 'bicycling' | 'driving'
```

```ts
// src/domain/geo.ts
import type { GeoPoint } from '../shared/types'

const EARTH_RADIUS_METERS = 6_371_000
const radians = (degrees: number) => degrees * Math.PI / 180

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  if (from.latitude === to.latitude && from.longitude === to.longitude) return 0
  const dLat = radians(to.latitude - from.latitude)
  const dLon = radians(to.longitude - from.longitude)
  const lat1 = radians(from.latitude)
  const lat2 = radians(to.latitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}
```

- [ ] **Step 4: 验证测试和类型检查通过**

Run: `npm test -- tests/domain/geo.test.ts && npm run typecheck`  
Expected: 2 tests PASS；TypeScript 无错误。

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/shared/types.ts src/domain/geo.ts tests/domain/geo.test.ts
git commit -m "chore: establish typed mini program core"
```

### Task 2: 实现收藏模型、排序与批量去重

**Files:**
- Create: `src/domain/favorites.ts`
- Test: `tests/domain/favorites.test.ts`

**Interfaces:**
- Consumes: `GeoPoint`, `distanceMeters`。
- Produces: `Place`, `Favorite`, `NearbyFavorite`, `sortNearbyFavorites()` 和 `planFavoriteBatch()`。

- [ ] **Step 1: 写排序和批量去重失败测试**

```ts
// tests/domain/favorites.test.ts
import { describe, expect, it } from 'vitest'
import { planFavoriteBatch, sortNearbyFavorites } from '../../src/domain/favorites'

const center = { latitude: 31.2304, longitude: 121.4737 }
const places = [
  { poiId: 'far', name: '同名店（远店）', location: { latitude: 31.2504, longitude: 121.4737 }, address: '远路 2 号', categories: ['餐饮'] },
  { poiId: 'near', name: '同名店（近店）', location: { latitude: 31.2314, longitude: 121.4737 }, address: '近路 1 号', categories: ['餐饮'] },
]

it('sorts favorites strictly nearest first', () => {
  expect(sortNearbyFavorites(places, center, 5_000).map(item => item.place.poiId)).toEqual(['near', 'far'])
})

it('separates new, existing and duplicate selections', () => {
  expect(planFavoriteBatch(['near', 'far', 'near'], new Set(['far']))).toEqual({ toCreate: ['near'], existing: ['far'], duplicateSelections: ['near'] })
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/domain/favorites.test.ts`  
Expected: FAIL，提示 `favorites` 模块不存在。

- [ ] **Step 3: 实现最小领域逻辑**

```ts
// src/domain/favorites.ts
import { distanceMeters } from './geo'
import type { GeoPoint } from '../shared/types'

export interface Place { poiId: string; name: string; location: GeoPoint; address: string; businessArea?: string; categories: string[] }
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
```

- [ ] **Step 4: 验证测试通过**

Run: `npm test -- tests/domain/favorites.test.ts`  
Expected: 2 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add src/domain/favorites.ts tests/domain/favorites.test.ts
git commit -m "feat: add private favorite domain rules"
```

### Task 3: 建立 CloudBase 收藏云函数与权限规则

**Files:**
- Create: `cloudfunctions/favorites/index.ts`
- Create: `cloudfunctions/favorites/repository.ts`
- Create: `cloudfunctions/favorites/package.json`
- Create: `cloudbase/database.rules.json`
- Test: `tests/cloudfunctions/favorites.test.ts`

**Interfaces:**
- Consumes: `planFavoriteBatch()`；CloudBase `getWXContext().OPENID`。
- Produces: `main({ action: 'list' | 'addBatch' | 'remove', ... })`；客户端不得传入 `openid`。

- [ ] **Step 1: 写越权和批量去重失败测试**

```ts
// tests/cloudfunctions/favorites.test.ts
import { expect, it, vi } from 'vitest'
import { createFavoritesHandler } from '../../cloudfunctions/favorites/index'

it('uses trusted context and ignores a forged owner', async () => {
  const repo = { list: vi.fn().mockResolvedValue([]), findExisting: vi.fn(), insert: vi.fn(), remove: vi.fn() }
  const handler = createFavoritesHandler({ getOpenId: () => 'trusted-user', repo })
  await handler({ action: 'list', openid: 'attacker' } as never)
  expect(repo.list).toHaveBeenCalledWith('trusted-user')
})

it('adds multiple branches and reports existing records', async () => {
  const repo = { list: vi.fn(), findExisting: vi.fn().mockResolvedValue(new Set(['p2'])), insert: vi.fn().mockResolvedValue(undefined), remove: vi.fn() }
  const handler = createFavoritesHandler({ getOpenId: () => 'u1', repo })
  await expect(handler({ action: 'addBatch', poiIds: ['p1', 'p2'] })).resolves.toMatchObject({ created: ['p1'], existing: ['p2'] })
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/cloudfunctions/favorites.test.ts`  
Expected: FAIL，云函数工厂尚不存在。

- [ ] **Step 3: 实现依赖注入式处理器和仅创建者规则**

```ts
// cloudfunctions/favorites/index.ts
import { planFavoriteBatch } from '../../src/domain/favorites'

type Event = { action: 'list' } | { action: 'addBatch'; poiIds: string[] } | { action: 'remove'; poiId: string }
type Repo = { list(openid: string): Promise<unknown[]>; findExisting(openid: string, ids: string[]): Promise<Set<string>>; insert(openid: string, ids: string[]): Promise<void>; remove(openid: string, poiId: string): Promise<void> }

export function createFavoritesHandler(deps: { getOpenId(): string; repo: Repo }) {
  return async (event: Event) => {
    const openid = deps.getOpenId()
    if (!openid) throw new Error('UNAUTHENTICATED')
    if (event.action === 'list') return { items: await deps.repo.list(openid) }
    if (event.action === 'remove') { await deps.repo.remove(openid, event.poiId); return { removed: event.poiId } }
    const existingSet = await deps.repo.findExisting(openid, event.poiIds)
    const plan = planFavoriteBatch(event.poiIds, existingSet)
    await deps.repo.insert(openid, plan.toCreate)
    return { created: plan.toCreate, existing: plan.existing, duplicateSelections: plan.duplicateSelections }
  }
}
```

```json
// cloudbase/database.rules.json
{
  "favorites": { ".read": "doc._openid == auth.openid", ".write": "doc._openid == auth.openid" },
  "imports": { ".read": "doc._openid == auth.openid", ".write": "doc._openid == auth.openid" },
  "recommendation_events": { ".read": "doc._openid == auth.openid", ".write": "doc._openid == auth.openid" },
  "places": { ".read": true, ".write": false },
  "users": { ".read": "doc._openid == auth.openid", ".write": "doc._openid == auth.openid" }
}
```

- [ ] **Step 4: 实现仓储时使用 `_openid + poiId` 查询后再插入，并验证**

Run: `npm test -- tests/cloudfunctions/favorites.test.ts && npm run typecheck`  
Expected: tests PASS；类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/favorites cloudbase/database.rules.json tests/cloudfunctions/favorites.test.ts
git commit -m "feat: enforce private favorite ownership"
```

### Task 4: 实现定位降级与收藏优先首页

**Files:**
- Create: `miniprogram/app.ts`
- Create: `miniprogram/app.json`
- Create: `miniprogram/pages/home/index.ts`
- Create: `miniprogram/pages/home/index.wxml`
- Create: `miniprogram/pages/home/index.wxss`
- Create: `miniprogram/services/location.ts`
- Create: `miniprogram/services/cloud.ts`
- Test: `tests/miniprogram/home-controller.test.ts`

**Interfaces:**
- Consumes: 收藏云函数 `list`；`GeoPoint`。
- Produces: `loadHome(center, radiusMeters)` 和首页状态 `loading | ready | empty | locationRequired | error`。

- [ ] **Step 1: 写首页状态失败测试**

```ts
// tests/miniprogram/home-controller.test.ts
import { expect, it, vi } from 'vitest'
import { createHomeController } from '../../miniprogram/pages/home/controller'

it('sorts returned favorites and exposes empty recommendation fallback', async () => {
  const api = { listFavorites: vi.fn().mockResolvedValue([]) }
  const controller = createHomeController(api)
  await expect(controller.load({ latitude: 31.23, longitude: 121.47 }, 5_000)).resolves.toMatchObject({ status: 'empty', showRecommend: true })
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/miniprogram/home-controller.test.ts`  
Expected: FAIL，controller 不存在。

- [ ] **Step 3: 实现 controller、定位服务和页面**

```ts
// miniprogram/pages/home/controller.ts
import { sortNearbyFavorites, type Place } from '../../../src/domain/favorites'
import type { GeoPoint } from '../../../src/shared/types'

export function createHomeController(api: { listFavorites(): Promise<Place[]> }) {
  return { async load(center: GeoPoint, radiusMeters: number) {
    const items = sortNearbyFavorites(await api.listFavorites(), center, radiusMeters)
    return items.length ? { status: 'ready' as const, items, showRecommend: true } : { status: 'empty' as const, items, showRecommend: true }
  }}
}
```

页面必须提供 1/3/5/10 公里切换、“换成附近推荐”、定位用途说明和“手动选择地点”入口；调用失败时展示重试，不清空上次成功状态。

- [ ] **Step 4: 验证单测并在微信开发者工具人工检查**

Run: `npm test -- tests/miniprogram/home-controller.test.ts && npm run typecheck`  
Expected: PASS。  
Manual: 分别模拟允许定位、拒绝定位、空收藏和有收藏；确认由近到远且拒绝时可手选地点。

- [ ] **Step 5: 提交**

```bash
git add miniprogram tests/miniprogram/home-controller.test.ts
git commit -m "feat: add location-aware favorite home"
```

---

## Milestone 2：搜索与分享链接导入

### Task 5: 封装高德 POI 搜索、缓存和安全错误模型

**Files:**
- Create: `cloudfunctions/place-search/index.ts`
- Create: `cloudfunctions/place-search/amap-client.ts`
- Create: `cloudfunctions/place-search/cache.ts`
- Create: `src/shared/errors.ts`
- Test: `tests/cloudfunctions/place-search.test.ts`

**Interfaces:**
- Produces: `searchPlaces({ keywords, center, city, radiusMeters }): Promise<PlaceSearchResult>`；`PlaceSearchResult` 含 `items`, `sourceUpdatedAt`, `stale`。

- [ ] **Step 1: 写密钥隔离、映射和缓存失败测试**

```ts
it('maps optional Amap fields without inventing values', async () => {
  const http = vi.fn().mockResolvedValue({ pois: [{ id: 'p1', name: '店', location: '121.47,31.23', address: '路 1 号', type: '餐饮服务;中餐厅', biz_ext: [] }] })
  const result = await createAmapClient({ key: 'server-only', http }).search({ keywords: '店', center: { latitude: 31.23, longitude: 121.47 }, radiusMeters: 5000 })
  expect(result[0]).toMatchObject({ poiId: 'p1', rating: undefined, averageCost: undefined })
  expect(http).toHaveBeenCalledWith(expect.objectContaining({ key: 'server-only' }))
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/cloudfunctions/place-search.test.ts`  
Expected: FAIL，Amap client 不存在。

- [ ] **Step 3: 实现服务端客户端、字段映射和缓存策略**

`amap-client.ts` 从 `process.env.AMAP_WEB_KEY` 读取密钥；将 `location` 的“经度,纬度”转换为 `GeoPoint`；空评分、人均、图片和营业状态保留 `undefined`。`cache.ts` 以标准化查询参数为键，正常缓存 30 分钟；外部超时时仅返回不超过 24 小时的旧缓存并设置 `stale: true`。

- [ ] **Step 4: 验证测试**

Run: `npm test -- tests/cloudfunctions/place-search.test.ts`  
Expected: 字段映射、缓存命中、超时旧缓存和无缓存超时用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/place-search src/shared/errors.ts tests/cloudfunctions/place-search.test.ts
git commit -m "feat: add cached Amap place search"
```

### Task 6: 实现同名分店多选搜索与批量收藏页面

**Files:**
- Create: `miniprogram/pages/place-search/index.ts`
- Create: `miniprogram/pages/place-search/index.wxml`
- Create: `miniprogram/pages/place-search/index.wxss`
- Create: `miniprogram/components/branch-picker/index.ts`
- Create: `miniprogram/components/branch-picker/index.wxml`
- Test: `tests/miniprogram/branch-picker.test.ts`

**Interfaces:**
- Consumes: `place-search.searchPlaces()`、`favorites.addBatch()`。
- Produces: 选择集合 `Set<poiId>`；批量结果 `{ created, existing, failed }`。

- [ ] **Step 1: 写多选和已收藏禁用失败测试**

```ts
it('allows multiple branches but never selects an existing favorite', () => {
  const model = createBranchPicker(['p1', 'p2', 'p3'], new Set(['p2']))
  model.toggle('p1'); model.toggle('p3'); model.toggle('p2')
  expect(model.selected()).toEqual(['p1', 'p3'])
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/miniprogram/branch-picker.test.ts`  
Expected: FAIL，picker model 不存在。

- [ ] **Step 3: 实现多选模型与页面交互**

列表每项显示分店名、地址、商圈、距离；已收藏项显示“已加入”且禁用。提交后逐项合并 `created`、`existing`、`failed` 状态，成功项保持成功，不因部分失败回滚。

- [ ] **Step 4: 验证单测和人工交互**

Run: `npm test -- tests/miniprogram/branch-picker.test.ts`  
Expected: 多选、取消、已收藏禁用、重复点击用例 PASS。  
Manual: 搜索同名连锁店，选择多个分店，确认批量反馈准确。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/pages/place-search miniprogram/components/branch-picker tests/miniprogram/branch-picker.test.ts
git commit -m "feat: support multi-branch favorite selection"
```

### Task 7: 实现白名单分享链接解析与搜索降级

**Files:**
- Create: `cloudfunctions/link-import/index.ts`
- Create: `cloudfunctions/link-import/url-policy.ts`
- Create: `cloudfunctions/link-import/parsers/meituan.ts`
- Create: `cloudfunctions/link-import/parsers/dianping.ts`
- Create: `cloudfunctions/link-import/parsers/amap.ts`
- Create: `miniprogram/pages/import/index.ts`
- Test: `tests/cloudfunctions/link-import.test.ts`

**Interfaces:**
- Produces: `ImportResult = { status: 'matched'; candidates: Place[] } | { status: 'search'; keywords: string } | { status: 'manual' }`。

- [ ] **Step 1: 写域名白名单、重定向限制和降级失败测试**

```ts
it.each(['http://example.com/a', 'https://evil.example/a', 'file:///etc/passwd'])('rejects unsafe URL %s', async url => {
  await expect(importLink(url)).rejects.toThrow('UNSUPPORTED_LINK')
})

it('falls back to extracted shop name when no unique POI matches', async () => {
  await expect(importLink('https://www.dianping.com/shop/abc')).resolves.toEqual({ status: 'search', keywords: '示例火锅' })
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/cloudfunctions/link-import.test.ts`  
Expected: FAIL，import handler 不存在。

- [ ] **Step 3: 实现安全策略与三个解析适配器**

只允许已确认的美团、点评和高德 HTTPS 主机名；最多跟随 3 次重定向；单次响应上限 1 MB；连接和读取总超时 5 秒；每次重定向重新验证目标主机；禁止访问环回、私网和链路本地地址。解析器只返回店名、城市、地址和分店线索，不保存 Cookie。

- [ ] **Step 4: 实现导入页面并验证**

Run: `npm test -- tests/cloudfunctions/link-import.test.ts`  
Expected: 支持链接、未知域名、私网重定向、超时、唯一匹配、多候选和手动降级用例 PASS。  
Manual: 在微信中分别粘贴三个平台的真实分享链接，确认进入单店确认或多分店选择。

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/link-import miniprogram/pages/import tests/cloudfunctions/link-import.test.ts
git commit -m "feat: import shared restaurant links safely"
```

---

## Milestone 3：推荐、分享与上线验收

### Task 8: 实现缺失字段安全的推荐引擎

**Files:**
- Create: `src/domain/recommendation.ts`
- Create: `src/domain/recommendation-reasons.ts`
- Test: `tests/domain/recommendation.test.ts`

**Interfaces:**
- Produces: `rankRecommendations(candidates, request): RankedPlace[]`；权重为品类 35、距离/时间 30、评分 20、预算 10、完整度 5。

- [ ] **Step 1: 写权重归一化、稳定排序和理由一致性失败测试**

```ts
it('renormalizes weights when rating and cost are absent', () => {
  const [result] = rankRecommendations([candidateWithoutRating], request)
  expect(result.score).toBeGreaterThanOrEqual(0)
  expect(result.score).toBeLessThanOrEqual(100)
  expect(result.reasons.join('')).not.toContain('评分')
})

it('breaks ties by distance, rating, then poi id', () => {
  expect(rankRecommendations(tiedCandidates, request).map(x => x.place.poiId)).toEqual(['near', 'far-a', 'far-b'])
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/domain/recommendation.test.ts`  
Expected: FAIL，推荐模块不存在。

- [ ] **Step 3: 实现打分与理由生成**

每个候选只为存在且适用的信号创建 `{ key, rawScore, weight, reason? }`；最终分数为 `sum(rawScore * weight) / sum(weight) * 100`。营业状态未知不得作为通过或淘汰依据。理由只从实际参与且达到展示阈值的信号生成。

- [ ] **Step 4: 验证测试**

Run: `npm test -- tests/domain/recommendation.test.ts`  
Expected: 完整字段、缺失字段、边界距离、预算边界、并列和理由一致性用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/domain/recommendation.ts src/domain/recommendation-reasons.ts tests/domain/recommendation.test.ts
git commit -m "feat: add explainable restaurant ranking"
```

### Task 9: 实现路线时间二次筛选与推荐云函数

**Files:**
- Create: `cloudfunctions/place-routes/index.ts`
- Create: `cloudfunctions/place-routes/amap-routes.ts`
- Create: `cloudfunctions/recommend/index.ts`
- Create: `miniprogram/pages/recommend/index.ts`
- Create: `miniprogram/pages/recommend/index.wxml`
- Create: `miniprogram/pages/recommend/index.wxss`
- Test: `tests/cloudfunctions/recommend.test.ts`

**Interfaces:**
- Consumes: POI 搜索、`rankRecommendations()`。
- Produces: `recommend({ keywords?, category?, random, center, radiusMeters, travelMode, maxMinutes?, budget? })`。

- [ ] **Step 1: 写前 20 候选、时间筛选和路线失败测试**

```ts
it('requests routes only for the pre-ranked top twenty', async () => {
  await handler(requestWithThirtyCandidates)
  expect(routeClient.times).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(topTwentyLocations), 'walking')
  expect(routeClient.times.mock.calls[0][1]).toHaveLength(20)
})

it('keeps distance results but marks route time unavailable on route failure', async () => {
  routeClient.times.mockRejectedValue(new Error('timeout'))
  const result = await handler(validRequest)
  expect(result.items[0]).toMatchObject({ travelMinutes: undefined, travelTimeUnavailable: true })
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/cloudfunctions/recommend.test.ts`  
Expected: FAIL，recommend handler 不存在。

- [ ] **Step 3: 实现候选管线和推荐页面**

先按半径、品类/关键词、预算和可靠营业状态过滤；基础预排后最多请求 20 家路线；路线成功时按 `maxMinutes` 二次过滤，失败时保留距离结果并显示“出行时间未计算”。返回 3–10 家。页面提供固定品类、自由关键词、“随便吃”、预算、半径、方式和最长时间，并展示实际推荐理由。

- [ ] **Step 4: 验证自动化和人工流程**

Run: `npm test -- tests/cloudfunctions/recommend.test.ts && npm test`  
Expected: 全套测试 PASS。  
Manual: 验证火锅、自由关键词、随便吃、无结果放宽条件和路线失败提示。

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/place-routes cloudfunctions/recommend miniprogram/pages/recommend tests/cloudfunctions/recommend.test.ts
git commit -m "feat: recommend nearby restaurants by travel time"
```

### Task 10: 实现私密单店分享、个人数据删除与发布验收

**Files:**
- Create: `cloudfunctions/share-place/index.ts`
- Create: `cloudfunctions/delete-account/index.ts`
- Create: `miniprogram/pages/place-detail/index.ts`
- Create: `miniprogram/pages/place-detail/index.wxml`
- Create: `miniprogram/pages/settings/index.ts`
- Create: `docs/privacy-data-inventory.json`
- Create: `tests/cloudfunctions/privacy.test.ts`
- Create: `docs/release-checklist.md`

**Interfaces:**
- Produces: 仅含 `poiId` 和版本号的分享参数；`deleteAccount()` 删除当前 OpenID 在所有个人集合中的记录。

- [ ] **Step 1: 写分享泄露和跨用户删除失败测试**

```ts
it('share payload contains no owner or private note', async () => {
  expect(await createSharePayload({ poiId: 'p1', owner: 'u1', note: '私密备注' } as never)).toEqual({ v: 1, poiId: 'p1' })
})

it('deletes only records owned by trusted context', async () => {
  await createDeleteHandler({ getOpenId: () => 'u1', repo })()
  expect(repo.deleteOwned).toHaveBeenCalledWith('u1', ['favorites', 'imports', 'recommendation_events', 'users'])
})
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm test -- tests/cloudfunctions/privacy.test.ts`  
Expected: FAIL，分享和删除处理器不存在。

- [ ] **Step 3: 实现分享、收藏接收和注销**

分享卡片只携带版本号与 POI ID；接收方重新读取公共 POI，并主动点击后写入自己的收藏。注销页二次确认后调用云函数，云函数以可信 OpenID 删除 `favorites`、`imports`、`recommendation_events`、`users`，不删除公共 `places`。

- [ ] **Step 4: 完成隐私声明和发布检查表**

`docs/privacy-data-inventory.json` 仅作内部数据台账，必须明确不是微信平台配置且不代表后台声明已完成。小程序后台“用户隐私保护指引”必须人工覆盖位置、收藏、导入链接和推荐反馈用途。`docs/release-checklist.md` 必须列出：CloudBase 生产套餐、数据库规则部署、高德配额与域名、密钥扫描、两个测试账号越权检查、定位拒绝、API 超时、空结果、缓存更新时间、分享接收和账号删除。

- [ ] **Step 5: 执行最终验证**

Run: `npm test && npm run typecheck && git diff --check`  
Expected: 全部通过且无 diff whitespace 错误。  
Manual: 使用两个微信测试账号验证互不可见；确认客户端包和网络请求不含高德 Key；在微信开发者工具完成真机预览。

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/share-place cloudfunctions/delete-account miniprogram/pages/place-detail miniprogram/pages/settings docs/privacy-data-inventory.json tests/cloudfunctions/privacy.test.ts docs/release-checklist.md
git commit -m "feat: complete private sharing and release controls"
```

## Final Verification

- [ ] Run: `npm test` — Expected: all tests PASS.
- [ ] Run: `npm run typecheck` — Expected: no TypeScript errors.
- [ ] Run: `git diff --check` — Expected: no output.
- [ ] Inspect the compiled mini-program bundle and client requests — Expected: no `AMAP_WEB_KEY`, OpenID, private notes or raw import records.
- [ ] With two real WeChat test accounts, repeat list/add/remove/share/delete flows — Expected: no cross-user read or write path.
- [ ] Record CloudBase environment ID, deployed function versions and database rule version in `docs/release-checklist.md` before submission.
