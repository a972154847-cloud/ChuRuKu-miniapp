import axios from 'axios'
import jwt from 'jsonwebtoken'
import { Request, Response, NextFunction } from 'express'
import db from '../db'
import { config } from '../config'
import { AuthUser, Role } from '../types'
import { writeLog } from '../services/log.service'

interface WxLoginResult {
  openid: string
  session_key: string
  unionid?: string
}

export const WX_LOGIN_TIMEOUT_MS = 8000

/** 仅识别网络层超时，不把微信业务错误误判为可重试的超时。 */
export function isWxLoginTimeout(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT'
}

/**
 * P1-7: 兜底为 users 表添加 status 列（migrate.ts 不在本任务范围）
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，用 PRAGMA table_info 检查列是否存在
 * 用 try-catch 包裹：测试环境 migrations 未运行时 users 表不存在，静默跳过（migrations 会创建）
 */
function ensureUsersStatusColumn(): void {
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
    if (cols.length === 0) return // users 表不存在，跳过（migrations 会创建）
    if (!cols.some((c) => c.name === 'status')) {
      db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    }
  } catch (err) {
    // 模块加载时机早于 migrations 时 users 表不存在，静默跳过
    console.warn('[auth] ensureUsersStatusColumn skipped:', (err as Error).message)
  }
}
ensureUsersStatusColumn()

/**
 * 调用微信 jscode2session 接口，用 code 换取 openid
 */
export async function wxLogin(code: string): Promise<WxLoginResult> {
  const res = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
    params: {
      appid: config.wxAppId,
      secret: config.wxAppSecret,
      js_code: code,
      grant_type: 'authorization_code',
    },
    timeout: WX_LOGIN_TIMEOUT_MS,
  })
  if (res.data.errcode) {
    throw new Error(`微信登录失败: ${res.data.errcode} ${res.data.errmsg}`)
  }
  return res.data as WxLoginResult
}

/**
 * 签发 JWT，payload 包含 id/openid/name/role
 */
export function signToken(user: AuthUser): string {
  // @types/jsonwebtoken 9.x 将 expiresIn 限定为 ms.StringValue 字面量，
  // 但运行时支持任意字符串（如 '2h'）；config.jwtExpiresIn 为 string，故用 SignOptions 类型断言绕过
  const opts: jwt.SignOptions = { expiresIn: config.jwtExpiresIn as unknown as jwt.SignOptions['expiresIn'] }
  return jwt.sign(
    { id: user.id, openid: user.openid, name: user.name, role: user.role },
    config.jwtSecret,
    opts
  )
}

/** P1-7: 用户行缓存类型 */
interface UserRow {
  id: number
  role: string
  status: string
}

interface CachedUser {
  user: UserRow | undefined
  expiresAt: number
}

// P1-7: 30 秒内存缓存，避免每次请求查 DB
const userCache = new Map<number, CachedUser>()
const USER_CACHE_TTL = 30 * 1000

function loadUserFromDb(id: number): UserRow | undefined {
  return db.prepare('SELECT id, role, status FROM users WHERE id = ?').get(id) as
    | UserRow
    | undefined
}

function getUserWithCache(id: number): UserRow | undefined {
  const now = Date.now()
  const cached = userCache.get(id)
  if (cached && cached.expiresAt > now) {
    return cached.user
  }
  const user = loadUserFromDb(id)
  userCache.set(id, { user, expiresAt: now + USER_CACHE_TTL })
  return user
}

/**
 * V-2 安全修复：主动失效指定用户的缓存
 * - 业务场景：用户被禁用/启用、角色变更、删除时调用
 * - 防止 30s TTL 内的旧 token 继续访问系统
 * - service 层（updateUserRole / future disableUser）应调用此函数
 */
export function invalidateUserCache(id: number): void {
  userCache.delete(id)
}

/**
 * 验证 JWT，合法且用户存在且未禁用返回 AuthUser，否则返回 null
 * P1-7: jwt.verify 后查询 users 表（带 30s 缓存），
 *        用户不存在或 status='disabled' 返回 null；role 以 DB 最新值为准
 */
export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser
    // P1-7: 查询 users 表，确认用户存在且未禁用
    const row = getUserWithCache(payload.id)
    if (!row || row.status === 'disabled') {
      return null
    }
    // P1-7: 使用 DB 中的最新 role（防止 token 中 role 过期后仍可越权）
    return {
      id: row.id,
      openid: payload.openid,
      name: payload.name,
      role: row.role as Role,
    }
  } catch {
    return null
  }
}

/**
 * 鉴权中间件：从 Authorization 头解析 Bearer token，验证后挂载 req.user
 * P1-12: token 验证失败时记录审计日志（含 IP/UA，便于追溯异常访问）
 */
export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: '未登录' })
    return
  }
  const token = header.slice(7)
  const user = verifyToken(token)
  if (!user) {
    // P1-12: token 验证失败写审计日志（含 IP/UA）
    writeLog({
      actorId: null,
      action: 'auth.failed',
      entity: 'user',
      entityId: null,
      ip: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    })
    res.status(401).json({ code: 401, message: '登录已过期，请重新登录' })
    return
  }
  req.user = user
  next()
}

/** 向后兼容别名 */
export const authenticate = authRequired

export default authRequired
