"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmapRoutesError = void 0;
exports.createAmapRouteHttp = createAmapRouteHttp;
exports.createAmapRoutesClient = createAmapRoutesClient;
class AmapRoutesError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'AmapRoutesError';
        this.code = code;
    }
}
exports.AmapRoutesError = AmapRoutesError;
const endpointByMode = {
    walking: '/v5/direction/walking',
    bicycling: '/v5/direction/bicycling',
    driving: '/v5/direction/driving',
};
function coordinate(point) {
    return `${point.longitude},${point.latitude}`;
}
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function firstRecord(value) {
    return Array.isArray(value) ? record(value[0]) : undefined;
}
function durationSeconds(response) {
    const body = record(response);
    if (body?.status !== '1')
        return undefined;
    const path = firstRecord(record(body.route)?.paths);
    const raw = record(path?.cost)?.duration;
    const duration = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}
function createAmapRouteHttp(fetcher = fetch) {
    return async (query) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
            const params = new URLSearchParams({
                key: query.key,
                origin: query.origin,
                destination: query.destination,
                show_fields: 'cost',
            });
            const response = await fetcher(`https://restapi.amap.com${endpointByMode[query.mode]}?${params}`, {
                signal: controller.signal,
            });
            if (!response.ok)
                throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
            return await response.json();
        }
        catch (error) {
            if (error instanceof AmapRoutesError)
                throw error;
            throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
        }
        finally {
            clearTimeout(timer);
        }
    };
}
function validPoint(point) {
    return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
        && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}
function createAmapRoutesClient({ key = process.env.AMAP_WEB_KEY, http = createAmapRouteHttp(), } = {}) {
    if (!key)
        throw new AmapRoutesError('AMAP_ROUTES_NOT_CONFIGURED', '路线服务未配置');
    return {
        async times(origin, destinations, mode) {
            if (!validPoint(origin) || destinations.length > 20 || destinations.some(point => !validPoint(point))) {
                throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
            }
            if (destinations.length === 0)
                return [];
            const settled = await Promise.allSettled(destinations.map(async (destination) => {
                const response = await http({
                    key,
                    origin: coordinate(origin),
                    destination: coordinate(destination),
                    mode,
                });
                const seconds = durationSeconds(response);
                if (seconds === undefined)
                    throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
                return Math.ceil(seconds / 60);
            }));
            const result = settled.map(item => item.status === 'fulfilled' ? item.value : undefined);
            if (result.every(item => item === undefined)) {
                throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
            }
            return result;
        },
    };
}
