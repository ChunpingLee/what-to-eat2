import { expect, it, vi } from 'vitest'

it('creates every collection before deploying its management-side rule', async () => {
  const events: string[] = []
  const manager = {
    database: {
      createCollectionIfNotExists: vi.fn(async (name: string) => { events.push(`create:${name}`) }),
    },
    commonService: () => ({
      call: vi.fn(async (request: { Param: { CollectionName: string } }) => {
        events.push(`rule:${request.Param.CollectionName}`)
      }),
    }),
  }
  const collections = [
    { name: 'favorites', aclTag: 'CUSTOM', rule: { read: 'owner', write: false } },
    { name: 'place_search_cache', aclTag: 'CUSTOM', rule: { read: false, write: false } },
  ]

  const { deployRules } = require('../../cloudbase/deploy-rules-core') as {
    deployRules(manager: unknown, envId: string, collections: unknown[]): Promise<void>
  }
  await deployRules(manager, 'prod-env', collections)

  expect(events).toEqual([
    'create:favorites', 'create:place_search_cache',
    'rule:favorites', 'rule:place_search_cache',
  ])
})
