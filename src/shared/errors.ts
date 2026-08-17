export type PlaceSearchErrorCode =
  | 'INVALID_SEARCH_QUERY'
  | 'AMAP_NOT_CONFIGURED'
  | 'AMAP_TIMEOUT'
  | 'AMAP_UNAVAILABLE'

/** An error whose public code and message are safe to return from a cloud function. */
export class SafeError extends Error {
  constructor(public readonly code: PlaceSearchErrorCode, message: string) {
    super(message)
    this.name = 'SafeError'
  }
}

export function safePlaceSearchError(error: unknown): SafeError {
  if (error instanceof SafeError) return error
  return new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable')
}
