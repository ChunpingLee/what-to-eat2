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
function normalizeText(value) { return value.trim().toLocaleLowerCase('zh-CN'); }
function cacheKeyFor(query) {
    const normalized = JSON.stringify({
        keywords: normalizeText(query.keywords),
        latitude: query.center.latitude,
        longitude: query.center.longitude,
        city: normalizeText(query.city),
        radiusMeters: query.radiusMeters,
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
    if (!query.keywords.trim() || !query.city.trim() || !Number.isFinite(query.center.latitude) || !Number.isFinite(query.center.longitude)
        || !Number.isFinite(query.radiusMeters) || query.radiusMeters <= 0) {
        throw new errors_1.SafeError('INVALID_SEARCH_QUERY', 'Invalid place search query');
    }
}
function createPlaceSearchService(deps) {
    const now = deps.now ?? Date.now;
    return {
        async searchPlaces(query) {
            validate(query);
            const key = cacheKeyFor(query);
            const cached = await deps.cache.get(key);
            const currentTime = now();
            if (cached && currentTime - cached.cachedAt <= exports.FRESH_CACHE_TTL_MS)
                return { ...cached.result, stale: false };
            try {
                const items = await deps.client.search({
                    ...query,
                    keywords: query.keywords.trim(),
                    city: query.city.trim(),
                });
                const result = { items, sourceUpdatedAt: new Date(currentTime).toISOString() };
                await deps.cache.set({ key, cachedAt: currentTime, result });
                return { ...result, stale: false };
            }
            catch (error) {
                if (error instanceof errors_1.SafeError && error.code === 'AMAP_TIMEOUT'
                    && cached && currentTime - cached.cachedAt <= exports.STALE_CACHE_MAX_AGE_MS) {
                    return { ...cached.result, stale: true };
                }
                throw (0, errors_1.safePlaceSearchError)(error);
            }
        },
    };
}
function createCloudBaseSearchCache(database) {
    const collection = database.collection('place_search_cache');
    return {
        async get(key) {
            const result = await collection.doc(key).get();
            return result.data[0];
        },
        async set(entry) { await collection.doc(entry.key).set({ data: entry }); },
    };
}
