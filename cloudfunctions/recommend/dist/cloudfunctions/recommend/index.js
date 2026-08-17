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
function searchKeywords(request) {
    if (request.random)
        return '餐饮服务';
    if (text(request.keywords))
        return text(request.keywords);
    return (0, restaurant_categories_1.findRestaurantCategory)(request.category)?.searchKeyword ?? text(request.category);
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
function createRecommendHandler(deps) {
    return async (request) => {
        validate(request);
        const searchResult = await deps.searchClient.search({
            keywords: searchKeywords(request),
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
        if (routeCandidates.length > 0) {
            try {
                const times = await deps.routeClient.times(request.center, routeCandidates.map(candidate => candidate.place.location), request.travelMode);
                routed = withRouteTimes(routeCandidates, times, request.maxMinutes);
            }
            catch {
                routed = routeCandidates;
            }
        }
        const items = (0, recommendation_1.rankRecommendations)(routed, request).slice(0, 10).map(item => ({
            ...item,
            travelTimeUnavailable: item.travelMinutes === undefined,
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
function main(event, _context, sdk = require('@cloudbase/node-sdk')) {
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
