import { describe, expect, it, vi } from 'vitest'
import {
  resolveCloudBaseSdk,
  selectCloudBaseSdk,
  wxContextFromEnv,
} from '../../cloudfunctions/shared/cloudbase-sdk'

describe('shared cloudbase sdk selection', () => {
  it('accepts the node-sdk 3.x module shape and rejects the 4.x default-wrapped shape with a diagnostic error', () => {
    const v3Module = { init: vi.fn(), version: '3.18.5', SYMBOL_CURRENT_ENV: Symbol('current') }
    expect(resolveCloudBaseSdk(v3Module)).toBe(v3Module)

    const v4Module = { default: { init: vi.fn() } }
    expect(() => resolveCloudBaseSdk(v4Module))
      .toThrow('incompatible @cloudbase/node-sdk export (version=unknown, keys=default)')
    expect(() => resolveCloudBaseSdk(undefined)).toThrow('incompatible @cloudbase/node-sdk export')
  })

  it('ignores runtime-injected callback arguments and falls back to requiring the SDK module', () => {
    const injectedSdk = { init: vi.fn() }
    expect(selectCloudBaseSdk(injectedSdk, () => { throw new Error('must not load') })).toBe(injectedSdk)

    const loadedModule = { init: vi.fn(), version: '3.18.5' }
    expect(selectCloudBaseSdk(undefined, () => loadedModule)).toBe(loadedModule)

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rejected = selectCloudBaseSdk(function runtimeCallback() {}, () => loadedModule)
    const loggedCalls = [...errorLog.mock.calls]
    errorLog.mockRestore()

    expect(rejected).toBe(loadedModule)
    expect(loggedCalls[0]?.[0]).toMatchObject({ event: 'SDK_ARG_REJECTED', argType: 'function' })
  })

  it('reads the WeChat caller context with the WX_ prefix stripped and secrets excluded', () => {
    expect(wxContextFromEnv({
      WX_CONTEXT_KEYS: 'WX_OPENID,WX_APPID,WX_UNIONID,WX_API_TOKEN,API_TOKEN,CLIENTIP,UNDECLARED',
      WX_OPENID: 'o-user',
      WX_APPID: 'wx-app',
      WX_UNIONID: 'o-union',
      WX_API_TOKEN: 'secret-token',
      API_TOKEN: 'secret-token',
      CLIENTIP: '1.2.3.4',
    })).toEqual({ OPENID: 'o-user', APPID: 'wx-app', UNIONID: 'o-union', CLIENTIP: '1.2.3.4' })

    expect(wxContextFromEnv({})).toEqual({})
  })
})
