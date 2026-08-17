import { request as httpsRequest } from 'node:https'

export interface HttpsResponse {
  statusCode?: number
  on(event: 'data', listener: (chunk: Buffer | string) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (error: Error) => void): this
}

export interface HttpsRequest {
  once(event: 'error', listener: (error: Error) => void): this
  end(): void
}

export type HttpsRequester = (
  url: string,
  options: { method: 'GET'; signal: AbortSignal },
  onResponse: (response: HttpsResponse) => void,
) => HttpsRequest

export type JsonFetch = (
  input: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>

const nativeRequester: HttpsRequester = (url, options, onResponse) =>
  httpsRequest(url, options, onResponse as never)

export function createHttpsJsonFetch(requester: HttpsRequester = nativeRequester): JsonFetch {
  return (input, { signal }) => new Promise((resolve, reject) => {
    const request = requester(input, { method: 'GET', signal }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300,
          async json() { return JSON.parse(body) as unknown },
        })
      })
    })
    request.once('error', reject)
    request.end()
  })
}
