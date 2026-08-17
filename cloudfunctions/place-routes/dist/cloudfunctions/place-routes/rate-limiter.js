"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRouteQps = parseRouteQps;
exports.routeRateLimitScope = routeRateLimitScope;
exports.createRouteRateLimiter = createRouteRateLimiter;
exports.createCloudBaseRoutePermitStore = createCloudBaseRoutePermitStore;
exports.createCloudBaseRouteRateLimiter = createCloudBaseRouteRateLimiter;
const node_crypto_1 = require("node:crypto");
const amap_routes_1 = require("./amap-routes");
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const unavailable = () => new amap_routes_1.AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算');
function beforeDeadline(operation, remainingMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(unavailable()), remainingMs);
        operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
}
function parseRouteQps(value) {
    if (value === undefined || !/^\d+$/.test(value.trim()))
        return 3;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 3;
}
function routeRateLimitScope(key, service) {
    return (0, node_crypto_1.createHash)('sha256').update(`${service}:${key}`).digest('hex');
}
function createRouteRateLimiter({ store, qps, now = Date.now, sleep = wait, }) {
    if (!Number.isSafeInteger(qps) || qps <= 0)
        throw new RangeError('qps must be a positive integer');
    return {
        async acquire({ key, service, deadlineMs }) {
            const scope = routeRateLimitScope(key, service);
            // Integer spacing is deliberately rounded up so timer millisecond rounding
            // cannot create more than qps starts in any half-open 1-second interval.
            const spacingMs = Math.ceil(1_000 / qps);
            for (;;) {
                const currentTime = now();
                if (currentTime >= deadlineMs)
                    throw unavailable();
                const scheduledAtMs = await beforeDeadline(store.schedule(scope, currentTime, spacingMs, deadlineMs), deadlineMs - currentTime);
                if (scheduledAtMs === undefined)
                    throw unavailable();
                const afterReservation = now();
                if (afterReservation >= deadlineMs)
                    throw unavailable();
                // A transaction can return after its slot. Treat that reservation as
                // consumed and reserve again; immediate release would bunch route starts.
                if (scheduledAtMs <= afterReservation)
                    continue;
                await beforeDeadline(sleep(scheduledAtMs - afterReservation), deadlineMs - afterReservation);
                if (now() >= deadlineMs)
                    throw unavailable();
                return;
            }
        },
    };
}
function firstEntry(data) {
    return Array.isArray(data) ? data[0] : data;
}
function createCloudBaseRoutePermitStore(database, now = Date.now) {
    const schedule = (scope, earliestMs, spacingMs, deadlineMs) => database.runTransaction(async (transaction) => {
        if (now() >= deadlineMs)
            return undefined;
        const document = transaction.collection('amap_route_rate_limits').doc(scope);
        const current = firstEntry((await document.get()).data);
        const transactionTime = now();
        if (transactionTime >= deadlineMs)
            return undefined;
        const storedNext = typeof current?.nextAvailableAtMs === 'number' && Number.isFinite(current.nextAvailableAtMs)
            ? current.nextAvailableAtMs
            : earliestMs;
        const scheduledAtMs = Math.max(earliestMs, transactionTime, storedNext);
        if (scheduledAtMs >= deadlineMs)
            return undefined;
        await document.set({
            nextAvailableAtMs: scheduledAtMs + spacingMs,
            updatedAt: new Date(scheduledAtMs).toISOString(),
        });
        return scheduledAtMs;
    });
    return {
        schedule,
        scheduleFor(key, service, earliestMs, spacingMs, deadlineMs) {
            return schedule(routeRateLimitScope(key, service), earliestMs, spacingMs, deadlineMs);
        },
    };
}
function createCloudBaseRouteRateLimiter(database, qps = parseRouteQps(process.env.AMAP_ROUTE_QPS)) {
    return createRouteRateLimiter({ store: createCloudBaseRoutePermitStore(database), qps });
}
