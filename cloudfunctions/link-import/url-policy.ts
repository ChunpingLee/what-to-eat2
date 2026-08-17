import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

export const MAX_REDIRECTS = 3
export const MAX_RESPONSE_BYTES = 1024 * 1024
export const TOTAL_TIMEOUT_MS = 5_000

export type LinkImportErrorCode = 'UNSUPPORTED_LINK' | 'LINK_UNAVAILABLE'

export class LinkImportError extends Error {
  constructor(public readonly code: LinkImportErrorCode, message: string) {
    super(message)
    this.name = 'LinkImportError'
  }
}

export function unsupportedLink(): LinkImportError {
  return new LinkImportError('UNSUPPORTED_LINK', 'UNSUPPORTED_LINK')
}

export function unavailableLink(): LinkImportError {
  return new LinkImportError('LINK_UNAVAILABLE', 'Link import is temporarily unavailable')
}

export type LinkPlatform = 'meituan' | 'dianping' | 'amap'

const PLATFORM_BY_HOST: ReadonlyMap<string, LinkPlatform> = new Map([
  ['www.meituan.com', 'meituan'],
  ['m.meituan.com', 'meituan'],
  ['www.dianping.com', 'dianping'],
  ['m.dianping.com', 'dianping'],
  ['www.amap.com', 'amap'],
  ['ditu.amap.com', 'amap'],
])

export function parseAllowedUrl(input: string | URL): URL {
  let url: URL
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input)
  } catch {
    throw unsupportedLink()
  }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || !PLATFORM_BY_HOST.get(hostname)) {
    throw unsupportedLink()
  }
  return url
}

export function platformForUrl(input: string | URL): LinkPlatform {
  const platform = PLATFORM_BY_HOST.get(parseAllowedUrl(input).hostname)
  if (!platform) throw unsupportedLink()
  return platform
}

export interface ResolvedAddress { address: string; family: number }
export type AddressLookup = (hostname: string, signal?: AbortSignal) => Promise<ResolvedAddress[]>

const defaultLookup: AddressLookup = async hostname => dnsLookup(hostname, { all: true, verbatim: true })

function parseIpv4(address: string): number[] | undefined {
  const values = address.split('.').map(Number)
  return values.length === 4 && values.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    ? values
    : undefined
}

function isGlobalIpv4(address: string): boolean {
  const value = parseIpv4(address)
  if (!value) return false
  const [a, b, c] = value
  return !(a === 0
    || a === 10
    || a === 100 && b >= 64 && b <= 127
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 0
    || a === 192 && b === 88 && c === 99
    || a === 192 && b === 168
    || a === 198 && (b === 18 || b === 19)
    || a === 198 && b === 51 && c === 100
    || a === 203 && b === 0 && c === 113
    || a >= 224)
}

function ipv6Groups(address: string): number[] | undefined {
  let normalized = address
  const dotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (dotted) {
    const ipv4 = parseIpv4(dotted)
    if (!ipv4) return undefined
    normalized = normalized.slice(0, -dotted.length)
      + ((ipv4[0] << 8) | ipv4[1]).toString(16)
      + ':' + ((ipv4[2] << 8) | ipv4[3]).toString(16)
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0
  const groups = [...left, ...Array.from({ length: omitted }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return undefined
  return groups.map(group => Number.parseInt(group, 16))
}

function isGlobalAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  if (isIP(normalized) === 4) return isGlobalIpv4(normalized)
  if (isIP(normalized) !== 6) return false
  const groups = ipv6Groups(normalized)
  if (!groups) return false
  const ipv4Embedded = groups.slice(0, 4).every(group => group === 0)
    && (groups[4] === 0xffff || groups[5] === 0xffff)
  if (ipv4Embedded) return false

  const globallyAllocated = groups[0] >= 0x2000 && groups[0] <= 0x3fff
  const reserved2001 = groups[0] === 0x2001 && groups[1] <= 0x01ff
  const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8
    || groups[0] >= 0x3ff0 && groups[0] <= 0x3fff
  const transition = groups[0] === 0x2002
  return globallyAllocated && !reserved2001 && !documentation && !transition
}

function canonicalAddress(address: string): string | undefined {
  const normalized = address.toLowerCase().split('%')[0]
  if (isIP(normalized) === 4) return parseIpv4(normalized)?.join('.')
  if (isIP(normalized) !== 6) return undefined
  return ipv6Groups(normalized)?.map(group => group.toString(16)).join(':')
}

export interface ResolvedUrl {
  url: URL
  address: string
  family: number
}

export async function resolveAllowedUrl(
  input: string | URL,
  lookup: AddressLookup = defaultLookup,
  signal?: AbortSignal,
): Promise<ResolvedUrl> {
  const url = parseAllowedUrl(input)
  if (signal?.aborted) throw unavailableLink()
  let addresses: ResolvedAddress[]
  try {
    addresses = await lookup(url.hostname, signal)
  } catch {
    throw unavailableLink()
  }
  if (signal?.aborted) throw unavailableLink()
  if (!addresses.length || addresses.some(result =>
    !isGlobalAddress(result.address)
    || result.family !== isIP(result.address)
    || result.family !== 4 && result.family !== 6,
  )) throw unsupportedLink()
  const selected = addresses[0]
  return { url, address: selected.address, family: selected.family }
}

export interface SafeHttpResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array>
}
export type SafeHttpRequest = (target: ResolvedUrl, signal: AbortSignal) => Promise<SafeHttpResponse>

export type HttpsTransport = typeof httpsRequest

export function createPinnedHttpsRequest(transport: HttpsTransport = httpsRequest): SafeHttpRequest {
  return (target, signal) => new Promise((resolve, reject) => {
    let verified = false
    const fixedLookup = ((_hostname, _options, callback) => {
      callback(null, target.address, target.family)
    }) as LookupFunction
    const request = transport(target.url, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'most-want-to-eat-link-import/1.0',
      },
      lookup: fixedLookup,
      servername: target.url.hostname,
      rejectUnauthorized: true,
      agent: false,
      signal,
    }, response => {
      if (!verified) { request.destroy(unavailableLink()); return }
      resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response })
    })
    request.once('socket', socket => {
      socket.once('secureConnect', () => {
        const remote = socket.remoteAddress
        if (!remote || !isGlobalAddress(remote) || canonicalAddress(remote) !== canonicalAddress(target.address)) {
          request.destroy(unavailableLink())
          return
        }
        verified = true
      })
    })
    request.once('error', reject)
    request.end()
  })
}

const defaultRequest = createPinnedHttpsRequest()

export interface FetchedPage { url: string; body: string }

function header(headers: SafeHttpResponse['headers'], name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

async function readLimitedBody(response: SafeHttpResponse, signal: AbortSignal): Promise<string> {
  const declared = Number(header(response.headers, 'content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw unavailableLink()
  const parts: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body) {
    if (signal.aborted) throw unavailableLink()
    bytes += chunk.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw unavailableLink()
    parts.push(chunk)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const part of parts) { body.set(part, offset); offset += part.byteLength }
  return new TextDecoder('utf-8', { fatal: false }).decode(body)
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(unavailableLink())
    else signal.addEventListener('abort', () => reject(unavailableLink()), { once: true })
  })
}

export function createSafePageFetcher({
  lookup = defaultLookup,
  request = defaultRequest,
}: { lookup?: AddressLookup; request?: SafeHttpRequest } = {}) {
  return async (input: string): Promise<FetchedPage> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS)
    const operation = async () => {
      let current = parseAllowedUrl(input)
      for (let redirects = 0; ; redirects += 1) {
        const target = await resolveAllowedUrl(current, lookup, controller.signal)
        if (controller.signal.aborted) throw unavailableLink()
        const response = await request(target, controller.signal)
        if (response.status >= 300 && response.status < 400) {
          await readLimitedBody(response, controller.signal)
          const location = header(response.headers, 'location')
          if (!location || redirects >= MAX_REDIRECTS) throw unavailableLink()
          current = parseAllowedUrl(new URL(location, current))
          continue
        }
        if (response.status < 200 || response.status >= 300) throw unavailableLink()
        return { url: current.href, body: await readLimitedBody(response, controller.signal) }
      }
    }
    try {
      return await Promise.race([operation(), abortPromise(controller.signal)])
    } catch (error) {
      if (error instanceof LinkImportError) throw error
      throw unavailableLink()
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}

export const fetchAllowedPage = createSafePageFetcher()
