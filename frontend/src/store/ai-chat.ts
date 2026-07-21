import Taro from '@tarojs/taro'
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

/** 单条消息 */
export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 工具调用轨迹 */
  toolTrace?: Array<{ tool: string; args: any; result: any; success: boolean }>
  /** 关联的照片 URL（仅用户消息，发送入库时传给后端） */
  pendingPhotos?: string[]
  error?: boolean
  createdAt: number
}

/** 会话 */
export interface AiChatSession {
  id: string
  title: string
  messages: AiChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 面板模式：互斥，确保页面版和浮窗版不同时出现 */
export type AiPanelMode = 'closed' | 'floating' | 'page'

interface AiChatState {
  sessions: AiChatSession[]
  currentSessionId: string | null
  panelMode: AiPanelMode
  draftInput: string
  loading: boolean
  /** 订阅：图片回填到入库表单（供 record-edit 订阅） */
  pendingInboundPhotos: string[]

  // actions
  openFloatingPanel: () => void
  openPagePanel: () => void
  closePanel: () => void
  setDraft: (text: string) => void
  setLoading: (loading: boolean) => void
  newSession: () => string
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  appendMessage: (msg: AiChatMessage) => void
  /** 给当前用户消息添加/清除照片（用于入库带图） */
  setPendingPhotos: (msgId: string, photos: string[]) => void
  clearSession: () => void
  /** 入库表单订阅：把照片回填到 record-edit 后清空 */
  consumeInboundPhotos: () => string[]
  setInboundPhotos: (photos: string[]) => void
}

/**
 * 跨端 storage 适配器（Taro H5 + 小程序）
 * - 优先使用 Taro.getStorageSync（H5 / 小程序通用）
 * - Taro 未就绪时 fallback 到 localStorage（H5 端 SSR 防护）
 * - 空串视为 null（zustand persist 要求 null/undefined 表示"无值"）
 */
const aiStorage: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      const v = Taro.getStorageSync(name)
      if (v === '' || v === undefined || v === null) {
        if (typeof localStorage !== 'undefined') {
          const ls = localStorage.getItem(name)
          return ls === null || ls === '' ? null : ls
        }
        return null
      }
      return typeof v === 'string' ? v : String(v)
    } catch {
      try {
        if (typeof localStorage !== 'undefined') {
          const ls = localStorage.getItem(name)
          return ls === null || ls === '' ? null : ls
        }
      } catch {
        // ignore
      }
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      Taro.setStorageSync(name, value)
    } catch {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(name, value)
        }
      } catch {
        // ignore
      }
    }
  },
  removeItem: (name: string): void => {
    try {
      Taro.removeStorageSync(name)
    } catch {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(name)
        }
      } catch {
        // ignore
      }
    }
  },
}

/** P2: STORAGE_KEY 加版本前缀，未来 schema 升级可平滑迁移 */
const STORAGE_KEY = 'v1:ai-chat-store'
const MAX_SESSIONS = 20
const MAX_MESSAGES_PER_SESSION = 100
/**
 * F-2: 微信小程序单 key 1MB / 总 10MB 限制。
 * ai-chat-store 单 key 预算 800KB（预留 200KB 给其他小程序 storage）。
 * 持久化前估算字节数，超过阈值按更新时间倒序裁剪老会话。
 */
const MAX_TOTAL_BYTES = 800 * 1024

function genId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function makeTitle(firstUserMessage: string): string {
  const t = firstUserMessage.trim().slice(0, 20)
  return t || '新会话'
}

/** 估算会话 JSON 序列化字节数（粗略按 UTF-16 计算） */
function approxBytes(sessions: AiChatSession[]): number {
  try {
    return JSON.stringify(sessions).length * 2
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

/**
 * F-2: 按字节数裁剪会话列表
 * - 先按数量裁剪到 MAX_SESSIONS
 * - 再按 updatedAt 倒序，逐个累加字节数，超过 MAX_TOTAL_BYTES 则丢弃
 * - 同时限制每个会话的消息数为 MAX_MESSAGES_PER_SESSION（保留尾部）
 */
function trimSessions(sessions: AiChatSession[]): AiChatSession[] {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const capped = sorted.slice(0, MAX_SESSIONS).map((s) => ({
    ...s,
    messages: s.messages.slice(-MAX_MESSAGES_PER_SESSION),
  }))
  let total = approxBytes(capped)
  if (total <= MAX_TOTAL_BYTES) return capped
  // 字节超限：从最老的开始逐个丢弃，直到达标
  let lo = 0
  let hi = capped.length
  while (lo < hi && total > MAX_TOTAL_BYTES) {
    hi -= 1
    total = approxBytes(capped.slice(0, hi))
  }
  return capped.slice(0, Math.max(1, hi))
}

export const useAiChatStore = create<AiChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      panelMode: 'closed',
      draftInput: '',
      loading: false,
      pendingInboundPhotos: [],

      openFloatingPanel: () => {
        // F-3: 真正互斥 — page 模式占用时拒绝打开浮窗
        if (get().panelMode === 'page') return
        set({ panelMode: 'floating' })
      },
      openPagePanel: () => {
        // F-3: 真正互斥 — 打开 page 模式时强制关闭浮窗
        set({ panelMode: 'page' })
      },
      closePanel: () => {
        set({ panelMode: 'closed' })
      },
      setDraft: (text) => set({ draftInput: text }),
      setLoading: (loading) => set({ loading }),
      setInboundPhotos: (photos) => set({ pendingInboundPhotos: photos }),

      newSession: () => {
        const id = genId()
        const now = Date.now()
        const session: AiChatSession = {
          id,
          title: '新会话',
          messages: [],
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({
          sessions: trimSessions([session, ...s.sessions]),
          currentSessionId: id,
        }))
        return id
      },

      switchSession: (id) => {
        const exists = get().sessions.some((s) => s.id === id)
        if (exists) set({ currentSessionId: id })
      },

      deleteSession: (id) => {
        set((s) => {
          const remaining = s.sessions.filter((x) => x.id !== id)
          const nextCurrent =
            s.currentSessionId === id ? (remaining[0]?.id ?? null) : s.currentSessionId
          return { sessions: remaining, currentSessionId: nextCurrent }
        })
      },

      appendMessage: (msg) => {
        set((s) => {
          let { sessions, currentSessionId } = s
          if (!currentSessionId) {
            const id = genId()
            const now = Date.now()
            const firstUserTitle = msg.role === 'user' ? makeTitle(msg.content) : '新会话'
            const newSession: AiChatSession = {
              id,
              title: firstUserTitle,
              messages: [msg],
              createdAt: now,
              updatedAt: now,
            }
            return {
              sessions: trimSessions([newSession, ...sessions]),
              currentSessionId: id,
            }
          }
          sessions = sessions.map((sess) => {
            if (sess.id !== currentSessionId) return sess
            // 若新消息是该会话首条用户消息，更新标题
            const isFirstUser =
              msg.role === 'user' &&
              !sess.messages.some((m) => m.role === 'user')
            return {
              ...sess,
              title: isFirstUser ? makeTitle(msg.content) : sess.title,
              messages: [...sess.messages, msg],
              updatedAt: Date.now(),
            }
          })
          return { sessions: trimSessions(sessions) }
        })
      },

      setPendingPhotos: (msgId, photos) => {
        set((s) => {
          if (!s.currentSessionId) return s
          return {
            sessions: s.sessions.map((sess) => {
              if (sess.id !== s.currentSessionId) return sess
              return {
                ...sess,
                messages: sess.messages.map((m) =>
                  m.id === msgId ? { ...m, pendingPhotos: photos } : m
                ),
              }
            }),
          }
        })
      },

      clearSession: () => {
        set({ currentSessionId: null })
      },

      consumeInboundPhotos: () => {
        const photos = get().pendingInboundPhotos
        if (photos.length > 0) set({ pendingInboundPhotos: [] })
        return photos
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => aiStorage),
      // 持久化：会话 + 当前会话 ID；面板状态不持久（默认关闭）
      partialize: (state) => ({
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
        pendingInboundPhotos: state.pendingInboundPhotos,
      }),
      version: 1,
    }
  )
)

/**
 * P2-7: 暴露 rehydrate 入口，由 app.ts 的 useLaunch 显式调用，
 * 与 userStore 加载顺序对齐；避免 Taro storage 在模块加载时尚未就绪导致 rehydrate 静默失败。
 */
export async function rehydrateAiChatStore(): Promise<void> {
  try {
    await useAiChatStore.persist.rehydrate()
  } catch {
    // Taro storage 未就绪 / 浏览器隐私模式等，忽略
  }
}
