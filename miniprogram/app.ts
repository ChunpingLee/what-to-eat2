interface MiniProgramApp {
  globalData: { cloudEnvironment: string }
  onLaunch(this: MiniProgramApp): void
}

App<MiniProgramApp>({
  globalData: {
    cloudEnvironment: 'cloud1-d9gwjmdaj73a7dc0d',
  },
  onLaunch(this: MiniProgramApp) {
    wx.cloud.init({ env: this.globalData.cloudEnvironment })
  },
})
