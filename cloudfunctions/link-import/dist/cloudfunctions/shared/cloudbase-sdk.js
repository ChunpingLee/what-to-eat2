"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCloudBaseSdk = resolveCloudBaseSdk;
exports.selectCloudBaseSdk = selectCloudBaseSdk;
function looksLikeCloudBaseSdk(value) {
    return typeof value === 'object' && value !== null && typeof value.init === 'function';
}
/**
 * Rejects module exports that are not the @cloudbase/node-sdk 3.x server shape.
 * 4.x wraps the browser js-sdk as `{ default: ... }` (no top-level `init`) and is
 * NOT server-API compatible, so it must fail loudly instead of at first use.
 */
function resolveCloudBaseSdk(loaded) {
    if (looksLikeCloudBaseSdk(loaded))
        return loaded;
    const record = typeof loaded === 'object' && loaded !== null ? loaded : undefined;
    const version = typeof record?.version === 'string' ? record.version.slice(0, 32) : 'unknown';
    const keys = record ? Object.keys(record).slice(0, 12).join(',').slice(0, 96) : typeof loaded;
    throw new Error(`incompatible @cloudbase/node-sdk export (version=${version}, keys=${keys})`);
}
/**
 * The SCF runtime may pass a legacy callback (or other non-SDK value) as the third handler
 * argument, which silently replaces a `require('@cloudbase/node-sdk')` default parameter and
 * later fails with `sdk.init is not a function`. Only an argument that actually looks like the
 * server SDK is honored; everything else falls back to requiring the module directly.
 */
function selectCloudBaseSdk(injected, load = () => require('@cloudbase/node-sdk')) {
    if (looksLikeCloudBaseSdk(injected))
        return injected;
    if (injected !== undefined)
        console.error({ event: 'SDK_ARG_REJECTED', argType: typeof injected });
    return resolveCloudBaseSdk(load());
}
