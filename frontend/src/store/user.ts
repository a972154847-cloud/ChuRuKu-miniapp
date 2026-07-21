import Taro from '@tarojs/taro'
import { create } from 'zustand'
import type { Role } from '@/types'

const TOKEN_KEY = 'token'
const USER_KEY = 'user'

export interface CurrentUser {
  id: number
  name: string
  role: Role
  avatar?: string
  created_at?: string
}

interface UserState {
  token: string | null
  user: CurrentUser | null
  setAuth: (token: string, user: CurrentUser) => void
  logout: () => void
  loadFromStorage: () => void
}

/**
 * 全局用户登录态 store
 * 跨端兼容：用 Taro.setStorageSync/getStorageSync（H5 + 小程序通用）
 */
export const useUserStore = create<UserState>()((set) => ({
  token: null,
  user: null,
  setAuth: (token, user) => {
    set({ token, user })
    Taro.setStorageSync(TOKEN_KEY, token)
    Taro.setStorageSync(USER_KEY, JSON.stringify(user))
  },
  logout: () => {
    set({ token: null, user: null })
    Taro.removeStorageSync(TOKEN_KEY)
    Taro.removeStorageSync(USER_KEY)
  },
  loadFromStorage: () => {
    // 优先用 Taro API（跨端兼容），失败时 H5 端 fallback 到 localStorage。
    //
    // 背景：Taro H5 端在模块加载初期，storage 适配器可能尚未完成初始化，
    // 直接调 Taro.getStorageSync 会返回空串或抛错。H5 端的 Taro storage
    // 内部本就是 localStorage，这里加 fallback 保证 store 创建时一定能
    // 读到登录态，避免子组件 mount 时 token 为 null 触发 reLaunch login。
    let token: string | null = null
    let userStr: string | null = null
    try {
      token = Taro.getStorageSync(TOKEN_KEY) || null
      userStr = Taro.getStorageSync(USER_KEY) || null
    } catch {
      // Taro 未初始化，fallback 到 localStorage（H5 端）
    }
    if ((!token || !userStr) && typeof localStorage !== 'undefined') {
      try {
        token = token || localStorage.getItem(TOKEN_KEY) || null
        userStr = userStr || localStorage.getItem(USER_KEY) || null
      } catch {
        // localStorage 不可访问（如 SSR），忽略
      }
    }
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr as string) as CurrentUser
        set({ token, user })
      } catch {
        // 损坏数据清空，避免反复抛错
        try {
          Taro.removeStorageSync(TOKEN_KEY)
          Taro.removeStorageSync(USER_KEY)
        } catch {
          // ignore
        }
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem(USER_KEY)
          } catch {
            // ignore
          }
        }
      }
    }
  }
}))

// 模块加载时立即从存储恢复登录态，避免子组件 mount 时 user 为 null。
//
// 背景：React useEffect 执行顺序是"子先父后"。dashboard / record-edit 等子组件
// mount 时 useUserStore 读取的是初始值 null，若依赖 token 的 useEffect 先于
// app.ts 的 loadFromStorage() 执行，会触发 reLaunch('/pages/login/index')，
// 导致 E2E 测试无法导航到目标页。
//
// 解决：在 store 创建后立即调用 loadFromStorage()，使初始 state 已包含 storage
// 中的 token/user。app.ts 的 useEffect 仍保留作为兜底（Taro 环境未就绪时）。
//
// try/catch 兜底：Taro 在某些环境下（如 SSR 或测试环境）可能未初始化完成，
// 抛错时不影响后续 app.ts 的 useEffect 再次调用。
try {
  useUserStore.getState().loadFromStorage()
} catch {
  // Taro 环境未就绪时忽略，app.ts 的 useEffect 会兜底
}
