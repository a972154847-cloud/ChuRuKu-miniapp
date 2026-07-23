import { Request, Response, NextFunction } from 'express'

export function requirePermission(...permissionCodes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ code: 401, message: '未登录' })
      return
    }
    const userPermissions = req.user.permissions || []
    const hasPermission = permissionCodes.some((code) => userPermissions.includes(code))
    if (!hasPermission) {
      res.status(403).json({ code: 403, message: '无权限操作，请联系管理员授权' })
      return
    }
    next()
  }
}

export default requirePermission
