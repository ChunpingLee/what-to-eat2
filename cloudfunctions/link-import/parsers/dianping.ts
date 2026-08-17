import { extractPlaceHint, type PlaceHint } from './shared'

export function parseDianpingPage(html: string): PlaceHint | undefined {
  return extractPlaceHint(html)
}
