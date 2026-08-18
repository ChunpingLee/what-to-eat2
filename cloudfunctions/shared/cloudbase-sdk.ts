interface CloudBaseSdkShape {
  init: (...args: never[]) => unknown
}

function looksLikeCloudBaseSdk(value: unknown): value is CloudBaseSdkShape {
  return typeof value === 'object' && value !== null && typeof (value as CloudBaseSdkShape).init === 'function'
}

/**
 * Rejects module exports that are not the @cloudbase/node-sdk 3.x server shape.
 * 4.x wraps the browser js-sdk as `{ default: ... }` (no top-level `init`) and is
 * NOT server-API compatible, so it must fail loudly instead of at first use.
 */
export function resolveCloudBaseSdk<Sdk>(loaded: unknown): Sdk {
  if (looksLikeCloudBaseSdk(loaded)) return loaded as Sdk
  const record = typeof loaded === 'object' && loaded !== null ? loaded as Record<string, unknown> : undefined
  const version = typeof record?.version === 'string' ? record.version.slice(0, 32) : 'unknown'
  const keys = record ? Object.keys(record).slice(0, 12).join(',').slice(0, 96) : typeof loaded
  throw new Error(`incompatible @cloudbase/node-sdk export (version=${version}, keys=${keys})`)
}

/**
 * The SCF runtime may pass a legacy callback (or other non-SDK value) as the third handler
 * argument, which silently replaces a `require('@cloudbase/node-sdk')` default parameter and
 * later fails with `sdk.init is not a function`. Only an argument that actually looks like the
 * server SDK is honored; everything else falls back to requiring the module directly.
 */
export function selectCloudBaseSdk<Sdk>(
  injected: unknown,
  load: () => unknown = () => require('@cloudbase/node-sdk'),
): Sdk {
  if (looksLikeCloudBaseSdk(injected)) return injected as Sdk
  if (injected !== undefined) console.error({ event: 'SDK_ARG_REJECTED', argType: typeof injected })
  return resolveCloudBaseSdk<Sdk>(load())
}
