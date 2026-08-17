import { extractPlaceHint, type PlaceHint } from './shared'

export function parseAmapPage(html: string): PlaceHint | undefined {
  return extractPlaceHint(html)
}
