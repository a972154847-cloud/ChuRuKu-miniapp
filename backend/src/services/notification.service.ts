import axios from 'axios'
import db from '../db'
import { config } from '../config'
import type { RecordType } from '../types'

/**
 * 微信订阅消息通知服务
 *
 * 设计要点：
 * - access_token 模块级缓存，过期前 5 分钟提前刷新，避免每次发送都拉 token
 * - wxAppId / wxAppSecret / 模板 ID 任一未配置时整体跳过（降级），只记 warning 日志
 * - 所有发送失败只记日志不抛错，异步通知绝不阻塞主业务流程
 * - notifyRecordEvent 用 Promise.allSettled 并发推送给所有 admin + editor
 */

/** 订阅消息模板 ID（按实际微信小程序后台申请的模板填写，环境变量 WX_SUBSCRIBE_TEMPLATE_ID） */
const SUBSCRIBE_TEMPLATE_ID = process.env.WX_SUBSCRIBE_TEMPLATE_ID || ''

/** access_token 缓存：token + 过期时间戳（ms） */
interface CachedToken {
  token: string
  expiresAt: number
}
let cachedToken: CachedToken | null = null

/** 提前 5 分钟视为过期，避免临界点失效 */
const TOKEN_EXPIRE_BUFFER_MS = 5 * 60 * 1000

/**
 * 获取微信 access_token（带缓存）
 * - 命中未过期缓存直接复用
 * - 未配置 wxAppId / wxAppSecret 返回 null（调用方应跳过）
 */
export async function getWxAccessToken(): Promise<string | null> {
  if (!config.wxAppId || !config.wxAppSecret) {
    console.warn('[notification] wxAppId/wxAppSecret 未配置，跳过微信通知')
    return null
  }

  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token
  }

  const res = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: {
      grant_type: 'client_credential',
      appid: config.wxAppId,
      secret: config.wxAppSecret,
    },
    timeout: 5000,
  })

  if (res.data.errcode) {
    throw new Error(
      `[notification] 获取 access_token 失败: ${res.data.errcode} ${res.data.errmsg}`
    )
  }

  const token: string = res.data.access_token
  const expiresIn: number = Number(res.data.expires_in) || 7200
  cachedToken = {
    token,
    expiresAt: now + expiresIn * 1000 - TOKEN_EXPIRE_BUFFER_MS,
  }
  return token
}

/** 仅供测试使用：重置 access_token 缓存 */
export function __resetTokenCacheForTest(): void {
  cachedToken = null
}

/**
 * 发送微信订阅消息
 * - messageKey: 模板字段 key（按实际模板定义）
 * - 失败时只记日志不抛错
 * - 未配置模板 ID 或未拿到 access_token 时静默跳过
 */
export async function sendWxSubscribeMessage(
  messageKey: string,
  openid: string,
  data: Record<string, { value: string }>
): Promise<void> {
  if (!SUBSCRIBE_TEMPLATE_ID) {
    console.warn('[notification] SUBSCRIBE_TEMPLATE_ID 未配置，跳过订阅消息发送')
    return
  }
  if (!openid) {
    console.warn('[notification] openid 为空，跳过订阅消息发送')
    return
  }

  let accessToken: string | null
  try {
    accessToken = await getWxAccessToken()
  } catch (e) {
    console.warn('[notification] 获取 access_token 异常，跳过发送:', (e as Error).message)
    return
  }
  if (!accessToken) {
    return
  }

  try {
    const res = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/message/subscribe/send',
      {
        touser: openid,
        template_id: SUBSCRIBE_TEMPLATE_ID,
        // page 可选，跳转小程序页面；这里默认跳记录页
        page: 'pages/records/index',
        data,
      },
      {
        params: { access_token: accessToken },
        timeout: 5000,
      }
    )
    if (res.data.errcode) {
      console.warn(
        `[notification] 订阅消息发送失败: ${res.data.errcode} ${res.data.errmsg} (openid=${openid}, key=${messageKey})`
      )
    }
  } catch (e) {
    console.warn(
      `[notification] 订阅消息发送异常 (openid=${openid}, key=${messageKey}):`,
      (e as Error).message
    )
  }
}

/** notifyRecordEvent 入参：记录事件信息 */
export interface RecordEventPayload {
  type: RecordType
  equipment_name: string
  quantity: number
  operator_name: string
}

/**
 * 查询所有 admin + editor 用户的 openid（用于推送出入库通知）
 */
export function listNotifyOpenids(): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT openid FROM users
       WHERE role IN ('admin', 'editor') AND openid IS NOT NULL AND openid != ''`
    )
    .all() as Array<{ openid: string }>
  return rows.map((r) => r.openid)
}

/**
 * 出/入库事件通知：异步并发推送给所有 admin + editor
 * - 不阻塞主流程：调用方应使用 void / Promise.resolve().then(...) 包裹
 * - 内部用 Promise.allSettled，任一失败不影响其它
 */
export async function notifyRecordEvent(record: RecordEventPayload): Promise<void> {
  // 未配置 wxAppId / 模板 ID 时整体跳过，避免无谓查库和网络调用
  if (!config.wxAppId || !config.wxAppSecret || !SUBSCRIBE_TEMPLATE_ID) {
    console.warn(
      '[notification] wxAppId/wxAppSecret/模板未配置，跳过 notifyRecordEvent'
    )
    return
  }

  const openids = listNotifyOpenids()
  if (openids.length === 0) {
    return
  }

  const actionLabel = record.type === 'out' ? '出库' : '入库'
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

  // 微信订阅消息 data 字段：按实际模板字段调整 key
  // 这里使用通用 key，实际接入时需对齐模板配置
  const data: Record<string, { value: string }> = {
    thing1: { value: actionLabel },
    thing2: { value: record.equipment_name || '未知器材' },
    number3: { value: String(record.quantity) },
    thing4: { value: record.operator_name || '未知操作人' },
    time5: { value: time },
  }

  const results = await Promise.allSettled(
    openids.map((openid) => sendWxSubscribeMessage('record_event', openid, data))
  )
  const rejected = results.filter((r) => r.status === 'rejected')
  if (rejected.length > 0) {
    console.warn(
      `[notification] notifyRecordEvent 有 ${rejected.length}/${results.length} 条推送被拒绝`
    )
  }
}

export default {
  getWxAccessToken,
  sendWxSubscribeMessage,
  notifyRecordEvent,
  listNotifyOpenids,
}
