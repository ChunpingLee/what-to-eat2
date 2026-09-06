const TAB_URLS = ['/pages/home/index', '/pages/recommend/index', '/pages/settings/index']

interface TabBarTapEvent {
  currentTarget: { dataset: Record<string, unknown> }
}

interface TabBarComponent {
  data: { selected: number }
  setData(data: Partial<TabBarComponent['data']>): void
  onTap(event: TabBarTapEvent): void
}

if (typeof Component === 'function') {
  Component<TabBarComponent>({
    data: {
      selected: 0,
    },
    methods: {
      onTap(this: TabBarComponent, event: TabBarTapEvent) {
        const index = Number(event.currentTarget.dataset.index)
        const url = TAB_URLS[index]
        if (!url || index === this.data.selected) return
        wx.switchTab({ url })
      },
    },
  })
}
