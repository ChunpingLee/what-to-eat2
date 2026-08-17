"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const amap_routes_1 = require("./amap-routes");
async function main(event) {
    try {
        return { times: await (0, amap_routes_1.createAmapRoutesClient)().times(event.origin, event.destinations, event.mode) };
    }
    catch (error) {
        if (error instanceof amap_routes_1.AmapRoutesError)
            throw error;
        throw new amap_routes_1.AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
    }
}
