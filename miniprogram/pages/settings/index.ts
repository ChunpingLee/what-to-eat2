import { deleteAccount } from '../../services/cloud'

export function createDeleteAccountAction(deps: {
  confirm(): Promise<boolean>
  deleteAccount(): Promise<unknown>
  relaunch(url: string): void
}) {
  return async () => {
    if (!await deps.confirm()) return { deleted: false }
    await deps.deleteAccount()
    deps.relaunch('/pages/home/index')
    return { deleted: true }
  }
}

interface SettingsData { deleting: boolean; errorMessage: string }
interface SettingsPage {
  data: SettingsData
  setData(data: Partial<SettingsData>): void
  onDeleteAccount(): Promise<void>
}

const deleteAccountAction = createDeleteAccountAction({
  async confirm() {
    const result = await wx.showModal({
      title: '确认注销账号？',
      content: '注销后将永久删除你的收藏、导入记录和推荐反馈，且无法恢复。',
      confirmText: '确认删除',
      confirmColor: '#b91c1c',
    })
    return result.confirm
  },
  deleteAccount,
  relaunch(url) { wx.reLaunch({ url }) },
})

if (typeof Page === 'function') {
  Page<SettingsPage>({
    data: { deleting: false, errorMessage: '' },

    async onDeleteAccount(this: SettingsPage) {
      if (this.data.deleting) return
      this.setData({ deleting: true, errorMessage: '' })
      try {
        await deleteAccountAction()
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : '注销失败，请重试'
        this.setData({ errorMessage: message })
      } finally {
        this.setData({ deleting: false })
      }
    },
  })
}
