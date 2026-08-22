import { platformForUrl } from './url-policy'

export interface ShareTextSelection {
  url?: string
  name?: string
}

const URL_CANDIDATE = /(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/[^\s"'<>【】「」（）`，。；、！？]*)?/g
const BRACKETED_NAME = /[【「]([^】」]{2,40})[】」]/g
const AMAP_LINK = /(?:surl|uri)\.amap\.com\//
const LOOKS_LIKE_URL_OR_NUMBER = /https?:\/\/|[\w-]+\.[\w-]+\/|^[¥★☆\d]/

/**
 * Meituan/Dianping shop pages are login-walled or spider-verified against server-side fetches,
 * but their share messages embed the shop name in brackets: 【店名】推荐语 http://dpurl.cn/xxx.
 * This extracts both parts from a pasted share message; the URL is normalized to https.
 */
export function parseShareText(input: string): ShareTextSelection | undefined {
  const text = input.trim()
  if (!text) return undefined

  let url: string | undefined
  for (const candidate of text.match(URL_CANDIDATE) ?? []) {
    const trimmed = candidate.replace(/[).,;：；、！？]+$/, '')
    const normalized = trimmed.startsWith('http://')
      ? `https://${trimmed.slice('http://'.length)}`
      : trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`
    try {
      platformForUrl(normalized)
      url = normalized
      break
    } catch { /* not a supported platform host; try the next candidate */ }
  }

  let name: string | undefined
  for (const match of text.matchAll(BRACKETED_NAME)) {
    const candidate = match[1].trim()
    if (candidate && !/https?:\/\/|[\w-]+\.[\w-]+\//.test(candidate)) { name = candidate; break }
  }

  // AMap share messages put the shop name on the first line without brackets:
  // "店名(分店)\n¥62/人·烤肉\n地址\nhttps://surl.amap.com/xxx".
  if (!name && AMAP_LINK.test(text)) {
    name = text.split('\n')
      .map(line => line.trim())
      .find(line => line.length >= 2 && line.length <= 40 && !LOOKS_LIKE_URL_OR_NUMBER.test(line))
  }

  if (!url && !name) return undefined
  return { ...(url ? { url } : {}), ...(name ? { name } : {}) }
}
