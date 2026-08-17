export const SHARE_POI_ID_MAX_CODE_UNITS = 128
export const SHARE_DETAIL_PATH_MAX_UTF8_BYTES = 512
export const SHARE_DETAIL_PATH_PREFIX = '/pages/place-detail/index?v=1&poiId='

export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) throw new Error('INVALID_SHARE_PAYLOAD')
      bytes += 4
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('INVALID_SHARE_PAYLOAD')
    else bytes += 3
  }
  return bytes
}

export function buildShareDetailPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_SHARE_PAYLOAD')
  const poiId = value.trim()
  if (!poiId || poiId.length > SHARE_POI_ID_MAX_CODE_UNITS) throw new Error('INVALID_SHARE_PAYLOAD')
  let path: string
  try { path = `${SHARE_DETAIL_PATH_PREFIX}${encodeURIComponent(poiId)}` } catch { throw new Error('INVALID_SHARE_PAYLOAD') }
  if (utf8ByteLength(path) > SHARE_DETAIL_PATH_MAX_UTF8_BYTES) throw new Error('INVALID_SHARE_PAYLOAD')
  return path
}

export function validateSharePoiId(value: unknown): string {
  buildShareDetailPath(value)
  return (value as string).trim()
}
