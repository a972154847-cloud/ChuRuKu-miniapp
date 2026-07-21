import { Request, Response, NextFunction } from 'express'
import { Role } from '../types'

/**
 * 角色守卫：仅允许指定角色通过
 * - 未登录返回 401
 * - 角色不匹配返回 403
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ code: 401, message: '未登录' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ code: 403, message: '无权限操作，请联系管理员授权' })
      return
    }
    next()
  }
}

/** 仅管理员 */
export const requireAdmin = requireRole('admin')

/** 管理员或编辑者 */
export const requireEditor = requireRole('admin', 'editor')

/** 所有已登录角色（admin/editor/viewer） */
export const requireViewer = requireRole('admin', 'editor', 'viewer')

export default requireRole
