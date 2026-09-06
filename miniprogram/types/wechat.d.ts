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
  showModal(options: {
    title: string
    content: string
    confirmText?: string
    confirmColor?: string
  }): Promise<{ confirm: boolean; cancel: boolean }>
  reLaunch(options: { url: string }): void
  switchTab(options: { url: string }): void
  openLocation(options: {
    latitude: number
    longitude: number
    name?: string
    address?: string
    scale?: number
  }): void
  cloud: {
    DYNAMIC_CURRENT_ENV: string
    init(options: { env: string }): void
    callFunction<T>(options: { name: string; data: unknown }): Promise<WxCloudCallResult<T>>
  }
}

interface MiniProgramShareMessage {
  title: string
  path: string
}

declare function App<T>(options: T): void
declare function Page<T>(options: Omit<T, 'setData'>): void
declare function Component<T>(options: unknown): void
