import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Place } from '../../src/domain/favorites'
import { createLinkImporter } from '../../cloudfunctions/link-import/index'
import {
  MAX_RESPONSE_BYTES,
  createSafePageFetcher,
  resolveAllowedUrl,
  type AddressLookup,
  type SafeHttpRequest,
} from '../../cloudfunctions/link-import/url-policy'

const publicLookup: AddressLookup = async () => [{ address: '93.184.216.34', family: 4 }]
const encoded = (value: string) => new TextEncoder().encode(value)
const chunks = (...values: Uint8Array[]): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() { yield* values },
})

function response(
  status: number,
  body = '',
  headers: Record<string, string | string[] | undefined> = {},
) {
  return { status, headers, body: chunks(encoded(body)) }
}

function place(poiId: string, name = '示例火锅'): Place {
  return { poiId, name, location: { latitude: 31.23, longitude: 121.47 } }
}

describe('link import URL policy', () => {
  it.each([
    'http://www.dianping.com/shop/abc',
    'https://evil.example/a',
    'file:///etc/passwd',
    'https://dianping.com.evil.example/shop/abc',
    'https://user@www.dianping.com/shop/abc',
  ])('rejects unsupported URL %s', async url => {
    await expect(resolveAllowedUrl(url, publicLookup)).rejects.toMatchObject({ code: 'UNSUPPORTED_LINK' })
  })

  it.each([
    'https://www.meituan.com/meishi/123',
    'https://m.dianping.com/shop/abc',
    'https://ditu.amap.com/place/xyz',
  ])('accepts a controlled platform host %s and resolves it before connecting', async url => {
    await expect(resolveAllowedUrl(url, publicLookup)).resolves.toMatchObject({
      url: new URL(url), address: '93.184.216.34', family: 4,
    })
  })

  it.each(['127.0.0.1', '10.0.0.8', '169.254.169.254', '172.16.0.2', '192.168.1.2', '::1', 'fe80::1', 'fc00::1', '::ffff:7f00:1'])
  ('rejects DNS results that are loopback, private, or link-local: %s', async address => {
    const lookup: AddressLookup = async () => [{ address, family: address.includes(':') ? 6 : 4 }]
    await expect(resolveAllowedUrl('https://www.dianping.com/shop/abc', lookup))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_LINK' })
  })

  it('rejects the whole host when any returned DNS address is private', async () => {
    const lookup: AddressLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    await expect(resolveAllowedUrl('https://www.dianping.com/shop/abc', lookup))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_LINK' })
  })

  it('revalidates every redirect and never requests a redirect whose DNS becomes private', async () => {
    const lookup = vi.fn<AddressLookup>()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    const request = vi.fn<SafeHttpRequest>()
      .mockResolvedValueOnce(response(302, '', { location: 'https://m.dianping.com/shop/private' }))
    const fetchPage = createSafePageFetcher({ lookup, request })

    await expect(fetchPage('https://www.dianping.com/shop/start')).rejects.toMatchObject({ code: 'UNSUPPORTED_LINK' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toMatchObject({ address: '93.184.216.34', family: 4 })
  })

  it('allows at most three redirects', async () => {
    const request = vi.fn<SafeHttpRequest>()
      .mockImplementation(async target => response(302, '', { location: new URL(`/next${request.mock.calls.length}`, target.url).href }))
    const fetchPage = createSafePageFetcher({ lookup: publicLookup, request })

    await expect(fetchPage('https://www.dianping.com/start')).rejects.toMatchObject({ code: 'LINK_UNAVAILABLE' })
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('limits the complete response body to one MiB', async () => {
    const request: SafeHttpRequest = async () => ({
      status: 200,
      headers: {},
      body: chunks(new Uint8Array(MAX_RESPONSE_BYTES), new Uint8Array([1])),
    })
    const fetchPage = createSafePageFetcher({ lookup: publicLookup, request })

    await expect(fetchPage('https://www.meituan.com/meishi/1')).rejects.toMatchObject({ code: 'LINK_UNAVAILABLE' })
  })

  it('applies the one-MiB limit to redirect responses too', async () => {
    const request = vi.fn<SafeHttpRequest>().mockResolvedValue({
      status: 302,
      headers: { location: 'https://m.meituan.com/meishi/2' },
      body: chunks(new Uint8Array(MAX_RESPONSE_BYTES + 1)),
    })
    const fetchPage = createSafePageFetcher({ lookup: publicLookup, request })

    await expect(fetchPage('https://www.meituan.com/meishi/1')).rejects.toMatchObject({ code: 'LINK_UNAVAILABLE' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('applies one five-second deadline across DNS, redirects, connection, and reading', async () => {
    vi.useFakeTimers()
    try {
      const request: SafeHttpRequest = (_target, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('socket details'), { name: 'AbortError' })))
      })
      const fetchPage = createSafePageFetcher({ lookup: publicLookup, request })
      const result = fetchPage('https://www.amap.com/place/1')
      const rejection = expect(result).rejects.toMatchObject({ code: 'LINK_UNAVAILABLE', message: 'Link import is temporarily unavailable' })
      await vi.advanceTimersByTimeAsync(5_001)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('link import parsing and fallback', () => {
  it.each([
    ['https://www.meituan.com/meishi/1', '<meta property="og:title" content="示例火锅（静安店）"><meta name="description" content="上海市静安区示例路1号">', '示例火锅（静安店）'],
    ['https://www.dianping.com/shop/abc', '<script type="application/ld+json">{"@type":"Restaurant","name":"示例火锅（静安店）","address":{"addressLocality":"上海市","streetAddress":"示例路1号"}}</script>', '示例火锅（静安店）'],
    ['https://www.amap.com/place/xyz', '<title>示例火锅(静安店) - 高德地图</title><meta name="description" content="地址：上海市静安区示例路1号">', '示例火锅(静安店)'],
  ])('extracts a minimal shop clue and returns search keywords for %s when no POI matches', async (url, html, expectedName) => {
    const matchPlaces = vi.fn().mockResolvedValue([])
    const importLink = createLinkImporter({ fetchPage: vi.fn().mockResolvedValue({ url, body: html }), matchPlaces })

    await expect(importLink(url)).resolves.toEqual({ status: 'search', keywords: expectedName })
    expect(matchPlaces).toHaveBeenCalledWith(expect.objectContaining({ name: expectedName }))
  })

  it('returns a unique matched POI from the existing place-search matcher', async () => {
    const candidate = place('p1')
    const importLink = createLinkImporter({
      fetchPage: vi.fn().mockResolvedValue({
        url: 'https://www.dianping.com/shop/abc', body: '<title>示例火锅 - 大众点评</title>',
      }),
      matchPlaces: vi.fn().mockResolvedValue([candidate]),
    })

    await expect(importLink('https://www.dianping.com/shop/abc')).resolves.toEqual({ status: 'matched', candidates: [candidate] })
  })

  it('returns every candidate so the existing multi-branch picker can disambiguate', async () => {
    const candidates = [place('p1', '示例火锅（静安店）'), place('p2', '示例火锅（徐汇店）')]
    const importLink = createLinkImporter({
      fetchPage: vi.fn().mockResolvedValue({ url: 'https://m.meituan.com/meishi/1', body: '<title>示例火锅 - 美团</title>' }),
      matchPlaces: vi.fn().mockResolvedValue(candidates),
    })

    await expect(importLink('https://m.meituan.com/meishi/1')).resolves.toEqual({ status: 'matched', candidates })
  })

  it('falls back to manual entry when a supported page contains no safe shop name', async () => {
    const importLink = createLinkImporter({
      fetchPage: vi.fn().mockResolvedValue({ url: 'https://www.amap.com/', body: '<html><body>登录后查看</body></html>' }),
      matchPlaces: vi.fn(),
    })

    await expect(importLink('https://www.amap.com/')).resolves.toEqual({ status: 'manual' })
  })

  it('does not expose low-level fetch errors or source page content', async () => {
    const importLink = createLinkImporter({
      fetchPage: vi.fn().mockRejectedValue(new Error('ECONNRESET secret page fragment')),
      matchPlaces: vi.fn(),
    })

    await expect(importLink('https://www.dianping.com/shop/abc')).rejects.toMatchObject({
      code: 'LINK_UNAVAILABLE', message: 'Link import is temporarily unavailable',
    })
    await expect(importLink('https://www.dianping.com/shop/abc')).rejects.not.toThrow('secret')
  })

  it('provides a deployable CloudBase entrypoint', () => {
    const packageRoot = resolve(process.cwd(), 'cloudfunctions/link-import')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { main: string }
    const entry = resolve(packageRoot, manifest.main)

    expect(existsSync(entry)).toBe(true)
    expect(require(entry).main).toBeTypeOf('function')
  })
})
