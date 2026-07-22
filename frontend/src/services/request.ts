import Taro from '@tarojs/taro'
import { useUserStore } from '@/store/user'

// 手机真机调试时，localhost 指向手机本身而非电脑后端。
// 开发环境下使用电脑局域网 IP，手机和电脑需在同一 WiFi。
// 注意：微信小程序运行时没有 process.env，使用 defineConstants 注入的全局变量。
// 如果 TARO_APP_API_BASE_URL 未定义，回退到局域网 IP。
const BASE_URL = (typeof TARO_APP_API_BASE_URL !== 'undefined' && TARO_APP_API_BASE_URL) || 'http://localhost:3000/api'
const TIMEOUT = 10000
const RETRY_COUNT = 1

export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: any
  header?: Record<string, string>
  timeout?: number
}

/** 安全提取错误信息字符串，兼容 Error / 微信 fail 对象 / 字符串 */
function getErrMsg(err: unknown): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  const e = err as any
  if (typeof e.message === 'string') return e.message
  if (typeof e.errMsg === 'string') return e.errMsg
  return ''
}

/**
 * 401 未授权处理：清理本地凭据并跳转登录页
 * - isRedirecting 防止并发请求同时返回 401 时重复 reLaunch
 */
let isRedirecting = false
function handleUnauthorized(): void {
  if (isRedirecting) return
  isRedirecting = true
  try {
    // 同时清空 Zustand 内存态和小程序存储，避免登录页仍读取旧 token 后跳回首页。
    useUserStore.getState().logout()
  } catch (e) {
    // ignore storage errors
  }
  Taro.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 1500 })
  setTimeout(() => {
    Taro.reLaunch({
      url: '/pages/login/index',
      complete: () => {
        isRedirecting = false
      }
    })
  }, 1500)
}

/**
 * API 错误类：携带完整的响应数据，调用方可据此判断 has_equipments 等业务标记
 */
export class ApiError extends Error {
  statusCode: number
  body: any
  constructor(message: string, statusCode: number, body: any) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.body = body || {}
  }
  /** 是否有关联器材（删除分类场景） */
  get hasEquipments(): boolean {
    return Boolean(this.body && this.body.has_equipments)
  }
}

/**
 * 过滤请求数据中的 undefined 值，避免被序列化为字符串 "undefined"
 * 微信小程序环境下 Taro.request 可能不自动忽略 undefined 属性
 */
function cleanData(data: any): any {
  if (!data || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(cleanData)
  const cleaned: Record<string, any> = {}
  for (const key of Object.keys(data)) {
    if (data[key] !== undefined) {
      cleaned[key] = data[key]
    }
  }
  return cleaned
}

export async function request<T = any>(options: RequestOptions, retry = 0): Promise<T> {
  const token = Taro.getStorageSync('token')
  try {
    const res = await Taro.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: cleanData(options.data),
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.header
      },
      timeout: options.timeout || TIMEOUT
    })
    if (res.statusCode >= 400) {
      const body = (res.data as any) || {}
      const message = body.message || '请求失败'
      // P1-19: 401 未授权 —— 清理 token 并跳转登录页（带并发重定向保护）
      if (res.statusCode === 401) {
        handleUnauthorized()
      }
      // 不在此处 toast，由调用方决定是否提示（支持二次确认等场景）
      throw new ApiError(message, res.statusCode, body)
    }
    const body = res.data as any
    if (
      body &&
      typeof body === 'object' &&
      'code' in body &&
      body.code === 0 &&
      'data' in body
    ) {
      return body.data as T
    }
    if (body && typeof body === 'object' && body.code !== 0) {
      const message = body.message || '请求失败'
      throw new ApiError(message, res.statusCode || 400, body)
    }
    return body as T
  } catch (err) {
    const msg = getErrMsg(err)
    const isTimeout = msg.includes('timeout') || msg.includes('超时')
    if (retry < RETRY_COUNT && isTimeout) {
      return request(options, retry + 1)
    }
    // ApiError 不再自动 toast，由调用方处理；网络错误才 toast
    if (!(err instanceof ApiError)) {
      Taro.showToast({
        title: isTimeout ? '网络超时，请检查网络连接' : (msg || '网络出错，请重试'),
        icon: 'none'
      })
    }
    throw err
  }
}

export default request
