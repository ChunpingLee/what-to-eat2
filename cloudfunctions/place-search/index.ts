import { createAmapClient, type PlaceSearchQuery } from './amap-client'
import { createCloudBaseSearchCache, createPlaceSearchService, type CloudBaseCacheDatabase } from './cache'
import { safePlaceSearchError } from '../../src/shared/errors'
import { createCloudBasePublicPlaceStore, type PublicPlacesDatabase } from '../shared/public-places'

interface CloudBaseSdk {
  SYMBOL_CURRENT_ENV: unknown
  init(options: { env: unknown }): { database(): CloudBaseCacheDatabase & PublicPlacesDatabase }
}

export async function main(
  event: PlaceSearchQuery,
  _context: unknown,
  sdk: CloudBaseSdk = require('@cloudbase/node-sdk') as CloudBaseSdk,
) {
  try {
    const cloudbase = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV })
    const database = cloudbase.database()
    return await createPlaceSearchService({
      client: createAmapClient(),
      cache: createCloudBaseSearchCache(database),
      places: createCloudBasePublicPlaceStore(database),
    }).searchPlaces(event)
  } catch (error) {
    throw safePlaceSearchError(error)
  }
}
