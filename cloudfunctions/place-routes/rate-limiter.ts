import { createHash } from 'node:crypto'
import type { TravelMode } from '../../src/shared/types'
import { AmapRoutesError } from './amap-routes'

export interface RouteRateLimiter {
  acquire(input: { key: string; service: TravelMode; deadlineMs: number }): Promise<void>
}

export interface RoutePermitStore {
  schedule(scope: string, earliestMs: number, spacingMs: number, deadlineMs: number): Promise<number | undefined>
}

type Sleep = (milliseconds: number) => Promise<void>

const wait: Sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const unavailable = () => new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算')
const MAX_WAKE_LATENESS_MS = 5

function beforeDeadline<T>(operation: Promise<T>, remainingMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(unavailable()), remainingMs)
    operation.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

export function parseRouteQps(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return 3
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 3
}

export function routeRateLimitScope(key: string, service: TravelMode): string {
  return createHash('sha256').update(`${service}:${key}`).digest('hex')
}

export function createRouteRateLimiter({
  store,
  qps,
  now = Date.now,
  sleep = wait,
}: {
  store: RoutePermitStore
  qps: number
  now?: () => number
  sleep?: Sleep
}): RouteRateLimiter {
  if (!Number.isSafeInteger(qps) || qps <= 0) throw new RangeError('qps must be a positive integer')
  const sleepUntil = async (scheduledAtMs: number, deadlineMs: number): Promise<number> => {
    for (;;) {
      const currentTime = now()
      if (currentTime >= scheduledAtMs) return currentTime
      if (currentTime >= deadlineMs) throw unavailable()
      await beforeDeadline(sleep(scheduledAtMs - currentTime), deadlineMs - currentTime)
    }
  }
  return {
    async acquire({ key, service, deadlineMs }) {
      const scope = routeRateLimitScope(key, service)
      // qps slots span at least 1000ms plus the accepted wake-up jitter. Thus,
      // even when an earlier slot wakes 5ms late and a later one is exact,
      // any half-open 1-second interval still contains at most qps starts.
      const spacingMs = Math.ceil((1_000 + MAX_WAKE_LATENESS_MS) / qps)
      for (;;) {
        const currentTime = now()
        if (currentTime >= deadlineMs) throw unavailable()
        const scheduledAtMs = await beforeDeadline(
          store.schedule(scope, currentTime, spacingMs, deadlineMs),
          deadlineMs - currentTime,
        )
        if (scheduledAtMs === undefined) throw unavailable()

        const afterReservation = now()
        if (afterReservation >= deadlineMs) throw unavailable()
        // A transaction can return after its slot. Treat that reservation as
        // consumed and reserve again; immediate release would bunch route starts.
        if (scheduledAtMs <= afterReservation) continue
        const wakeTime = await sleepUntil(scheduledAtMs, deadlineMs)
        if (wakeTime >= deadlineMs) throw unavailable()
        if (wakeTime - scheduledAtMs > MAX_WAKE_LATENESS_MS) continue
        return
      }
    },
  }
}

interface RateLimitEntry { nextAvailableAtMs: number; updatedAt: string }
interface TransactionDocument {
  get(): Promise<{ data: RateLimitEntry[] | RateLimitEntry | undefined }>
  set(documentBody: RateLimitEntry): Promise<unknown>
}
interface RateLimitTransaction {
  collection(name: 'amap_route_rate_limits'): { doc(id: string): TransactionDocument }
}
export interface CloudBaseRouteRateLimitDatabase {
  runTransaction<T>(callback: (transaction: RateLimitTransaction) => Promise<T>): Promise<T>
}

function firstEntry(data: RateLimitEntry[] | RateLimitEntry | undefined): RateLimitEntry | undefined {
  return Array.isArray(data) ? data[0] : data
}

export function createCloudBaseRoutePermitStore(
  database: CloudBaseRouteRateLimitDatabase,
  now: () => number = Date.now,
) {
  const schedule = (scope: string, earliestMs: number, spacingMs: number, deadlineMs: number) => database.runTransaction(async transaction => {
    if (now() >= deadlineMs) return undefined
    const document = transaction.collection('amap_route_rate_limits').doc(scope)
    const current = firstEntry((await document.get()).data)
    const transactionTime = now()
    if (transactionTime >= deadlineMs) return undefined
    const storedNext = typeof current?.nextAvailableAtMs === 'number' && Number.isFinite(current.nextAvailableAtMs)
      ? current.nextAvailableAtMs
      : earliestMs
    const scheduledAtMs = Math.max(earliestMs, transactionTime, storedNext)
    if (scheduledAtMs >= deadlineMs) return undefined
    await document.set({
      nextAvailableAtMs: scheduledAtMs + spacingMs,
      updatedAt: new Date(scheduledAtMs).toISOString(),
    })
    return scheduledAtMs
  })
  return {
    schedule,
    scheduleFor(key: string, service: TravelMode, earliestMs: number, spacingMs: number, deadlineMs: number) {
      return schedule(routeRateLimitScope(key, service), earliestMs, spacingMs, deadlineMs)
    },
  }
}

export function createCloudBaseRouteRateLimiter(
  database: CloudBaseRouteRateLimitDatabase,
  qps = parseRouteQps(process.env.AMAP_ROUTE_QPS),
): RouteRateLimiter {
  return createRouteRateLimiter({ store: createCloudBaseRoutePermitStore(database), qps })
}
