import { Router, Request, Response } from 'express'
import { authRequired } from '../middlewares/auth'
import { requireAdmin } from '../middlewares/role'
import {
  getAllPermissions,
  getRolesWithPermissions,
  setRolePermissions,
  getPermissionById,
} from '../services/permission.service'
import { Role } from '../types'

const router = Router()

router.use(authRequired)

router.get('/', requireAdmin, (_req: Request, res: Response) => {
  const permissions = getAllPermissions()
  res.json({ code: 0, message: 'ok', data: permissions })
})

router.get('/roles', requireAdmin, (_req: Request, res: Response) => {
  const roles = getRolesWithPermissions()
  res.json({ code: 0, message: 'ok', data: roles })
})

router.get('/roles/:role', requireAdmin, (req: Request, res: Response) => {
  const role = req.params.role as Role
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    res.status(400).json({ code: 400, message: '无效角色' })
    return
  }
  const roles = getRolesWithPermissions()
  const result = roles.find((r) => r.role === role)
  if (!result) {
    res.status(404).json({ code: 404, message: '角色不存在' })
    return
  }
  res.json({ code: 0, message: 'ok', data: result })
})

router.put('/roles/:role', requireAdmin, (req: Request, res: Response) => {
  const role = req.params.role as Role
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    res.status(400).json({ code: 400, message: '无效角色' })
    return
  }
  const permissionIds = req.body.permissionIds as number[]
  if (!Array.isArray(permissionIds)) {
    res.status(400).json({ code: 400, message: 'permissionIds 必须是数组' })
    return
  }
  for (const id of permissionIds) {
    const p = getPermissionById(id)
    if (!p) {
      res.status(400).json({ code: 400, message: `权限 ID ${id} 不存在` })
      return
    }
  }
  try {
    setRolePermissions(role, permissionIds)
    const updated = getRolesWithPermissions().find((r) => r.role === role)
    res.json({ code: 0, message: '权限更新成功', data: updated })
  } catch (e) {
    res.status(400).json({ code: 400, message: (e as Error).message })
  }
})

export default router
