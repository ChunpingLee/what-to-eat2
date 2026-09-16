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
const amap_distance_1 = require("../place-routes/amap-distance");
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
/** 每次推荐最多翻 10 页（约 100 家候选），保护搜索/路线 API 配额。 */
const MAX_REQUEST_PAGE = 10;
function validPage(page) {
    return page === undefined || (Number.isInteger(page) && page >= 1 && page <= MAX_REQUEST_PAGE);
}
function validate(request) {
    if (!request || typeof request !== 'object')
        throw new RecommendationRequestError();
    const hasPreference = Boolean(text(request.category) || text(request.keywords) || request.random);
    if (!hasPreference || !validPoint(request.center)
        || !finite(request.radiusMeters) || request.radiusMeters <= 0 || request.radiusMeters > 50_000
        || !['walking', 'bicycling', 'driving'].includes(request.travelMode)
        || request.maxMinutes !== undefined && (!finite(request.maxMinutes) || request.maxMinutes <= 0)
        || !validBudget(request.budget)
        || !validPage(request.page)) {
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
/** 与 place-search/amap-client 的 pageSize 一致；满页视为可能还有下一页。 */
const SEARCH_PAGE_SIZE = 25;
/** 每页返回的推荐条数；客户端上滑一次加载一页。 */
const RESULT_PAGE_SIZE = 10;
/** maxMinutes 过滤的候选窗口大小；窗口比返回页多 10 个作为过滤缓冲。 */
const ROUTE_CANDIDATE_WINDOW = 20;
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
/** 并行预取窗口内步行/驾车展示时间：单个模式整体失败只丢该模式的展示，不影响结果本身。 */
async function fetchChipTimes(client, center, destinations, modes) {
    const entries = await Promise.all(modes.map(async (mode) => {
        try {
            return [mode, await client.times(center, destinations, mode)];
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
        // 翻页请求累积读取第 1..N 页（前页通常命中缓存）：按合并后的候选全局排序，
        // 第 N 页取 [(N-1)*10, (N-1)*10+20)，避免跳过前页候选池中的第 11-20 名。
        const pageIndex = request.page ?? 1;
        const searchResults = await Promise.all(Array.from({ length: pageIndex }, (_, index) => deps.searchClient.search({
            ...searchFilter(request),
            center: request.center,
            city: '',
            radiusMeters: request.radiusMeters,
            ...(index > 0 ? { page: index + 1 } : {}),
        })));
        const latest = searchResults[searchResults.length - 1];
        const seenPoiIds = new Set();
        const searched = searchResults.flatMap(result => result.items.filter(place => {
            if (seenPoiIds.has(place.poiId))
                return false;
            seenPoiIds.add(place.poiId);
            return true;
        }));
        const candidates = searched
            .map(place => ({ place, distanceMeters: (0, geo_1.distanceMeters)(request.center, place.location) }))
            .filter(candidate => candidate.distanceMeters <= request.radiusMeters
            && matchesPreference(candidate.place, request)
            && matchesBudget(candidate.place, request.budget));
        const offset = (pageIndex - 1) * RESULT_PAGE_SIZE;
        // 无 maxMinutes 时 travelMinutes 不参与打分与过滤，窗口收敛到返回页大小即可。
        const routeWindowSize = request.maxMinutes === undefined ? RESULT_PAGE_SIZE : ROUTE_CANDIDATE_WINDOW;
        const preRanked = (0, recommendation_1.rankRecommendations)(candidates, request).slice(offset, offset + routeWindowSize);
        const routeCandidates = preRanked.map(item => ({
            place: item.place,
            distanceMeters: item.distanceMeters,
        }));
        const routeLocations = routeCandidates.map(candidate => candidate.place.location);
        // 步行/驾车时间统一走距离测量批量接口：一次调用覆盖整个候选窗口（餐厅为 origins、用户为
        // destination 的方向反转），选定方式的结果直接复用为 chips，另一方式并行预取，共 2 次并行
        // HTTP。仅骑行仍走逐条路径规划（v4 无批量形态，受 AMAP_ROUTE_QPS 限流），与批量预取并行。
        const chipModes = request.travelMode === 'bicycling'
            ? ['walking', 'driving']
            : ['walking', 'driving'].filter(mode => mode !== request.travelMode);
        const selectedCall = routeCandidates.length === 0 ? undefined
            : request.travelMode === 'bicycling'
                ? deps.routeClient.times(request.center, routeLocations, request.travelMode).catch(() => undefined)
                : deps.distanceClient.times(request.center, routeLocations, request.travelMode).catch(() => undefined);
        const chipCall = routeCandidates.length === 0
            ? Promise.resolve({})
            : fetchChipTimes(deps.distanceClient, request.center, routeLocations, chipModes);
        const selectedTimes = await selectedCall;
        const routed = selectedTimes === undefined ? routeCandidates : withRouteTimes(routeCandidates, selectedTimes, request.maxMinutes);
        const top = (0, recommendation_1.rankRecommendations)(routed, request).slice(0, RESULT_PAGE_SIZE);
        const chipTimes = await chipCall;
        const windowIndexByPoiId = new Map(routeCandidates.map((candidate, index) => [candidate.place.poiId, index]));
        const chipMinutes = (item, mode) => {
            if (request.travelMode === mode)
                return item.travelMinutes;
            const index = windowIndexByPoiId.get(item.place.poiId);
            return index === undefined ? undefined : chipTimes[mode]?.[index];
        };
        const items = top.map(item => {
            const walkingMinutes = chipMinutes(item, 'walking');
            const drivingMinutes = chipMinutes(item, 'driving');
            const displayTimes = {
                ...(walkingMinutes === undefined ? {} : { walkingMinutes }),
                ...(drivingMinutes === undefined ? {} : { drivingMinutes }),
            };
            return {
                ...item,
                travelTimeUnavailable: item.travelMinutes === undefined,
                ...displayTimes,
            };
        });
        return {
            items,
            stale: latest.stale,
            sourceUpdatedAt: latest.sourceUpdatedAt,
            hasMore: latest.items.length >= SEARCH_PAGE_SIZE,
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
        // 骑行仍走逐条路径规划（含限流）；步行/驾车由 distanceClient 批量计算。
        routeClient: createLazyRouteTimesClient(() => (0, amap_routes_1.createAmapRoutesClient)({
            limiter: (0, rate_limiter_1.createCloudBaseRouteRateLimiter)(database),
        })),
        distanceClient: (0, amap_distance_1.createAmapDistanceClient)(),
    })(event);
}
