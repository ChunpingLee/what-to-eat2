interface MiniProgramApp {
  globalData: { cloudEnvironment: string }
  onLaunch(this: MiniProgramApp): void
}

App<MiniProgramApp>({
  globalData: {
    // Replace with a specific CloudBase environment ID for an explicit deployment target.
    cloudEnvironment: wx.cloud.DYNAMIC_CURRENT_ENV,
  },
  onLaunch(this: MiniProgramApp) {
    wx.cloud.init({ env: this.globalData.cloudEnvironment })
  },
})
