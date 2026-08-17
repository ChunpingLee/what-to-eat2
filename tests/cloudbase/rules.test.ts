import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('defines per-collection deployable rules that deny direct writes to private data', () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'cloudbase/database.rules.json'), 'utf8')) as {
    collections: Array<{ name: string; aclTag: string; rule: { read: unknown; write: unknown } }>
  }
  const byName = new Map(manifest.collections.map(collection => [collection.name, collection]))

  for (const name of ['favorites', 'imports', 'recommendation_events', 'users']) {
    expect(byName.get(name)).toMatchObject({
      aclTag: 'CUSTOM',
      rule: { read: 'doc._openid == auth.openid', write: false },
    })
  }
  expect(byName.get('places')).toMatchObject({ aclTag: 'CUSTOM', rule: { read: true, write: false } })
  expect(byName.get('amap_route_rate_limits')).toMatchObject({
    aclTag: 'CUSTOM',
    rule: { read: false, write: false },
  })
  expect(byName.get('place_search_cache')).toMatchObject({
    aclTag: 'CUSTOM',
    rule: { read: false, write: false },
  })
})

it('exposes the rule manifest through an executable deployment command', () => {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  expect(packageJson.scripts['rules:deploy']).toBe('node cloudbase/deploy-rules.js')
})
