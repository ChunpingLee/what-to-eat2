interface WxLocation {
  latitude: number
  longitude: number
}

interface WxChooseLocation extends WxLocation {
  name: string
  address: string
}

interface WxCloudCallResult<T> {
  result: T
}

declare const wx: {
  getLocation(options: {
    type: 'gcj02'
    success(result: WxLocation): void
    fail(error: unknown): void
  }): void
  chooseLocation(options: {
    success(result: WxChooseLocation): void
    fail(error: unknown): void
  }): void
  showToast(options: { title: string; icon: 'none' }): void
  cloud: {
    callFunction<T>(options: { name: string; data: unknown }): Promise<WxCloudCallResult<T>>
  }
}

declare function App(options: Record<string, unknown>): void
declare function Page<T>(options: Omit<T, 'setData'>): void
