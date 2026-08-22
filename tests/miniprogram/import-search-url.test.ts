import { describe, expect, it } from 'vitest'
import { buildSearchUrl } from '../../miniprogram/pages/import/index'
import { searchPrefill } from '../../miniprogram/pages/place-search/index'

function parseQuery(url: string): Record<string, string> {
  const options: Record<string, string> = {}
  for (const pair of url.slice(url.indexOf('?') + 1).split('&')) {
    const eq = pair.indexOf('=')
    options[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return options
}

describe('import page search fallback url', () => {
  it('round-trips real share keywords and city through the place-search prefill', () => {
    const url = buildSearchUrl('懂你吉林烧烤·小龙虾·东北菜(广兰路店)', ' 上海 ')

    expect(url.startsWith('/pages/place-search/index?')).toBe(true)
    expect(searchPrefill(parseQuery(url))).toEqual({
      keywords: '懂你吉林烧烤·小龙虾·东北菜(广兰路店)',
      city: '上海',
    })
  })

  it('omits the city parameter when blank and keeps keywords encoded', () => {
    const url = buildSearchUrl('示例火锅', '')
    expect(url).toBe(`/pages/place-search/index?keywords=${encodeURIComponent('示例火锅')}`)
    expect(searchPrefill(parseQuery(url))).toEqual({ keywords: '示例火锅', city: '' })
  })
})
