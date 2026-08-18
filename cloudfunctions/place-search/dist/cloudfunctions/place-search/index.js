"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLACE_SEARCH_CLOUDBASE_ENV = exports.PLACE_SEARCH_BUILD_ID = void 0;
exports.main = main;
const amap_client_1 = require("./amap-client");
const cache_1 = require("./cache");
const errors_1 = require("../../src/shared/errors");
const cloudbase_sdk_1 = require("../shared/cloudbase-sdk");
const public_places_1 = require("../shared/public-places");
exports.PLACE_SEARCH_BUILD_ID = 'place-search-20260818-shared-sdk-v6';
exports.PLACE_SEARCH_CLOUDBASE_ENV = 'cloud1-d9gwjmdaj73a7dc0d';
function safeEntryError(error, entryStage) {
    const original = (0, errors_1.safePlaceSearchError)(error);
    const record = typeof error === 'object' && error !== null ? error : undefined;
    const diagnosticStage = typeof record?.diagnosticStage === 'string'
        ? record.diagnosticStage.slice(0, 32)
        : entryStage;
    const marker = `[build=${exports.PLACE_SEARCH_BUILD_ID};stage=${diagnosticStage};entry=${entryStage}]`;
    const safe = new errors_1.SafeError(original.code, `${original.message} ${marker}`);
    safe.diagnosticStage = diagnosticStage;
    safe.entryStage = entryStage;
    safe.buildId = exports.PLACE_SEARCH_BUILD_ID;
    return safe;
}
async function main(event, _context, injected) {
    let entryStage = 'SDK_INIT';
    try {
        const sdk = (0, cloudbase_sdk_1.selectCloudBaseSdk)(injected);
        const cloudbase = sdk.init({ env: exports.PLACE_SEARCH_CLOUDBASE_ENV });
        entryStage = 'DATABASE_INIT';
        const database = cloudbase.database();
        entryStage = 'ADAPTER_INIT';
        const service = (0, cache_1.createPlaceSearchService)({
            client: (0, amap_client_1.createAmapClient)(),
            cache: (0, cache_1.createCloudBaseSearchCache)(database),
            places: (0, public_places_1.createCloudBasePublicPlaceStore)(database),
        });
        entryStage = 'SERVICE_CALL';
        return await service.searchPlaces(event);
    }
    catch (error) {
        const safe = safeEntryError(error, entryStage);
        const record = safe;
        const unexpected = error instanceof errors_1.SafeError ? undefined : error;
        const unexpectedRecord = typeof unexpected === 'object' && unexpected !== null
            ? unexpected
            : undefined;
        const platformErrorCodeSource = typeof unexpectedRecord?.errorCode === 'string'
            || typeof unexpectedRecord?.errorCode === 'number'
            ? unexpectedRecord.errorCode
            : typeof unexpectedRecord?.code === 'string' ? unexpectedRecord.code : undefined;
        console.error({
            event: 'PLACE_SEARCH_FAILED',
            buildId: exports.PLACE_SEARCH_BUILD_ID,
            entryStage,
            errorName: safe.name,
            ...(typeof record?.code === 'string' ? { errorCode: record.code.slice(0, 64) } : {}),
            ...(platformErrorCodeSource !== undefined
                ? { platformErrorCode: String(platformErrorCodeSource).slice(0, 64) }
                : {}),
            ...(unexpected instanceof Error ? { unexpectedErrorName: unexpected.name.slice(0, 64) } : {}),
            ...(unexpected instanceof Error && entryStage !== 'SERVICE_CALL'
                ? { unexpectedErrorDetail: unexpected.message.slice(0, 160) }
                : {}),
            ...(typeof record?.diagnosticStage === 'string'
                ? { diagnosticStage: record.diagnosticStage.slice(0, 32) }
                : {}),
        });
        throw safe;
    }
}
