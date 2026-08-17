import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const projectRoot = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(projectRoot, path), 'utf8')

it('initializes CloudBase with the current environment during app launch', () => {
  const app = read('miniprogram/app.ts')
  const cloud = read('miniprogram/services/cloud.ts')

  expect(app).toMatch(/cloudEnvironment:\s*wx\.cloud\.DYNAMIC_CURRENT_ENV/)
  expect(app).toMatch(/onLaunch\s*\([^)]*\)\s*\{[\s\S]*wx\.cloud\.init\(\{\s*env:\s*this\.globalData\.cloudEnvironment\s*\}\)/)
  expect(cloud).toContain('wx.cloud.callFunction')
})

it('declares a Mini Program root that the developer tool can import', () => {
  const config = JSON.parse(read('project.config.json')) as { miniprogramRoot?: string; compileType?: string }

  expect(config.miniprogramRoot).toBe('miniprogram/')
  expect(config.compileType).toBe('miniprogram')
})

it('registers a recommendation page and navigates there from the home page', () => {
  const appConfig = JSON.parse(read('miniprogram/app.json')) as { pages: string[] }
  const home = read('miniprogram/pages/home/index.wxml')

  expect(appConfig.pages).toContain('pages/recommend/index')
  expect(home).toContain('url="/pages/recommend/index"')
  expect(read('miniprogram/pages/recommend/index.wxml')).toContain('附近推荐')
})

it('uses a direct stable POI key for favorite cards', () => {
  expect(read('miniprogram/pages/home/index.wxml')).toContain('wx:key="poiId"')
})

it('renders an empty address safely when a place has no address', () => {
  expect(read('miniprogram/pages/home/index.wxml')).toContain("{{item.place.address || ''}}")
})
