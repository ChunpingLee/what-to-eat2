"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_CACHE_MAX_AGE_MS = exports.FRESH_CACHE_TTL_MS = void 0;
exports.cacheKeyFor = cacheKeyFor;
exports.createMemorySearchCache = createMemorySearchCache;
exports.createPlaceSearchService = createPlaceSearchService;
exports.createCloudBaseSearchCache = createCloudBaseSearchCache;
const node_crypto_1 = require("node:crypto");
const errors_1 = require("../../src/shared/errors");
exports.FRESH_CACHE_TTL_MS = 30 * 60 * 1_000;
exports.STALE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
async function atStage(stage, task) {
    try {
        return await task();
    }
    catch (error) {
        const safe = error instanceof errors_1.SafeError
            ? error
            : Object.assign(new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable'), {
                diagnosticStage: stage,
            });
        safe.diagnosticStage = stage;
        throw safe;
    }
}
function normalizeText(value) { return value.trim().toLocaleLowerCase('zh-CN'); }
function cacheKeyFor(query) {
    const normalized = JSON.stringify({
        keywords: normalizeText(query.keywords),
        latitude: query.center.latitude,
        longitude: query.center.longitude,
        city: normalizeText(query.city),
        radiusMeters: query.radiusMeters,
        types: query.types ? normalizeText(query.types) : '',
        // 仅翻页请求单独缓存；page 1/缺省保持与旧 key 完全一致，兼容既有缓存条目。
        ...(query.page !== undefined && query.page > 1 ? { page: query.page } : {}),
    });
    return (0, node_crypto_1.createHash)('sha256').update(normalized).digest('hex');
}
function createMemorySearchCache() {
    const entries = new Map();
    return {
        keyFor: cacheKeyFor,
        async get(key) { return entries.get(key); },
        async set(entry) { entries.set(entry.key, entry); },
    };
}
function validate(query) {
    if (!query || typeof query !== 'object'
        || typeof query.keywords !== 'string'
        || (query.types !== undefined && (typeof query.types !== 'string' || !query.types.trim()))
        || (!query.keywords.trim() && !(typeof query.types === 'string' && query.types.trim()))
        || typeof query.city !== 'string'
        || !query.center || typeof query.center !== 'object'
        || !Number.isFinite(query.center.latitude) || query.center.latitude < -90 || query.center.latitude > 90
        || !Number.isFinite(query.center.longitude) || query.center.longitude < -180 || query.center.longitude > 180
        || !Number.isFinite(query.radiusMeters) || query.radiusMeters <= 0 || query.radiusMeters > 50_000
        || (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1 || query.page > 100))) {
        throw new errors_1.SafeError('INVALID_SEARCH_QUERY', 'Invalid place search query');
    }
}
function createPlaceSearchService(deps) {
    const now = deps.now ?? Date.now;
    const persistPlaces = async (result) => {
        if (!deps.places)
            return;
        try {
            await deps.places.upsertMany(result.items, result.sourceUpdatedAt);
        }
        catch (error) {
            const failedCount = typeof error === 'object' && error !== null && 'failedCount' in error
                && typeof error.failedCount === 'number'
                ? error.failedCount
                : result.items.length;
            const warning = { code: 'PUBLIC_PLACE_PERSIST_FAILED', failedCount };
            if (deps.onPlacePersistenceWarning)
                deps.onPlacePersistenceWarning(warning);
            else
                console.error(warning);
        }
    };
    return {
        async searchPlaces(query) {
            validate(query);
            const key = cacheKeyFor(query);
            const cached = await atStage('CACHE_READ', () => deps.cache.get(key));
            const currentTime = now();
            if (cached && currentTime - cached.cachedAt <= exports.FRESH_CACHE_TTL_MS) {
                await persistPlaces(cached.result);
                return { ...cached.result, stale: false };
            }
            try {
                const items = await atStage('AMAP_SEARCH', () => deps.client.search({
                    ...query,
                    keywords: query.keywords.trim(),
                    city: query.city.trim(),
                }));
                const result = { items, sourceUpdatedAt: new Date(currentTime).toISOString() };
                await atStage('CACHE_WRITE', () => deps.cache.set({ key, cachedAt: currentTime, result }));
                await persistPlaces(result);
                return { ...result, stale: false };
            }
            catch (error) {
                if (error instanceof errors_1.SafeError && error.code === 'AMAP_TIMEOUT'
                    && cached && currentTime - cached.cachedAt <= exports.STALE_CACHE_MAX_AGE_MS) {
                    await persistPlaces(cached.result);
                    return { ...cached.result, stale: true };
                }
                throw (0, errors_1.safePlaceSearchError)(error);
            }
        },
    };
}
function cachedSearchFromDocument(data) {
    const first = Array.isArray(data) ? data[0] : data;
    if (typeof first !== 'object' || first === null || Array.isArray(first))
        return undefined;
    const record = first;
    const candidate = typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
        ? record.data
        : record;
    if (typeof candidate.key !== 'string' || !Number.isFinite(candidate.cachedAt)
        || typeof candidate.result !== 'object' || candidate.result === null || Array.isArray(candidate.result))
        return undefined;
    const result = candidate.result;
    if (!Array.isArray(result.items) || typeof result.sourceUpdatedAt !== 'string')
        return undefined;
    return candidate;
}
function createCloudBaseSearchCache(database) {
    const collection = database.collection('place_search_cache');
    return {
        async get(key) {
            const result = await collection.doc(key).get();
            return cachedSearchFromDocument(result.data);
        },
        async set(entry) { await collection.doc(entry.key).set(entry); },
    };
}
