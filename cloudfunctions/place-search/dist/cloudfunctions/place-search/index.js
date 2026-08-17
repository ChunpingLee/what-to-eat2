"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const amap_client_1 = require("./amap-client");
const cache_1 = require("./cache");
const errors_1 = require("../../src/shared/errors");
async function main(event, _context, sdk = require('@cloudbase/node-sdk')) {
    try {
        const cloudbase = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
        return await (0, cache_1.createPlaceSearchService)({
            client: (0, amap_client_1.createAmapClient)(),
            cache: (0, cache_1.createCloudBaseSearchCache)(cloudbase.database()),
        }).searchPlaces(event);
    }
    catch (error) {
        throw (0, errors_1.safePlaceSearchError)(error);
    }
}
