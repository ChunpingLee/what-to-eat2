"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmapTimeoutError = void 0;
exports.createAmapClient = createAmapClient;
const errors_1 = require("../../src/shared/errors");
class AmapTimeoutError extends errors_1.SafeError {
    constructor() { super('AMAP_TIMEOUT', 'Place search timed out'); }
}
exports.AmapTimeoutError = AmapTimeoutError;
function trimmed(value) {
    const result = value?.trim();
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
    const items = value?.split(';').map(item => item.trim()).filter(Boolean);
    return items && items.length > 0 ? items : undefined;
}
function mapPoi(poi) {
    const [longitudeText, latitudeText] = poi.location.split(',');
    const longitude = Number(longitudeText);
    const latitude = Number(latitudeText);
    if (!poi.id || !poi.name || !Number.isFinite(longitude) || !Number.isFinite(latitude))
        return undefined;
    const bizExt = Array.isArray(poi.biz_ext) ? undefined : poi.biz_ext;
    const photos = poi.photos?.flatMap(photo => {
        const url = trimmed(photo.url);
        return url ? [url] : [];
    });
    return {
        poiId: poi.id,
        name: poi.name,
        location: { latitude, longitude },
        address: poi.address ?? '',
        businessArea: trimmed(poi.business_area),
        categories: split(poi.type) ?? [],
        rating: numeric(bizExt?.rating),
        averageCost: numeric(bizExt?.cost),
        tags: split(poi.tag),
        photos: photos && photos.length > 0 ? photos : undefined,
        businessStatus: trimmed(bizExt?.business_status) ?? trimmed(poi.business_status),
    };
}
async function fetchAmap(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
        const params = new URLSearchParams({
            key: query.key,
            keywords: query.keywords,
            location: query.location,
            city: query.city,
            radius: String(query.radius),
        });
        const response = await fetch(`https://restapi.amap.com/v5/place/text?${params}`, { signal: controller.signal });
        if (!response.ok)
            throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable');
        return await response.json();
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError')
            throw new AmapTimeoutError();
        if (error instanceof errors_1.SafeError)
            throw error;
        throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable');
    }
    finally {
        clearTimeout(timer);
    }
}
function createAmapClient({ key = process.env.AMAP_WEB_KEY, http = fetchAmap } = {}) {
    if (!key)
        throw new errors_1.SafeError('AMAP_NOT_CONFIGURED', 'Place search is not configured');
    return {
        async search(query) {
            const response = await http({
                key,
                keywords: query.keywords.trim(),
                location: `${query.center.longitude},${query.center.latitude}`,
                city: query.city.trim(),
                radius: query.radiusMeters,
            });
            return (response.pois ?? []).flatMap(poi => {
                const mapped = mapPoi(poi);
                return mapped ? [mapped] : [];
            });
        },
    };
}
