"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSharePayload = createSharePayload;
exports.createSharePlaceHandler = createSharePlaceHandler;
exports.main = main;
const share_1 = require("../../src/domain/share");
const cloudbase_sdk_1 = require("../shared/cloudbase-sdk");
const public_places_1 = require("../shared/public-places");
/** Builds the complete data payload allowed to leave one user's private list. */
function createSharePayload(input) {
    return { v: 1, poiId: (0, share_1.validateSharePoiId)(input?.poiId) };
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
    if (typeof record.poiId !== 'string' || typeof record.name !== 'string'
        || typeof location !== 'object' || location === null || Array.isArray(location))
        return undefined;
    const point = location;
    if (typeof point.latitude !== 'number' || !Number.isFinite(point.latitude)
        || typeof point.longitude !== 'number' || !Number.isFinite(point.longitude))
        return undefined;
    const projected = {
        poiId: (0, share_1.validateSharePoiId)(record.poiId),
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
function createSharePlaceHandler(deps) {
    return async (event) => {
        if (event?.v !== 1)
            throw new Error('INVALID_SHARE_PAYLOAD');
        const poiId = (0, share_1.validateSharePoiId)(event.poiId);
        const place = publicPlace(await deps.repo.findPublicByPoiId(poiId));
        if (!place)
            throw new Error('PLACE_NOT_FOUND');
        return { place };
    };
}
function main(event, _context, injected) {
    const sdk = (0, cloudbase_sdk_1.selectCloudBaseSdk)(injected);
    const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
    return createSharePlaceHandler({ repo: (0, public_places_1.createCloudBasePublicPlaceStore)(app.database()) })(event);
}
