"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCloudBaseSdk = resolveCloudBaseSdk;
exports.selectCloudBaseSdk = selectCloudBaseSdk;
exports.wxContextFromEnv = wxContextFromEnv;
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
const WX_PREFIX = 'WX_';
const CONTEXT_KEYS_BLACKLIST = ['API_TOKEN', 'TRIGGER_API_TOKEN_V0'];
/**
 * Reads the per-invocation WeChat caller context from environment variables, mirroring
 * wx-server-sdk's getWXContext(): the runtime lists injected keys in WX_CONTEXT_KEYS
 * (prefixed like WX_OPENID) and this exposes them with the prefix stripped (OPENID).
 * @cloudbase/node-sdk's getCloudbaseContext does NOT strip the prefix, so its `.OPENID`
 * is always undefined in WeChat cloud functions.
 */
function wxContextFromEnv(env = process.env) {
    const result = {};
    const declared = env.WX_CONTEXT_KEYS;
    if (!declared)
        return result;
    for (const key of declared.split(',')) {
        if (!key)
            continue;
        if (CONTEXT_KEYS_BLACKLIST.some(blacklisted => key === blacklisted || WX_PREFIX + blacklisted === key))
            continue;
        const value = env[key];
        if (value === undefined)
            continue;
        result[key.startsWith(WX_PREFIX) && key.length > WX_PREFIX.length ? key.slice(WX_PREFIX.length) : key] = value;
    }
    return result;
}
