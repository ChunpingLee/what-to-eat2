import { extractPlaceHint, type PlaceHint } from './shared'

export function parseMeituanPage(html: string): PlaceHint | undefined {
  return extractPlaceHint(html)
}
