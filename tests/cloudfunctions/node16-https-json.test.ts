import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createHttpsJsonFetch, type HttpsRequester } from '../../cloudfunctions/shared/https-json'

describe('Node 16 HTTPS JSON transport', () => {
  it('parses a successful JSON response without relying on global fetch', async () => {
    const requester: HttpsRequester = vi.fn((_url, options, onResponse) => {
      const request = new EventEmitter() as EventEmitter & { end(): void }
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode?: number }
        response.statusCode = 200
        onResponse(response)
        response.emit('data', Buffer.from('{"status":"1","pois":[]}'))
        response.emit('end')
      }
      return request
    })
    const signal = new AbortController().signal

    const response = await createHttpsJsonFetch(requester)('https://restapi.amap.com/test', { signal })

    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toEqual({ status: '1', pois: [] })
    expect(requester).toHaveBeenCalledWith(
      'https://restapi.amap.com/test',
      { method: 'GET', signal },
      expect.any(Function),
    )
  })
})
