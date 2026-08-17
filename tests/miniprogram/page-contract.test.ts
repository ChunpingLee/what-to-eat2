import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const projectRoot = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(projectRoot, path), 'utf8')

function filesUnder(path: string): string[] {
  return readdirSync(join(projectRoot, path), { withFileTypes: true }).flatMap(entry => {
    const child = `${path}/${entry.name}`
    return entry.isDirectory() ? filesUnder(child) : [child]
  })
}

it('initializes CloudBase with the current environment during app launch', () => {
  const app = read('miniprogram/app.ts')
  const cloud = read('miniprogram/services/cloud.ts')

  expect(app).toMatch(/cloudEnvironment:\s*['"]cloud1-d9gwjmdaj73a7dc0d['"]/)
  expect(app).toMatch(/onLaunch\s*\([^)]*\)\s*\{[\s\S]*wx\.cloud\.init\(\{\s*env:\s*this\.globalData\.cloudEnvironment\s*\}\)/)
  expect(cloud).toContain('wx.cloud.callFunction')
})

it('declares a Mini Program root that the developer tool can import', () => {
  const config = JSON.parse(read('project.config.json')) as {
    miniprogramRoot?: string
    cloudfunctionRoot?: string
    compileType?: string
    setting?: { useCompilerPlugins?: string[] | false }
  }

  expect(config.miniprogramRoot).toBe('miniprogram/')
  expect(config.cloudfunctionRoot).toBe('cloudfunctions/')
  expect(config.setting?.useCompilerPlugins).toContain('typescript')
  expect(config.compileType).toBe('miniprogram')
})

it('keeps every Mini Program runtime import inside the package root', () => {
  for (const path of filesUnder('miniprogram').filter(path => path.endsWith('.ts'))) {
    expect(read(path), path).not.toMatch(/import\s+(?!type\b)[^'"]*from\s+['"][^'"]*(?:\.\.\/)+src\//)
  }
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

it('binds a pre-encoded detail path instead of concatenating an unescaped POI id in WXML', () => {
  const home = read('miniprogram/pages/home/index.wxml')
  expect(home).toContain('url="{{item.detailPath}}"')
  expect(home).not.toContain('poiId={{item.place.poiId}}')
})

it('renders an empty address safely when a place has no address', () => {
  expect(read('miniprogram/pages/home/index.wxml')).toContain("{{item.place.address || ''}}")
})

it('registers the branch search page and exposes it from the home page', () => {
  const appConfig = JSON.parse(read('miniprogram/app.json')) as { pages: string[] }

  expect(appConfig.pages).toContain('pages/place-search/index')
  expect(read('miniprogram/pages/home/index.wxml')).toContain('url="/pages/place-search/index"')
  expect(read('miniprogram/pages/place-search/index.wxml')).toContain('branch-picker')
})

it('keeps branch search reachable while home is waiting for location permission', () => {
  const home = read('miniprogram/pages/home/index.wxml')
  const beforeLocationBranch = home.slice(0, home.indexOf("status === 'locationRequired'"))

  expect(beforeLocationBranch).toContain('url="/pages/place-search/index"')
  expect(read('miniprogram/pages/place-search/index.wxml')).toContain('bindtap="onManualLocation"')
})

it('renders precomputed branch selection instead of invoking array methods in WXML', () => {
  const picker = read('miniprogram/components/branch-picker/index.wxml')

  expect(picker).toContain('item.selected')
  expect(picker).not.toMatch(/selectedPoiIds\s*\./)
})

it('registers the safe link import page and keeps it reachable before location permission', () => {
  const appConfig = JSON.parse(read('miniprogram/app.json')) as { pages: string[] }
  const home = read('miniprogram/pages/home/index.wxml')
  const beforeLocationBranch = home.slice(0, home.indexOf("status === 'locationRequired'"))

  expect(appConfig.pages).toContain('pages/import/index')
  expect(beforeLocationBranch).toContain('url="/pages/import/index"')
  expect(read('miniprogram/pages/import/index.wxml')).toContain('branch-picker')
})

it('calls only the link-import cloud function from the import client and supports search fallback navigation', () => {
  const cloud = read('miniprogram/services/cloud.ts')
  const page = read('miniprogram/pages/import/index.wxml')

  expect(cloud).toContain("name: 'link-import'")
  expect(page).toContain('url="{{searchUrl}}"')
  expect(page).toContain('url="/pages/place-search/index"')
})
