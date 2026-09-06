"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationRequestError = void 0;
exports.createRecommendHandler = createRecommendHandler;
exports.createLazyRouteTimesClient = createLazyRouteTimesClient;
exports.main = main;
const geo_1 = require("../../src/domain/geo");
const restaurant_categories_1 = require("../../src/domain/restaurant-categories");
const recommendation_1 = require("../../src/domain/recommendation");
const amap_client_1 = require("../place-search/amap-client");
const cache_1 = require("../place-search/cache");
const amap_routes_1 = require("../place-routes/amap-routes");
const rate_limiter_1 = require("../place-routes/rate-limiter");
const cloudbase_sdk_1 = require("../shared/cloudbase-sdk");
const public_places_1 = require("../shared/public-places");
class RecommendationRequestError extends Error {
    code = 'INVALID_RECOMMENDATION_REQUEST';
    constructor() {
        super('推荐条件无效');
        this.name = 'RecommendationRequestError';
    }
}
exports.RecommendationRequestError = RecommendationRequestError;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => value?.trim() ?? '';
const normalized = (value) => value.trim().toLocaleLowerCase('zh-CN');
function validPoint(point) {
    return finite(point?.latitude) && point.latitude >= -90 && point.latitude <= 90
        && finite(point?.longitude) && point.longitude >= -180 && point.longitude <= 180;
}
function validBudget(budget) {
    if (!budget)
        return true;
    const min = budget.min;
    const max = budget.max;
    if (min !== undefined && (!finite(min) || min < 0))
        return false;
    if (max !== undefined && (!finite(max) || max < 0))
        return false;
    return min === undefined || max === undefined || min <= max;
}
function validate(request) {
    if (!request || typeof request !== 'object')
        throw new RecommendationRequestError();
    const hasPreference = Boolean(text(request.category) || text(request.keywords) || request.random);
    if (!hasPreference || !validPoint(request.center)
        || !finite(request.radiusMeters) || request.radiusMeters <= 0 || request.radiusMeters > 50_000
        || !['walking', 'bicycling', 'driving'].includes(request.travelMode)
        || request.maxMinutes !== undefined && (!finite(request.maxMinutes) || request.maxMinutes <= 0)
        || !validBudget(request.budget)) {
        throw new RecommendationRequestError();
    }
}
function searchable(place) {
    return [place.name, ...(place.categories ?? []), ...(place.tags ?? [])]
        .map(normalized)
        .filter(Boolean);
}
function matchesPreference(place, request) {
    if (request.random)
        return true;
    const values = searchable(place);
    const joined = values.join(' ');
    const category = normalized(text(request.category));
    const keywords = text(request.keywords).split(/[\s,，、/]+/).map(normalized).filter(Boolean);
    const categoryMatch = category
        ? (0, restaurant_categories_1.restaurantCategoryAliases)(request.category).some(alias => joined.includes(normalized(alias)))
        : false;
    const keywordsMatch = keywords.length ? keywords.every(keyword => joined.includes(keyword)) : false;
    return categoryMatch || keywordsMatch;
}
function matchesBudget(place, budget) {
    if (!budget || budget.min === undefined && budget.max === undefined)
        return true;
    if (!finite(place.averageCost) || place.averageCost < 0)
        return false;
    return (budget.min === undefined || place.averageCost >= budget.min)
        && (budget.max === undefined || place.averageCost <= budget.max);
}
/** 高德 POI 分类：050000 餐饮服务大类。 */
const RESTAURANT_TYPECODE = '050000';
function searchFilter(request) {
    // 不限/随便吃：keywords 是对门店名的模糊匹配而非分类过滤，会混入非餐厅 POI；
    // 改用分类码检索周边全部餐饮门店。
    if (request.random)
        return { keywords: '', types: RESTAURANT_TYPECODE };
    if (text(request.keywords))
        return { keywords: text(request.keywords) };
    const category = (0, restaurant_categories_1.findRestaurantCategory)(request.category);
    return {
        keywords: category?.searchKeyword ?? text(request.category),
        ...(category?.typecode ? { types: category.typecode } : {}),
    };
}
function withRouteTimes(candidates, times, maxMinutes) {
    return candidates.flatMap((candidate, index) => {
        const travelMinutes = times[index];
        if (travelMinutes !== undefined && maxMinutes !== undefined && travelMinutes > maxMinutes)
            return [];
        return [{
                ...candidate,
                ...(travelMinutes === undefined ? {} : { travelMinutes }),
            }];
    });
}
/** 展示用的分模式时间：单个模式整体失败只丢该模式的展示，不影响结果本身。 */
async function collectDisplayTimes(routeClient, center, destinations, modes) {
    const entries = await Promise.all(modes.map(async (mode) => {
        try {
            return [mode, await routeClient.times(center, destinations, mode)];
        }
        catch {
            return undefined;
        }
    }));
    const times = {};
    for (const entry of entries) {
        if (entry)
            times[entry[0]] = entry[1];
    }
    return times;
}
function createRecommendHandler(deps) {
    return async (request) => {
        validate(request);
        const searchResult = await deps.searchClient.search({
            ...searchFilter(request),
            center: request.center,
            city: '',
            radiusMeters: request.radiusMeters,
        });
        const candidates = searchResult.items
            .map(place => ({ place, distanceMeters: (0, geo_1.distanceMeters)(request.center, place.location) }))
            .filter(candidate => candidate.distanceMeters <= request.radiusMeters
            && matchesPreference(candidate.place, request)
            && matchesBudget(candidate.place, request.budget));
        const preRanked = (0, recommendation_1.rankRecommendations)(candidates, request).slice(0, 20);
        const routeCandidates = preRanked.map(item => ({
            place: item.place,
            distanceMeters: item.distanceMeters,
        }));
        let routed = routeCandidates;
        let selectedTimes;
        if (routeCandidates.length > 0) {
            try {
                selectedTimes = await deps.routeClient.times(request.center, routeCandidates.map(candidate => candidate.place.location), request.travelMode);
                routed = withRouteTimes(routeCandidates, selectedTimes, request.maxMinutes);
            }
            catch {
                // 路线服务整体不可用：按距离回落，不再为展示补算（避免对故障中的服务加倍请求）。
                routed = routeCandidates;
            }
        }
        const top = (0, recommendation_1.rankRecommendations)(routed, request).slice(0, 10);
        // 步行/驾车展示时间：选定方式已算过的直接复用，其余只为最终 10 家补算，控制路线 API 调用量。
        const selectedIsChipMode = selectedTimes !== undefined
            && (request.travelMode === 'walking' || request.travelMode === 'driving');
        const displayTimes = top.map(item => selectedIsChipMode && item.travelMinutes !== undefined
            ? request.travelMode === 'walking'
                ? { walkingMinutes: item.travelMinutes }
                : { drivingMinutes: item.travelMinutes }
            : {});
        const missingModes = selectedTimes === undefined ? []
            : ['walking', 'driving'].filter(mode => !(selectedIsChipMode && request.travelMode === mode));
        if (missingModes.length > 0 && top.length > 0) {
            const times = await collectDisplayTimes(deps.routeClient, request.center, top.map(item => item.place.location), missingModes);
            top.forEach((_item, index) => {
                const walkingMinutes = times.walking?.[index];
                const drivingMinutes = times.driving?.[index];
                if (walkingMinutes !== undefined)
                    displayTimes[index] = { ...displayTimes[index], walkingMinutes };
                if (drivingMinutes !== undefined)
                    displayTimes[index] = { ...displayTimes[index], drivingMinutes };
            });
        }
        const items = top.map((item, index) => ({
            ...item,
            travelTimeUnavailable: item.travelMinutes === undefined,
            ...displayTimes[index],
        }));
        return {
            items,
            stale: searchResult.stale,
            sourceUpdatedAt: searchResult.sourceUpdatedAt,
        };
    };
}
function createLazyRouteTimesClient(createClient) {
    return {
        times(origin, destinations, mode) {
            return Promise.resolve().then(() => createClient()).then(client => client.times(origin, destinations, mode));
        },
    };
}
function main(event, _context, injected) {
    const sdk = (0, cloudbase_sdk_1.selectCloudBaseSdk)(injected);
    validate(event);
    const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
    const database = app.database();
    const searchService = (0, cache_1.createPlaceSearchService)({
        client: (0, amap_client_1.createAmapClient)(),
        cache: (0, cache_1.createCloudBaseSearchCache)(database),
        places: (0, public_places_1.createCloudBasePublicPlaceStore)(database),
    });
    return createRecommendHandler({
        searchClient: { search: query => searchService.searchPlaces(query) },
        routeClient: createLazyRouteTimesClient(() => (0, amap_routes_1.createAmapRoutesClient)({
            limiter: (0, rate_limiter_1.createCloudBaseRouteRateLimiter)(database),
        })),
    })(event);
}
