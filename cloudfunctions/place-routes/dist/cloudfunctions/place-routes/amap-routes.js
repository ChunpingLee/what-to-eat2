"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmapRoutesError = void 0;
exports.createAmapRouteHttp = createAmapRouteHttp;
exports.createAmapRoutesClient = createAmapRoutesClient;
const https_json_1 = require("../shared/https-json");
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
    bicycling: '/v4/direction/bicycling',
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
function durationSeconds(response, mode) {
    const body = record(response);
    if (mode === 'bicycling' && body?.errcode !== 0 && body?.errcode !== '0')
        return undefined;
    if (mode !== 'bicycling' && body?.status !== '1')
        return undefined;
    const path = mode === 'bicycling'
        ? firstRecord(record(body?.data)?.paths)
        : firstRecord(record(body?.route)?.paths);
    const raw = mode === 'bicycling' ? path?.duration : record(path?.cost)?.duration;
    const duration = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}
function createAmapRouteHttp(fetcher = (0, https_json_1.createHttpsJsonFetch)(), now = Date.now) {
    return async (query) => {
        const remainingMs = query.deadlineMs - now();
        if (remainingMs <= 0)
            throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(8_000, remainingMs));
        try {
            const params = new URLSearchParams({
                key: query.key,
                origin: query.origin,
                destination: query.destination,
            });
            if (query.mode !== 'bicycling')
                params.set('show_fields', 'cost');
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
    if (typeof point !== 'object' || point === null || Array.isArray(point))
        return false;
    const candidate = point;
    return Number.isFinite(candidate.latitude) && candidate.latitude >= -90 && candidate.latitude <= 90
        && Number.isFinite(candidate.longitude) && candidate.longitude >= -180 && candidate.longitude <= 180;
}
function createAmapRoutesClient({ key = process.env.AMAP_WEB_KEY, http = createAmapRouteHttp(), limiter, requestTimeoutMs = 8_000, now = Date.now, }) {
    if (!key)
        throw new AmapRoutesError('AMAP_ROUTES_NOT_CONFIGURED', '路线服务未配置');
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
        throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
    }
    return {
        async times(origin, destinations, mode) {
            if (!validPoint(origin) || !Array.isArray(destinations) || destinations.length > 20
                || destinations.some(point => !validPoint(point))
                || !['walking', 'bicycling', 'driving'].includes(mode)) {
                throw new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
            }
            if (destinations.length === 0)
                return [];
            const deadlineMs = now() + requestTimeoutMs;
            const settled = await Promise.allSettled(destinations.map(async (destination) => {
                await limiter.acquire({ key, service: mode, deadlineMs });
                const response = await http({
                    key,
                    origin: coordinate(origin),
                    destination: coordinate(destination),
                    mode,
                    deadlineMs,
                });
                const seconds = durationSeconds(response, mode);
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
