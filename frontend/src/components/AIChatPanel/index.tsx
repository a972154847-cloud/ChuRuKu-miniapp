import { View, Text, Button, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback, useRef, useMemo } from 'react'
import { aiChat } from '@/services/ai-chat'
import { ApiError } from '@/services/request'
import { useAiChatStore, type AiChatMessage } from '@/store/ai-chat'
import MessageList from './MessageList'
import './index.scss'

export interface AIChatPanelProps {
  /** 'page' = 全屏页面版；'floating' = 弹窗版（覆盖在当前页面之上） */
  mode: 'page' | 'floating'
  /** 自定义欢迎语 */
  welcomeText?: string
}

const QUICK_ACTIONS = [
  '查看所有器材库存',
  '入库 5 个干粉灭火器',
  '出库 2 个二氧化碳灭火器给张三',
  '查询最近的出入库记录',
]

/**
 * AI 助手面板：受控组件，所有数据来自 useAiChatStore
 * - 受 useAiChatStore.openFloatingPanel/openPagePanel 控制显隐
 * - 发送消息：appendMessage → 调 aiChat → appendMessage
 * - 持久化由 zustand persist 接管
 */
export default function AIChatPanel({ mode, welcomeText }: AIChatPanelProps) {
  const panelMode = useAiChatStore((s) => s.panelMode)
  const sessions = useAiChatStore((s) => s.sessions)
  const currentSessionId = useAiChatStore((s) => s.currentSessionId)
  const draftInput = useAiChatStore((s) => s.draftInput)
  const setDraft = useAiChatStore((s) => s.setDraft)
  const loading = useAiChatStore((s) => s.loading)
  const setLoading = useAiChatStore((s) => s.setLoading)
  const appendMessage = useAiChatStore((s) => s.appendMessage)
  const newSession = useAiChatStore((s) => s.newSession)
  const switchSession = useAiChatStore((s) => s.switchSession)
  const deleteSession = useAiChatStore((s) => s.deleteSession)
  const closePanel = useAiChatStore((s) => s.closePanel)

  const sendingRef = useRef(false)

  // 当前会话消息
  const currentMessages = useMemo(() => {
    if (!currentSessionId) return [] as AiChatMessage[]
    const sess = sessions.find((s) => s.id === currentSessionId)
    return sess?.messages || []
  }, [sessions, currentSessionId])

  // 浮窗版：点击遮罩关闭
  const handleMaskClick = (e: any) => {
    if (e?.target === e?.currentTarget) {
      closePanel()
    }
  }

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || sendingRef.current) return
      const storedToken = Taro.getStorageSync('token')
      if (!storedToken) {
        Taro.reLaunch({ url: '/pages/login/index' })
        return
      }

      sendingRef.current = true
      setLoading(true)
      setDraft('')

      const userMsg: AiChatMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      }
      appendMessage(userMsg)

      // 收集历史（最近 10 条 user/assistant 消息）
      const history = currentMessages
        .filter((m) => !m.error && m.id !== 'welcome')
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))

      try {
        const res = await aiChat(trimmed, history)
        const assistantMsg: AiChatMessage = {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          content: res.reply || '(空回复)',
          toolTrace: res.tool_trace,
          createdAt: Date.now(),
        }
        appendMessage(assistantMsg)
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'AI 服务不可用，请检查后端配置'
        appendMessage({
          id: `a-${Date.now()}-err`,
          role: 'assistant',
          content: msg,
          error: true,
          createdAt: Date.now(),
        })
      } finally {
        setLoading(false)
        sendingRef.current = false
      }
    },
    [currentMessages, appendMessage, setDraft, setLoading]
  )

  // 互斥：仅当 panelMode 匹配 mode 时渲染（必须在所有 hooks 之后）
  if (panelMode !== mode) return null

  const onSend = () => send(draftInput)
  const onQuickAction = (text: string) => send(text)
  const onNewSession = () => {
    newSession()
  }
  const onSwitchSession = (id: string) => {
    switchSession(id)
  }
  const onDeleteSession = (id: string) => {
    Taro.showModal({
      title: '删除会话',
      content: '确定删除该会话及其所有消息？',
      success: (r) => {
        if (r.confirm) deleteSession(id)
      },
    })
  }

  const containerClass = `ai-panel ai-panel--${mode}`
  const defaultWelcome =
    welcomeText ||
    '你好！我是 AI 助手，可以帮你：\n• 查询器材库存和分类\n• 入库 / 出库操作\n• 查询出入库记录\n\n试试说"查看所有器材库存"吧～'

  // 浮窗版包一层 mask
  if (mode === 'floating') {
    return (
      <View
        className='ai-panel-mask'
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 9998,
        }}
        onClick={handleMaskClick}
      >
        <View
          className={containerClass}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '10vh',
            bottom: 0,
            background: '#f5f6f8',
            borderTopLeftRadius: '24rpx',
            borderTopRightRadius: '24rpx',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <PanelHeader
            mode={mode}
            sessions={sessions}
            currentSessionId={currentSessionId}
            onNewSession={onNewSession}
            onSwitchSession={onSwitchSession}
            onDeleteSession={onDeleteSession}
            onClose={closePanel}
          />
          <MessageList messages={currentMessages} loading={loading} welcomeText={defaultWelcome} />
          {currentMessages.length === 0 && (
            <View className='ai-panel__quick'>
              {QUICK_ACTIONS.map((q) => (
                <View
                  key={q}
                  className='ai-panel__quick-item'
                  hoverClass='ai-panel__quick-item--hover'
                  onClick={() => onQuickAction(q)}
                >
                  <Text>{q}</Text>
                </View>
              ))}
            </View>
          )}
          <InputBar
            value={draftInput}
            onChange={setDraft}
            onSend={onSend}
            disabled={!draftInput.trim() || loading}
          />
        </View>
      </View>
    )
  }

  // 页面版
  return (
    <View className={containerClass}>
      <PanelHeader
        mode={mode}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onNewSession={onNewSession}
        onSwitchSession={onSwitchSession}
        onDeleteSession={onDeleteSession}
        onClose={undefined}
      />
      <MessageList messages={currentMessages} loading={loading} welcomeText={defaultWelcome} />
      {currentMessages.length === 0 && (
        <View className='ai-panel__quick'>
          {QUICK_ACTIONS.map((q) => (
            <View
              key={q}
              className='ai-panel__quick-item'
              hoverClass='ai-panel__quick-item--hover'
              onClick={() => onQuickAction(q)}
            >
              <Text>{q}</Text>
            </View>
          ))}
        </View>
      )}
      <InputBar
        value={draftInput}
        onChange={setDraft}
        onSend={onSend}
        disabled={!draftInput.trim() || loading}
      />
    </View>
  )
}

interface PanelHeaderProps {
  mode: 'page' | 'floating'
  sessions: ReturnType<typeof useAiChatStore.getState>['sessions']
  currentSessionId: string | null
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onClose?: () => void
}

function PanelHeader({
  mode,
  sessions,
  currentSessionId,
  onNewSession,
  onSwitchSession,
  onDeleteSession,
  onClose,
}: PanelHeaderProps) {
  const [showHistory, setShowHistory] = useState(false)
  const currentTitle =
    sessions.find((s) => s.id === currentSessionId)?.title || 'AI 助手'

  return (
    <View className='ai-panel__header'>
      <View className='ai-panel__title'>
        <Text className='ai-panel__title-icon'>🤖</Text>
        <Text>{currentTitle}</Text>
        <Text className='ai-panel__sub'>{sessions.length} 个会话</Text>
      </View>
      <View className='ai-panel__actions'>
        <View className='ai-panel__btn' onClick={() => setShowHistory((v) => !v)}>
          <Text>📋 历史</Text>
        </View>
        <View className='ai-panel__btn' onClick={onNewSession}>
          <Text>➕ 新会话</Text>
        </View>
        {mode === 'floating' && onClose && (
          <View className='ai-panel__btn ai-panel__btn--text' onClick={onClose}>
            <Text>✕ 关闭</Text>
          </View>
        )}
      </View>
      {showHistory && (
        <View
          style={{
            position: 'absolute',
            right: '24rpx',
            top: '88rpx',
            background: '#fff',
            border: '1rpx solid #eee',
            borderRadius: '12rpx',
            boxShadow: '0 4rpx 16rpx rgba(0,0,0,0.1)',
            zIndex: 10,
            maxHeight: '60vh',
            minWidth: '320rpx',
            overflowY: 'auto',
          }}
        >
          {sessions.length === 0 ? (
            <View style={{ padding: '24rpx' }}>
              <Text style={{ color: '#aaa' }}>暂无历史会话</Text>
            </View>
          ) : (
            sessions.map((s) => (
              <View
                key={s.id}
                style={{
                  padding: '20rpx 24rpx',
                  borderBottom: '1rpx solid #f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: s.id === currentSessionId ? '#eaf3ff' : 'transparent',
                }}
              >
                <View
                  style={{ flex: 1 }}
                  onClick={() => {
                    onSwitchSession(s.id)
                    setShowHistory(false)
                  }}
                >
                  <Text style={{ fontSize: '26rpx' }}>{s.title}</Text>
                  <Text style={{ fontSize: '20rpx', color: '#888', marginLeft: '12rpx' }}>
                    {s.messages.length} 条
                  </Text>
                </View>
                <View
                  style={{ padding: '4rpx 12rpx' }}
                  onClick={() => onDeleteSession(s.id)}
                >
                  <Text style={{ color: '#cf1322' }}>删除</Text>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  )
}

interface InputBarProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled: boolean
}

function InputBar({ value, onChange, onSend, disabled }: InputBarProps) {
  return (
    <View className='ai-panel__input-bar'>
      <Textarea
        className='ai-panel__input'
        placeholder='输入消息，如：入库5个干粉灭火器'
        value={value}
        onInput={(e) => onChange(e.detail.value)}
        onConfirm={onSend}
        confirmType='send'
        autoHeight
        maxlength={500}
        // P2-6: H5 端 confirmType 不生效，监听 onKeyDown 兜底 Enter 发送
        {...{ onKeyDown: (e: any) => {
          if (e?.key === 'Enter' && !e?.shiftKey && !disabled) {
            e.preventDefault?.()
            onSend()
          }
        }} as any}
      />
      <Button
        className={`ai-panel__send ${disabled ? 'ai-panel__send--disabled' : ''}`}
        size='mini'
        onClick={onSend}
        disabled={disabled}
      >
        发送
      </Button>
    </View>
  )
}
