import { Request, Response, NextFunction } from 'express'
import { config } from '../config'
import { isAppError } from '../utils/errors'

/** 404 兜底：未匹配到的路由 */
export function notFound(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({ code: 404, message: `Not Found: ${req.method} ${req.path}` })
}

/**
 * 全局错误处理中间件（必须放在所有路由之后，且参数数量为 4）
 *
 * P1-8 安全修复：
 * - 生产环境 5xx 错误只返回通用消息 'Internal Server Error'，不泄漏 err.message
 * - 业务错误（< 500，如 400/404）保留 err.message 便于前端处理
 * - 完整 err.stack 写入服务端日志（console.error）
 * - 支持 err.isOperational 标志位（业务错误设为 true，默认 false）
 *
 * P2-10 增强：
 * - 支持 AppError 子类：err.status / err.isOperational / err.meta 自动映射
 * - 路由层不再用 msg.includes('不存在')，改用 throw new NotFoundError(...)
 */
export function errorHandler(
  err: Error & {
    status?: number
    isOperational?: boolean
    meta?: Record<string, any>
  },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // P2-10: AppError 优先使用其 status（404/400/409/...）
  let status: number
  let isOperational: boolean
  let meta: Record<string, any> | undefined
  if (isAppError(err)) {
    status = err.status
    isOperational = err.isOperational
    meta = err.meta
  } else {
    status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500
    isOperational = err.isOperational === true || status < 500
  }

  const isProd = config.nodeEnv === 'production'

  // 完整堆栈写入服务端日志
  console.error('[error]', {
    message: err.message,
    status,
    isOperational,
    stack: err.stack,
  })

  // 生产环境 5xx 非业务错误：只返回通用消息，不泄漏内部细节
  if (isProd && status >= 500) {
    res.status(status).json({ code: status, message: 'Internal Server Error' })
    return
  }

  // 业务错误（< 500）或开发环境：返回 err.message 便于排查
  const body: Record<string, any> = { code: status, message: err.message }
  if (meta) {
    Object.assign(body, meta)
  }
  res.status(status).json(body)
}