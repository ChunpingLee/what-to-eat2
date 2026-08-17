export interface PlaceHint {
  name: string
  city?: string
  address?: string
  branch?: string
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
}

function clean(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = decodeHtml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text && text.length <= maxLength ? text : undefined
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) result[match[1].toLowerCase()] = decodeHtml(match[3])
  return result
}

function meta(html: string, keys: readonly string[]): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0])
    if (keys.includes((attrs.property || attrs.name || '').toLowerCase())) return clean(attrs.content, 300)
  }
  return undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function findBusiness(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) { const found = findBusiness(item); if (found) return found }
    return undefined
  }
  const item = record(value)
  if (!item) return undefined
  const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']]
  if (types.some(type => typeof type === 'string' && /restaurant|foodestablishment|localbusiness|store/i.test(type))) return item
  const graph = findBusiness(item['@graph'])
  if (graph) return graph
  for (const nested of Object.values(item)) { const found = findBusiness(nested); if (found) return found }
  return undefined
}

function jsonLd(html: string): Record<string, unknown> | undefined {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const found = findBusiness(JSON.parse(match[2])); if (found) return found } catch { /* malformed markup degrades */ }
  }
  return undefined
}

function title(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return clean(match?.[1], 200)
}

function normalizeName(value: string | undefined): string | undefined {
  const result = value
    ?.replace(/\s*[-_|]\s*(?:大众点评|美团(?:网)?|高德地图).*$/i, '')
    .replace(/^【[^】]+】\s*/, '')
    .trim()
  if (!result || /^(?:大众点评|美团(?:网)?|高德地图|登录|首页|页面不存在)$/i.test(result)) return undefined
  return result
}

function branchFrom(name: string): string | undefined {
  return clean(name.match(/[（(]([^()（）]{1,30}(?:店|馆|广场|中心))[）)]\s*$/)?.[1], 40)
}

export function extractPlaceHint(html: string): PlaceHint | undefined {
  const business = jsonLd(html)
  const address = record(business?.address)
  const name = normalizeName(clean(business?.name, 120) ?? meta(html, ['og:title', 'twitter:title']) ?? title(html))
  if (!name) return undefined
  const description = meta(html, ['description', 'og:description'])
  const extractedAddress = clean(address?.streetAddress, 200)
    ?? clean(description?.match(/(?:地址|位置)[：:]\s*([^|；;]{2,180})/)?.[1], 200)
  const city = clean(address?.addressLocality, 60)
    ?? clean(description?.match(/((?:北京|上海|天津|重庆)市|[^\s，,]{2,8}市)/)?.[1], 60)
  return {
    name,
    ...(city ? { city } : {}),
    ...(extractedAddress ? { address: extractedAddress } : {}),
    ...(branchFrom(name) ? { branch: branchFrom(name) } : {}),
  }
}
