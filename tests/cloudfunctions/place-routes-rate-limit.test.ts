import { describe, expect, it, vi } from 'vitest'
import {
  AmapRoutesError,
  createAmapRoutesClient,
} from '../../cloudfunctions/place-routes/amap-routes'
import {
  createCloudBaseRoutePermitStore,
  createRouteRateLimiter,
  parseRouteQps,
  type RoutePermitStore,
} from '../../cloudfunctions/place-routes/rate-limiter'

const center = { latitude: 31.23, longitude: 121.47 }

function memoryStore(): RoutePermitStore {
  const nextAvailableAt = new Map<string, number>()
  return {
    async schedule(scope, earliestMs, spacingMs, deadlineMs) {
      const scheduledAt = Math.max(earliestMs, nextAvailableAt.get(scope) ?? earliestMs)
      if (scheduledAt >= deadlineMs) return undefined
      nextAvailableAt.set(scope, scheduledAt + spacingMs)
      return scheduledAt
    },
  }
}

interface PersistedPermit {
  nextAvailableAtMs: number
  updatedAt: string
}

function statefulCloudBaseDatabase(transactionDelayMs = 0) {
  const documents = new Map<string, PersistedPermit>()
  const reads: Array<PersistedPermit | undefined> = []
  let transactionQueue: Promise<unknown> = Promise.resolve()
  const database = {
    runTransaction<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> {
      const execute = async () => {
        if (transactionDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, transactionDelayMs))
        }
        const transaction = {
          collection: () => ({
            doc: (id: string) => ({
              get: async () => {
                const persisted = documents.get(id)
                reads.push(persisted ? { ...persisted } : undefined)
                return { data: persisted ? { ...persisted } : [] }
              },
              set: async (body: PersistedPermit) => {
                if ('data' in body) throw new Error('CloudBase document body must not be wrapped in data')
                documents.set(id, { ...body })
              },
            }),
          }),
        }
        return callback(transaction)
      }
      const result = transactionQueue.then(execute, execute)
      transactionQueue = result.then(() => undefined, () => undefined)
      return result
    },
  }
  return { database, documents, reads }
}

describe('route rate limiter', () => {
  it('rebooks four expired slots that all wake at 1200ms instead of starting together', async () => {
    let currentTime = 0
    const flushMicrotasks = async () => {
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    }
    const slots = [100, 434, 768, 1_102, 1_300, 1_635, 1_970, 2_305]
    let sleepers: Array<{ wakeAt: number; resolve: () => void }> = []
    const limiter = createRouteRateLimiter({
      store: { schedule: vi.fn().mockImplementation(async () => slots.shift()) },
      qps: 3,
      now: () => currentTime,
      sleep: milliseconds => new Promise(resolve => {
        sleepers.push({ wakeAt: currentTime + milliseconds, resolve })
      }),
    })
    const starts: number[] = []
    const pending = Array.from({ length: 4 }, () => limiter
      .acquire({ key: 'secret', service: 'walking', deadlineMs: 3_000 })
      .then(() => { starts.push(currentTime) }))
    await flushMicrotasks()
    expect(sleepers).toHaveLength(4)

    currentTime = 1_200
    const firstWake = sleepers
    sleepers = []
    firstWake.forEach(sleeper => sleeper.resolve())
    await flushMicrotasks()
    expect(starts).toEqual([])
    expect(sleepers.map(sleeper => sleeper.wakeAt)).toEqual([1_300, 1_635, 1_970, 2_305])

    for (const time of [1_300, 1_635, 1_970, 2_305]) {
      currentTime = time
      const due = sleepers.filter(sleeper => sleeper.wakeAt <= time)
      sleepers = sleepers.filter(sleeper => sleeper.wakeAt > time)
      due.forEach(sleeper => sleeper.resolve())
      await flushMicrotasks()
    }
    await Promise.all(pending)

    expect(starts).toEqual([1_300, 1_635, 1_970, 2_305])
    expect(starts[3] - starts[0]).toBeGreaterThanOrEqual(1_000)
  })

  it.each([1, 2, 3, 4, 5])('accepts normal timer wake-up latency of %dms', async latenessMs => {
    let currentTime = 0
    const schedule = vi.fn().mockResolvedValue(100)
    const limiter = createRouteRateLimiter({
      store: { schedule },
      qps: 3,
      now: () => currentTime,
      sleep: async milliseconds => { currentTime += milliseconds + latenessMs },
    })

    await expect(limiter.acquire({ key: 'secret', service: 'walking', deadlineMs: 1_000 })).resolves.toBeUndefined()
    expect(schedule).toHaveBeenCalledOnce()
  })

  it('limits twenty route calls to the configured QPS and preserves destination result positions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(900)
    try {
      const qps = 3
      const callTimes: number[] = []
      const http = vi.fn().mockImplementation(async query => {
        callTimes.push(Date.now())
        const latitude = Number(query.destination.split(',')[1])
        const index = Math.round((latitude - center.latitude) / 0.0001)
        return { status: '1', route: { paths: [{ cost: { duration: String(index * 60) } }] } }
      })
      const client = createAmapRoutesClient({
        key: 'server-only', http, requestTimeoutMs: 8_000,
        limiter: createRouteRateLimiter({ store: memoryStore(), qps }),
      })
      const destinations = Array.from({ length: 20 }, (_, index) => ({
        latitude: center.latitude + (index + 1) * 0.0001,
        longitude: center.longitude,
      }))

      const pending = client.times(center, destinations, 'walking')
      const assertion = expect(pending).resolves.toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
      await vi.advanceTimersByTimeAsync(7_000)

      await assertion
      const sortedTimes = [...callTimes].sort((left, right) => left - right)
      for (let index = qps; index < sortedTimes.length; index += 1) {
        expect(sortedTimes[index] - sortedTimes[index - qps]).toBeGreaterThanOrEqual(1_000)
      }
      expect(http).toHaveBeenCalledTimes(20)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops waiting at the request deadline so the missed route degrades to unavailable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const client = createAmapRoutesClient({
        key: 'server-only', requestTimeoutMs: 500,
        limiter: createRouteRateLimiter({ store: memoryStore(), qps: 1 }),
        http: vi.fn().mockResolvedValue({ status: '1', route: { paths: [{ cost: { duration: '60' } }] } }),
      })
      const pending = client.times(center, [center, { ...center, latitude: center.latitude + 0.001 }], 'walking')
      const assertion = expect(pending).rejects.toEqual(
        new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算'),
      )
      await vi.advanceTimersByTimeAsync(500)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a positive integer cloud setting and defaults to three QPS', () => {
    expect(parseRouteQps(undefined)).toBe(3)
    expect(parseRouteQps('5')).toBe(5)
    expect(parseRouteQps('0')).toBe(3)
    expect(parseRouteQps('2.5')).toBe(3)
    expect(parseRouteQps('not-a-number')).toBe(3)
  })

  it('persists root document fields and advances them across consecutive acquires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const shared = statefulCloudBaseDatabase()
      const firstLimiter = createRouteRateLimiter({
        store: createCloudBaseRoutePermitStore(shared.database as never), qps: 3,
      })
      const secondLimiter = createRouteRateLimiter({
        store: createCloudBaseRoutePermitStore(shared.database as never), qps: 3,
      })

      const first = firstLimiter.acquire({ key: 'server-only-secret', service: 'walking', deadlineMs: 2_000 })
      await vi.advanceTimersByTimeAsync(335)
      await first
      const second = secondLimiter.acquire({ key: 'server-only-secret', service: 'walking', deadlineMs: 2_000 })
      await vi.advanceTimersByTimeAsync(335)
      await second

      const [documentId, persisted] = [...shared.documents.entries()][0]
      expect(documentId).not.toContain('server-only-secret')
      expect(documentId).toMatch(/^[a-f0-9]{64}$/)
      expect(persisted).toEqual({
        nextAvailableAtMs: 1_005,
        updatedAt: new Date(670).toISOString(),
      })
      expect(shared.reads).toEqual([
        undefined,
        { nextAvailableAtMs: 335, updatedAt: new Date(0).toISOString() },
        { nextAvailableAtMs: 670, updatedAt: new Date(335).toISOString() },
      ])
      expect('data' in persisted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces a fixed safe error when a permit cannot be obtained before the deadline', async () => {
    const limiter = createRouteRateLimiter({
      store: { schedule: vi.fn().mockResolvedValue(undefined) },
      qps: 3,
      now: () => 900,
    })

    await expect(limiter.acquire({ key: 'secret', service: 'walking', deadlineMs: 999 }))
      .rejects.toEqual(new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算'))
  })

  it('times out even when the shared permit transaction never resolves', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const limiter = createRouteRateLimiter({
        store: { schedule: vi.fn().mockReturnValue(new Promise<number | undefined>(() => undefined)) },
        qps: 3,
      })

      const pending = limiter.acquire({ key: 'secret', service: 'walking', deadlineMs: 100 })
      const assertion = expect(pending).rejects.toEqual(
        new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算'),
      )
      await vi.advanceTimersByTimeAsync(100)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not write a permit when a shared transaction resumes after the deadline', async () => {
    let currentTime = 0
    let finishRead: ((value: { data: [] }) => void) | undefined
    const set = vi.fn().mockResolvedValue(undefined)
    const doc = {
      get: vi.fn().mockReturnValue(new Promise<{ data: [] }>(resolve => { finishRead = resolve })),
      set,
    }
    const transaction = { collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue(doc) }) }
    const database = { runTransaction: vi.fn(async callback => callback(transaction)) }
    const store = createCloudBaseRoutePermitStore(database as never, () => currentTime)

    const pending = store.schedule('scope', 0, 1_000 / 3, 100)
    currentTime = 101
    finishRead?.({ data: [] })

    await expect(pending).resolves.toBeUndefined()
    expect(set).not.toHaveBeenCalled()
  })

  it('keeps the shared next-permit timestamp monotonic', async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    const doc = {
      get: vi.fn().mockResolvedValue({ data: { nextAvailableAtMs: 2_000, updatedAt: 'earlier' } }),
      set,
    }
    const transaction = { collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue(doc) }) }
    const database = { runTransaction: vi.fn(async callback => callback(transaction)) }
    const store = createCloudBaseRoutePermitStore(database as never, () => 1_100)

    await expect(store.schedule('scope', 1_000, 250, 5_000)).resolves.toBe(2_000)
    expect(set).toHaveBeenCalledWith({
      nextAvailableAtMs: 2_250,
      updatedAt: new Date(2_000).toISOString(),
    })
  })

  it('limits shared multi-instance route starts when every transaction takes 100ms', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const qps = 3
      const shared = statefulCloudBaseDatabase(100)
      const callTimes: number[] = []
      const http = vi.fn().mockImplementation(async query => {
        callTimes.push(Date.now())
        const latitude = Number(query.destination.split(',')[1])
        const index = Math.round((latitude - center.latitude) / 0.0001)
        return { status: '1', route: { paths: [{ cost: { duration: String(index * 60) } }] } }
      })
      const createClient = () => createAmapRoutesClient({
        key: 'server-only', http, requestTimeoutMs: 9_000,
        limiter: createRouteRateLimiter({
          store: createCloudBaseRoutePermitStore(shared.database as never), qps,
        }),
      })
      const destinations = Array.from({ length: 20 }, (_, index) => ({
        latitude: center.latitude + (index + 1) * 0.0001,
        longitude: center.longitude,
      }))

      const first = createClient().times(center, destinations.slice(0, 10), 'walking')
      const second = createClient().times(center, destinations.slice(10), 'walking')
      const assertion = Promise.all([
        expect(first).resolves.toHaveLength(10),
        expect(second).resolves.toHaveLength(10),
      ])
      await vi.advanceTimersByTimeAsync(9_000)
      await assertion

      const sortedTimes = [...callTimes].sort((left, right) => left - right)
      for (let index = qps; index < sortedTimes.length; index += 1) {
        expect(sortedTimes[index] - sortedTimes[index - qps]).toBeGreaterThanOrEqual(1_000)
      }
      expect(http).toHaveBeenCalledTimes(20)
    } finally {
      vi.useRealTimers()
    }
  })

  it('degrades without starting routes when transaction delay exceeds the permit spacing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const shared = statefulCloudBaseDatabase(400)
      const http = vi.fn().mockResolvedValue({ status: '1', route: { paths: [{ cost: { duration: '60' } }] } })
      const client = createAmapRoutesClient({
        key: 'server-only', http, requestTimeoutMs: 1_000,
        limiter: createRouteRateLimiter({
          store: createCloudBaseRoutePermitStore(shared.database as never), qps: 3,
        }),
      })

      const pending = client.times(center, [center], 'walking')
      const assertion = expect(pending).rejects.toEqual(
        new AmapRoutesError('AMAP_ROUTES_UNAVAILABLE', '路线时间暂时无法计算'),
      )
      await vi.advanceTimersByTimeAsync(1_000)

      await assertion
      expect(http).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
