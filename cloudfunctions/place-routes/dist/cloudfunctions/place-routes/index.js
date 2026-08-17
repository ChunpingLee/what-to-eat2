"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const amap_routes_1 = require("./amap-routes");
const rate_limiter_1 = require("./rate-limiter");
async function main(event, _context, sdk = require('@cloudbase/node-sdk')) {
    try {
        const database = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV }).database();
        const limiter = (0, rate_limiter_1.createCloudBaseRouteRateLimiter)(database);
        return { times: await (0, amap_routes_1.createAmapRoutesClient)({ limiter }).times(event.origin, event.destinations, event.mode) };
    }
    catch (error) {
        if (error instanceof amap_routes_1.AmapRoutesError)
            throw error;
        throw new amap_routes_1.AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
    }
}
