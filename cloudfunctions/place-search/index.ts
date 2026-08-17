import { createAmapClient, type PlaceSearchQuery } from './amap-client'
import { createCloudBaseSearchCache, createPlaceSearchService, type CloudBaseCacheDatabase } from './cache'
import { SafeError, safePlaceSearchError } from '../../src/shared/errors'
import { createCloudBasePublicPlaceStore, type PublicPlacesDatabase } from '../shared/public-places'

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  init(options: { env: unknown }): { database(): CloudBaseCacheDatabase & PublicPlacesDatabase }
}

export const PLACE_SEARCH_BUILD_ID = 'place-search-20260817-node16-v1'
type EntryStage = 'SDK_INIT' | 'DATABASE_INIT' | 'ADAPTER_INIT' | 'SERVICE_CALL'

function safeEntryError(error: unknown, entryStage: EntryStage) {
  const original = safePlaceSearchError(error)
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined
  const diagnosticStage = typeof record?.diagnosticStage === 'string'
    ? record.diagnosticStage.slice(0, 32)
    : entryStage
  const marker = `[build=${PLACE_SEARCH_BUILD_ID};stage=${diagnosticStage};entry=${entryStage}]`
  const safe = new SafeError(original.code, `${original.message} ${marker}`) as SafeError & {
    code: string; diagnosticStage: string; entryStage: EntryStage; buildId: string
  }
  safe.diagnosticStage = diagnosticStage
  safe.entryStage = entryStage
  safe.buildId = PLACE_SEARCH_BUILD_ID
  return safe
}

export async function main(
  event: PlaceSearchQuery,
  _context: unknown,
  sdk: CloudBaseSdk = require('@cloudbase/node-sdk') as CloudBaseSdk,
) {
  let entryStage: EntryStage = 'SDK_INIT'
  try {
    const cloudbase = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV })
    entryStage = 'DATABASE_INIT'
    const database = cloudbase.database()
    entryStage = 'ADAPTER_INIT'
    const service = createPlaceSearchService({
      client: createAmapClient(),
      cache: createCloudBaseSearchCache(database),
      places: createCloudBasePublicPlaceStore(database),
    })
    entryStage = 'SERVICE_CALL'
    return await service.searchPlaces(event)
  } catch (error) {
    const safe = safeEntryError(error, entryStage)
    const record = safe as unknown as Record<string, unknown>
    console.error({
      event: 'PLACE_SEARCH_FAILED',
      buildId: PLACE_SEARCH_BUILD_ID,
      entryStage,
      errorName: safe.name,
      ...(typeof record?.code === 'string' ? { errorCode: record.code.slice(0, 64) } : {}),
      ...(typeof record?.errorCode === 'string' || typeof record?.errorCode === 'number'
        ? { platformErrorCode: String(record.errorCode).slice(0, 64) }
        : {}),
      ...(typeof record?.diagnosticStage === 'string'
        ? { diagnosticStage: record.diagnosticStage.slice(0, 32) }
        : {}),
    })
    throw safe
  }
}
