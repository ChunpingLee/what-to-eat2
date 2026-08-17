"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLinkImporter = createLinkImporter;
exports.importLink = importLink;
exports.main = main;
const amap_client_1 = require("../place-search/amap-client");
const cache_1 = require("../place-search/cache");
const amap_1 = require("./parsers/amap");
const dianping_1 = require("./parsers/dianping");
const meituan_1 = require("./parsers/meituan");
const url_policy_1 = require("./url-policy");
function parserFor(url) {
    const hostname = (0, url_policy_1.parseAllowedUrl)(url).hostname;
    if (hostname === 'meituan.com' || hostname.endsWith('.meituan.com'))
        return meituan_1.parseMeituanPage;
    if (hostname === 'dianping.com' || hostname.endsWith('.dianping.com'))
        return dianping_1.parseDianpingPage;
    return amap_1.parseAmapPage;
}
function safeError(error) {
    return error instanceof url_policy_1.LinkImportError ? error : (0, url_policy_1.unavailableLink)();
}
function createLinkImporter(deps) {
    return async (url) => {
        (0, url_policy_1.parseAllowedUrl)(url);
        let page;
        try {
            page = await deps.fetchPage(url);
        }
        catch (error) {
            throw safeError(error);
        }
        let hint;
        try {
            hint = parserFor(page.url)(page.body);
        }
        catch {
            return { status: 'manual' };
        }
        if (!hint?.name)
            return { status: 'manual' };
        try {
            const candidates = await deps.matchPlaces(hint);
            const unique = [...new Map(candidates.map(candidate => [candidate.poiId, candidate])).values()];
            if (unique.length)
                return { status: 'matched', candidates: unique };
        }
        catch {
            // A failed POI lookup still leaves a safe keyword for the existing search page.
        }
        return { status: 'search', keywords: hint.name };
    };
}
async function importLink(url, deps) {
    return createLinkImporter(deps ?? { fetchPage: url_policy_1.fetchAllowedPage, matchPlaces: async () => [] })(url);
}
function centerFrom(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const center = value;
    return typeof center.latitude === 'number' && Number.isFinite(center.latitude)
        && typeof center.longitude === 'number' && Number.isFinite(center.longitude)
        ? { latitude: center.latitude, longitude: center.longitude }
        : undefined;
}
async function main(event, _context, sdk = require('@cloudbase/node-sdk')) {
    try {
        if (typeof event?.url !== 'string')
            throw (0, url_policy_1.unavailableLink)();
        const center = centerFrom(event.center);
        const eventCity = typeof event.city === 'string' ? event.city.trim() : '';
        let service;
        const matchPlaces = async (hint) => {
            const city = hint.city?.trim() || eventCity;
            if (!center || !city)
                return [];
            if (!service) {
                const cloudbase = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
                service = (0, cache_1.createPlaceSearchService)({
                    client: (0, amap_client_1.createAmapClient)(),
                    cache: (0, cache_1.createCloudBaseSearchCache)(cloudbase.database()),
                });
            }
            return (await service.searchPlaces({ keywords: hint.name, city, center, radiusMeters: 5_000 })).items;
        };
        return await createLinkImporter({ fetchPage: url_policy_1.fetchAllowedPage, matchPlaces })(event.url);
    }
    catch (error) {
        throw safeError(error);
    }
}
