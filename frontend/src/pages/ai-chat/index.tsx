import { View } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import AIChatPanel from '@/components/AIChatPanel'
import { useAiChatStore } from '@/store/ai-chat'
import { useUserStore } from '@/store/user'

/**
 * AI 助手全屏页面
 * - 薄壳：仅渲染 <AIChatPanel mode="page" />，所有数据来自 store
 * - 与全局浮窗共享同一 store（互斥显示）
 * - 进入页面时校验登录态；未登录 reLaunch 到 login
 *
 * F-1 修复：useDidHide 在页面真正隐藏时触发，避免 useEffect cleanup
 *         在 navigateBack 时强制 closePanel() 污染浮窗状态。
 *         保留 useUnload 兜底处理 navigateBack 完全卸载场景。
 */
export default function AiChatPage() {
  const openPagePanel = useAiChatStore((s) => s.openPagePanel)
  const closePanel = useAiChatStore((s) => s.closePanel)
  const token = useUserStore((s) => s.token)

  useDidShow(() => {
    if (!token) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    // 进入页面：打开 page 模式（互斥关闭 floating）
    openPagePanel()
  })

  // 页面隐藏时关闭 page 面板（F-1：useDidHide 比 useEffect cleanup 更早触发，
  // 并且不会在 React 树 unmount 时才触发，减少浮窗状态污染）
  useDidHide(() => {
    closePanel()
  })

  return (
    <View style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AIChatPanel mode='page' />
    </View>
  )
}
