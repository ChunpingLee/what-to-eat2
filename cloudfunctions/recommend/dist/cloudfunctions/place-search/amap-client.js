"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmapTimeoutError = void 0;
exports.createAmapHttp = createAmapHttp;
exports.createAmapClient = createAmapClient;
const errors_1 = require("../../src/shared/errors");
const https_json_1 = require("../shared/https-json");
class AmapTimeoutError extends errors_1.SafeError {
    constructor() { super('AMAP_TIMEOUT', 'Place search timed out'); }
}
exports.AmapTimeoutError = AmapTimeoutError;
function trimmed(value) {
    const result = typeof value === 'string' ? value.trim() : undefined;
    return result || undefined;
}
function numeric(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function split(value) {
    const text = trimmed(value);
    const items = text?.split(';').map(item => item.trim()).filter(Boolean);
    return items && items.length > 0 ? items : undefined;
}
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function mapPoi(value) {
    const poi = record(value);
    const location = trimmed(poi?.location);
    const id = trimmed(poi?.id);
    const name = trimmed(poi?.name);
    if (!poi || !location || !id || !name)
        return undefined;
    const [longitudeText, latitudeText] = location.split(',');
    const longitude = Number(longitudeText);
    const latitude = Number(latitudeText);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude))
        return undefined;
    const business = record(poi.business);
    const photos = Array.isArray(poi.photos) ? poi.photos.flatMap(photo => {
        const url = trimmed(record(photo)?.url);
        return url ? [url] : [];
    }) : undefined;
    const address = trimmed(poi.address);
    const categories = split(poi.type);
    const businessArea = trimmed(business?.business_area);
    const rating = numeric(business?.rating);
    const averageCost = numeric(business?.cost);
    const tags = split(business?.tag);
    const businessStatus = trimmed(business?.business_status) ?? trimmed(poi.business_status);
    return {
        poiId: id,
        name,
        location: { latitude, longitude },
        ...(address ? { address } : {}),
        ...(categories ? { categories } : {}),
        ...(businessArea ? { businessArea } : {}),
        ...(rating === undefined ? {} : { rating }),
        ...(averageCost === undefined ? {} : { averageCost }),
        ...(tags ? { tags } : {}),
        ...(photos && photos.length > 0 ? { photos } : {}),
        ...(businessStatus ? { businessStatus } : {}),
    };
}
function createAmapHttp(fetcher = (0, https_json_1.createHttpsJsonFetch)(), diagnostic = value => console.error(value)) {
    return async (query) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
            const params = new URLSearchParams({
                key: query.key,
                location: query.location,
                radius: String(query.radius),
                show_fields: query.showFields,
            });
            if (query.keywords.trim())
                params.set('keywords', query.keywords);
            if (query.types?.trim())
                params.set('types', query.types.trim());
            if (query.region) {
                params.set('region', query.region);
                params.set('city_limit', String(query.cityLimit));
            }
            if (query.pageSize !== undefined)
                params.set('page_size', String(query.pageSize));
            // 注意：v5 接口翻页参数是 page_num（v3 的 page 会被忽略，导致每次都返回第 1 页）。
            if (query.page !== undefined && query.page > 1)
                params.set('page_num', String(query.page));
            const response = await fetcher(`https://restapi.amap.com/v5/place/around?${params}`, { signal: controller.signal });
            if (!response.ok)
                throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable');
            return await response.json();
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError')
                throw new AmapTimeoutError();
            if (error instanceof errors_1.SafeError)
                throw error;
            const record = typeof error === 'object' && error !== null ? error : undefined;
            const source = error instanceof Error
                ? error.stack?.match(/\/var\/user\/[^?():\s]+:\d+:\d+/)?.[0]
                : undefined;
            diagnostic({
                event: 'AMAP_HTTP_FAILED',
                errorName: error instanceof Error ? error.name.slice(0, 64) : typeof error,
                ...(typeof record?.code === 'string' ? { errorCode: record.code.slice(0, 64) } : {}),
                ...(source ? { source } : {}),
            });
            throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable');
        }
        finally {
            clearTimeout(timer);
        }
    };
}
function createAmapClient({ key = process.env.AMAP_WEB_KEY, http = createAmapHttp(), diagnostic = value => console.error(value), } = {}) {
    if (!key)
        throw new errors_1.SafeError('AMAP_NOT_CONFIGURED', 'Place search is not configured');
    return {
        async search(query) {
            const response = await http({
                key,
                keywords: query.keywords.trim(),
                location: `${query.center.longitude},${query.center.latitude}`,
                radius: query.radiusMeters,
                ...(query.city.trim() ? { region: query.city.trim() } : {}),
                cityLimit: Boolean(query.city.trim()),
                showFields: 'business,photos',
                pageSize: 25,
                ...(query.types?.trim() ? { types: query.types.trim() } : {}),
                ...(query.page !== undefined && query.page > 1 ? { page: query.page } : {}),
            });
            if (response.status !== '1' || !Array.isArray(response.pois)) {
                diagnostic({
                    event: 'AMAP_API_REJECTED',
                    ...(typeof response.status === 'string' ? { status: response.status.slice(0, 16) } : {}),
                    ...(typeof response.infocode === 'string' ? { infocode: response.infocode.slice(0, 32) } : {}),
                });
                throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable');
            }
            return response.pois.flatMap(poi => {
                const mapped = mapPoi(poi);
                return mapped ? [mapped] : [];
            });
        },
    };
}
