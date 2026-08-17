"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicPlacePersistenceError = void 0;
exports.publicPlaceDocumentId = publicPlaceDocumentId;
exports.normalizedPublicPlace = normalizedPublicPlace;
exports.createCloudBasePublicPlaceStore = createCloudBasePublicPlaceStore;
const node_crypto_1 = require("node:crypto");
class PublicPlacePersistenceError extends Error {
    failedCount;
    code = 'PUBLIC_PLACE_PERSIST_FAILED';
    constructor(failedCount) {
        super('PUBLIC_PLACE_PERSIST_FAILED');
        this.failedCount = failedCount;
        this.name = 'PublicPlacePersistenceError';
    }
}
exports.PublicPlacePersistenceError = PublicPlacePersistenceError;
function publicPlaceDocumentId(poiId) {
    return (0, node_crypto_1.createHash)('sha256').update(poiId).digest('hex');
}
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function number(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function textArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;
}
function normalizedPublicPlace(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const record = value;
    const poiId = text(record.poiId);
    const name = text(record.name);
    const location = record.location;
    if (!poiId || !name || typeof location !== 'object' || location === null || Array.isArray(location))
        return undefined;
    const point = location;
    const latitude = number(point.latitude);
    const longitude = number(point.longitude);
    if (latitude === undefined || longitude === undefined)
        return undefined;
    const address = text(record.address);
    const businessArea = text(record.businessArea);
    const categories = textArray(record.categories);
    const rating = number(record.rating);
    const averageCost = number(record.averageCost);
    const tags = textArray(record.tags);
    const photos = textArray(record.photos);
    const businessStatus = text(record.businessStatus);
    return {
        poiId, name, location: { latitude, longitude },
        ...(address ? { address } : {}),
        ...(businessArea ? { businessArea } : {}),
        ...(categories ? { categories } : {}),
        ...(rating === undefined ? {} : { rating }),
        ...(averageCost === undefined ? {} : { averageCost }),
        ...(tags ? { tags } : {}),
        ...(photos ? { photos } : {}),
        ...(businessStatus ? { businessStatus } : {}),
    };
}
function createCloudBasePublicPlaceStore(database) {
    const places = database.collection('places');
    return {
        async upsertMany(items, sourceUpdatedAt) {
            const results = await Promise.allSettled(items.map(async (item) => {
                const place = normalizedPublicPlace(item);
                if (!place)
                    throw new Error('INVALID_PUBLIC_PLACE');
                await places.doc(publicPlaceDocumentId(place.poiId)).set({ data: { ...place, sourceUpdatedAt } });
            }));
            const failedCount = results.filter(result => result.status === 'rejected').length;
            if (failedCount)
                throw new PublicPlacePersistenceError(failedCount);
        },
        async findPublicByPoiId(poiId) {
            try {
                const direct = await places.doc(publicPlaceDocumentId(poiId)).get();
                if (direct.data[0])
                    return direct.data[0];
            }
            catch {
                // Compatibility fallback supports records created before deterministic IDs.
            }
            const legacy = await places.where({ poiId }).limit(1).get();
            return legacy.data[0];
        },
    };
}
