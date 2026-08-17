"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSharePayload = createSharePayload;
exports.createCloudBasePublicPlaceRepository = createCloudBasePublicPlaceRepository;
exports.createSharePlaceHandler = createSharePlaceHandler;
exports.main = main;
const MAX_POI_ID_LENGTH = 128;
function validPoiId(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_POI_ID_LENGTH;
}
/** Builds the complete data payload allowed to leave one user's private list. */
function createSharePayload(input) {
    if (!validPoiId(input?.poiId))
        throw new Error('INVALID_SHARE_PAYLOAD');
    return { v: 1, poiId: input.poiId.trim() };
}
function optionalText(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function optionalNumber(record, key) {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function optionalTextArray(record, key) {
    const value = record[key];
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;
}
/** Explicit projection prevents future private/cache fields from leaking in a share response. */
function publicPlace(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const record = value;
    const location = record.location;
    if (!validPoiId(record.poiId) || typeof record.name !== 'string'
        || typeof location !== 'object' || location === null || Array.isArray(location))
        return undefined;
    const point = location;
    if (typeof point.latitude !== 'number' || !Number.isFinite(point.latitude)
        || typeof point.longitude !== 'number' || !Number.isFinite(point.longitude))
        return undefined;
    const projected = {
        poiId: record.poiId.trim(),
        name: record.name,
        location: { latitude: point.latitude, longitude: point.longitude },
    };
    const address = optionalText(record, 'address');
    const businessArea = optionalText(record, 'businessArea');
    const categories = optionalTextArray(record, 'categories');
    const rating = optionalNumber(record, 'rating');
    const averageCost = optionalNumber(record, 'averageCost');
    const tags = optionalTextArray(record, 'tags');
    const photos = optionalTextArray(record, 'photos');
    const businessStatus = optionalText(record, 'businessStatus');
    return {
        ...projected,
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
function createCloudBasePublicPlaceRepository(database) {
    return {
        async findPublicByPoiId(poiId) {
            const result = await database.collection('places').where({ poiId }).limit(1).get();
            return result.data[0];
        },
    };
}
function createSharePlaceHandler(deps) {
    return async (event) => {
        if (event?.v !== 1 || !validPoiId(event.poiId))
            throw new Error('INVALID_SHARE_PAYLOAD');
        const place = publicPlace(await deps.repo.findPublicByPoiId(event.poiId.trim()));
        if (!place)
            throw new Error('PLACE_NOT_FOUND');
        return { place };
    };
}
function main(event, _context, sdk = require('@cloudbase/node-sdk')) {
    const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
    return createSharePlaceHandler({ repo: createCloudBasePublicPlaceRepository(app.database()) })(event);
}
