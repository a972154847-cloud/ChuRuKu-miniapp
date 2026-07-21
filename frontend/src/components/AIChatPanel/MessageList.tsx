import { View, Text, ScrollView } from '@tarojs/components'
import { useEffect, useRef } from 'react'
import { resolveFileUrl } from '@/services/upload'
import { useAiChatStore, type AiChatMessage } from '@/store/ai-chat'
import './MessageList.scss'

interface Props {
  messages: AiChatMessage[]
  loading: boolean
  welcomeText?: string
}

export default function MessageList({ messages, loading, welcomeText }: Props) {
  const scrollRef = useRef<any>(null)
  const sessions = useAiChatStore((s) => s.sessions)
  const currentSessionId = useAiChatStore((s) => s.currentSessionId)
  const hasSession = sessions.some((s) => s.id === currentSessionId) || messages.length > 0

  // P2-7: 自动滚动到底部 — 三重保险
  // 1. scrollIntoView='ai-msg-bottom' (Taro ScrollView 自带, 跟随 DOM 渲染)
  // 2. scrollRef.current?.scrollToBottom() (兼容旧基础库手动调用)
  // 3. 双重 setTimeout 避免 React 18 batch 渲染时 scroll 早于 DOM 挂载
  useEffect(() => {
    const t1 = setTimeout(() => {
      try {
        scrollRef.current?.scrollToBottom?.()
      } catch {
        // ignore
      }
    }, 50)
    // 二次兜底：覆盖长消息流式输出的场景
    const t2 = setTimeout(() => {
      try {
        scrollRef.current?.scrollToBottom?.()
      } catch {
        // ignore
      }
    }, 200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [messages.length, loading])

  return (
    <ScrollView
      className='ai-panel__body'
      scrollY
      ref={scrollRef}
      scrollIntoView='ai-msg-bottom'
      enhanced
      showScrollbar={false}
    >
      {!hasSession && welcomeText ? (
        <View className='ai-panel__empty'>
          <Text>{welcomeText}</Text>
        </View>
      ) : null}

      {messages.map((m) => (
        <View
          key={m.id}
          className={`ai-msg ai-msg--${m.role} ${m.error ? 'ai-msg--error' : ''}`}
          id={m.id}
        >
          <View className='ai-msg__bubble'>
            <Text>{m.content}</Text>
            {m.pendingPhotos && m.pendingPhotos.length > 0 && (
              <View className='ai-msg__photos'>
                {m.pendingPhotos.map((p, i) => (
                  <View key={i} className='ai-msg__photo'>
                    {/* 使用内联 backgroundImage 避免微信 Image 组件权限问题 */}
                    <View
                      style={{
                        width: '96rpx',
                        height: '96rpx',
                        backgroundImage: `url(${resolveFileUrl(p)})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        borderRadius: '8rpx',
                      }}
                    />
                  </View>
                ))}
              </View>
            )}
            {m.toolTrace && m.toolTrace.length > 0 && (
              <View className='ai-msg__tools'>
                <Text className='ai-msg__tools-title'>工具调用：</Text>
                {m.toolTrace.map((t, i) => (
                  <View key={i} className='ai-msg__tool'>
                    <Text className='ai-msg__tool-name'>
                      {t.success ? '✓' : '✗'} {t.tool}
                    </Text>
                    <Text className='ai-msg__tool-result'>
                      {typeof t.result === 'string'
                        ? t.result
                        : JSON.stringify(t.result).slice(0, 120)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      ))}

      {loading && (
        <View className='ai-msg ai-msg--assistant'>
          <View className='ai-msg__bubble ai-msg__bubble--loading'>
            <Text>思考中</Text>
          </View>
        </View>
      )}

      <View id='ai-msg-bottom' style={{ height: '1rpx' }} />
    </ScrollView>
  )
}
