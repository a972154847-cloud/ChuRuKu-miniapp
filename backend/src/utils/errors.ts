/**
 * 业务错误类型 — P2-10：替换路由层 msg.includes('不存在') 字符串匹配
 *
 * 错误层级：
 * - AppError（基类）：带 status + isOperational=true，会被 errorHandler 正确映射
 * - NotFoundError (404)：资源不存在（记录/分类/用户/照片）
 * - ValidationError (400)：输入参数不合法
 * - ConflictError (409)：业务约束冲突（如"有关联器材"）
 *
 * 优势：
 * 1. 路由层用 `instanceof` 判定状态码，不再依赖 message 字符串
 * 2. errorHandler 已支持 err.status 映射，无需改中间件
 * 3. 测试可断言具体错误类型，而非模糊字符串包含
 */

export class AppError extends Error {
  status: number
  isOperational: boolean
  /** 业务标记（如 has_equipments），由 errorHandler 透传到响应 */
  meta?: Record<string, any>

  constructor(message: string, status: number, meta?: Record<string, any>) {
    super(message)
    this.name = new.target.name
    this.status = status
    this.isOperational = true
    this.meta = meta
    // 修复 TS 继承 Error 时 prototype chain 断裂
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 404 — 资源不存在 */
export class NotFoundError extends AppError {
  constructor(message: string = '资源不存在') {
    super(message, 404)
  }
}

/** 400 — 输入参数不合法 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400)
  }
}

/** 409 — 业务约束冲突（如"有关联器材"、"库存不足"） */
export class ConflictError extends AppError {
  constructor(message: string, meta?: Record<string, any>) {
    super(message, 409, meta)
  }
}

/** 类型守卫：判断是否为业务错误 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}
