import { useEffect, PropsWithChildren } from 'react'
import { useUserStore } from './store/user'
import { rehydrateAiChatStore } from './store/ai-chat'

import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  const loadFromStorage = useUserStore((s) => s.loadFromStorage)
  // 启动时从本地存储恢复登录态 + AI 会话
  useEffect(() => {
    loadFromStorage()
    // P2-7: 在 App 启动时显式 rehydrate AI 会话存储
    rehydrateAiChatStore()
  }, [loadFromStorage])

  // children 是将要会渲染的页面
  return children
}

export default App
