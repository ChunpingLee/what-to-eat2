"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAmapDistanceHttp = createAmapDistanceHttp;
exports.createAmapDistanceClient = createAmapDistanceClient;
const errors_1 = require("../../src/shared/errors");
const https_json_1 = require("../shared/https-json");
/** 单次调用最多 100 个起点（高德文档上限）。 */
const DISTANCE_MAX_ORIGINS = 100;
const DISTANCE_TYPE_BY_MODE = {
    walking: '3',
    driving: '1',
};
function createAmapDistanceHttp(fetcher = (0, https_json_1.createHttpsJsonFetch)()) {
    return async (query) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
            const params = new URLSearchParams({
                key: query.key,
                origins: query.origins,
                destination: query.destination,
                type: query.type,
            });
            const response = await fetcher(`https://restapi.amap.com/v3/distance?${params}`, { signal: controller.signal });
            if (!response.ok)
                throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable');
            return await response.json();
        }
        catch (error) {
            if (error instanceof errors_1.SafeError)
                throw error;
            throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable');
        }
        finally {
            clearTimeout(timer);
        }
    };
}
function validPoint(point) {
    if (typeof point !== 'object' || point === null || Array.isArray(point))
        return false;
    const candidate = point;
    return Number.isFinite(candidate.latitude) && candidate.latitude >= -90 && candidate.latitude <= 90
        && Number.isFinite(candidate.longitude) && candidate.longitude >= -180 && candidate.longitude <= 180;
}
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function createAmapDistanceClient({ key = process.env.AMAP_WEB_KEY, http = createAmapDistanceHttp(), } = {}) {
    if (!key)
        throw new errors_1.SafeError('AMAP_NOT_CONFIGURED', 'Place travel times are not configured');
    return {
        async times(origin, destinations, mode) {
            if (mode !== 'walking' && mode !== 'driving'
                || !validPoint(origin)
                || !Array.isArray(destinations) || destinations.length > DISTANCE_MAX_ORIGINS
                || destinations.some(point => !validPoint(point))) {
                throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable');
            }
            if (destinations.length === 0)
                return [];
            const response = await http({
                key,
                origins: destinations.map(point => `${point.longitude},${point.latitude}`).join('|'),
                destination: `${origin.longitude},${origin.latitude}`,
                type: DISTANCE_TYPE_BY_MODE[mode],
            });
            if (response.status !== '1' || !Array.isArray(response.results)) {
                throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable');
            }
            // 响应按 origin_id（1 基）对应入参顺序；单条缺失或无 duration（如步行超 5km）→ undefined。
            const minutes = destinations.map(() => undefined);
            for (const value of response.results) {
                const row = record(value);
                const id = Number(row?.origin_id);
                const raw = row?.duration;
                const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
                if (Number.isInteger(id) && id >= 1 && id <= destinations.length
                    && Number.isFinite(seconds) && seconds >= 0) {
                    minutes[id - 1] = Math.ceil(seconds / 60);
                }
            }
            if (minutes.every(item => item === undefined)) {
                throw new errors_1.SafeError('AMAP_UNAVAILABLE', 'Place travel times are temporarily unavailable');
            }
            return minutes;
        },
    };
}
