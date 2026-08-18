import { createAmapClient, type PlaceSearchQuery } from './amap-client'
import { createCloudBaseSearchCache, createPlaceSearchService, type CloudBaseCacheDatabase } from './cache'
import { SafeError, safePlaceSearchError } from '../../src/shared/errors'
import { selectCloudBaseSdk } from '../shared/cloudbase-sdk'
import { createCloudBasePublicPlaceStore, type PublicPlacesDatabase } from '../shared/public-places'

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  init(options: { env: unknown }): { database(): CloudBaseCacheDatabase & PublicPlacesDatabase }
}

export const PLACE_SEARCH_BUILD_ID = 'place-search-20260818-shared-sdk-v6'
export const PLACE_SEARCH_CLOUDBASE_ENV = 'cloud1-d9gwjmdaj73a7dc0d'
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
  injected?: unknown,
) {
  let entryStage: EntryStage = 'SDK_INIT'
  try {
    const sdk = selectCloudBaseSdk<CloudBaseSdk>(injected)
    const cloudbase = sdk.init({ env: PLACE_SEARCH_CLOUDBASE_ENV })
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
    const unexpected = error instanceof SafeError ? undefined : error
    const unexpectedRecord = typeof unexpected === 'object' && unexpected !== null
      ? unexpected as Record<string, unknown>
      : undefined
    const platformErrorCodeSource = typeof unexpectedRecord?.errorCode === 'string'
      || typeof unexpectedRecord?.errorCode === 'number'
      ? unexpectedRecord.errorCode
      : typeof unexpectedRecord?.code === 'string' ? unexpectedRecord.code : undefined
    console.error({
      event: 'PLACE_SEARCH_FAILED',
      buildId: PLACE_SEARCH_BUILD_ID,
      entryStage,
      errorName: safe.name,
      ...(typeof record?.code === 'string' ? { errorCode: record.code.slice(0, 64) } : {}),
      ...(platformErrorCodeSource !== undefined
        ? { platformErrorCode: String(platformErrorCodeSource).slice(0, 64) }
        : {}),
      ...(unexpected instanceof Error ? { unexpectedErrorName: unexpected.name.slice(0, 64) } : {}),
      ...(unexpected instanceof Error && entryStage !== 'SERVICE_CALL'
        ? { unexpectedErrorDetail: unexpected.message.slice(0, 160) }
        : {}),
      ...(typeof record?.diagnosticStage === 'string'
        ? { diagnosticStage: record.diagnosticStage.slice(0, 32) }
        : {}),
    })
    throw safe
  }
}
