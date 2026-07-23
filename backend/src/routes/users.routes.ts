import { Router, Request, Response } from 'express'
import { authRequired } from '../middlewares/auth'
import { requirePermission } from '../middlewares/permission'
import {
  listUsers,
  getUserById,
  updateUserRole,
  updateUserProfile,
} from '../services/user.service'
import { Role } from '../types'

const router = Router()

// 所有 users 路由均需登录（解析 token 并挂载 req.user），再由各路由的角色守卫做细粒度控制
router.use(authRequired)

const VALID_ROLES: Role[] = ['admin', 'editor', 'viewer']

function toInt(v: unknown, def: number): number {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : def
}

/**
 * GET /me 当前登录用户信息
 */
router.get('/me', (req: Request, res: Response) => {
  res.json({ code: 0, message: 'ok', data: req.user })
})

/**
 * PATCH /me 修改当前登录用户资料
 * Body: { name?, avatar? }
 */
router.patch('/me', (req: Request, res: Response) => {
  const { name, avatar } = req.body || {}
  try {
    const updated = updateUserProfile(req.user!.id, {
      name: name !== undefined ? String(name) : undefined,
      avatar: avatar !== undefined ? avatar : undefined,
    })
    res.json({ code: 0, message: 'ok', data: updated })
  } catch (e) {
    res.status(400).json({ code: 400, message: (e as Error).message })
  }
})

/**
 * GET / 用户分页列表（仅 admin）
 * Query: role?, keyword?, page?, pageSize?
 */
router.get('/', requirePermission('user:read'), (req: Request, res: Response) => {
  const { role, keyword, page, pageSize } = req.query
  if (role !== undefined && role !== null && !VALID_ROLES.includes(role as Role)) {
    res.status(400).json({ code: 400, message: '非法角色筛选值' })
    return
  }
  const result = listUsers({
    role: (role as Role | undefined) || undefined,
    keyword: keyword ? String(keyword) : undefined,
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
  })
  res.json({ code: 0, message: 'ok', data: result })
})

/**
 * GET /:id 用户详情（admin 可查任意，其他角色仅可查自己）
 */
router.get('/:id', requirePermission('user:read'), (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法用户 id' })
    return
  }
  const user = req.user!
  if (user.role !== 'admin' && user.id !== id) {
    res.status(403).json({ code: 403, message: '无权限查看其他用户' })
    return
  }
  const found = getUserById(id)
  if (!found) {
    res.status(404).json({ code: 404, message: '用户不存在' })
    return
  }
  res.json({ code: 0, message: 'ok', data: found })
})

/**
 * PATCH /:id/role 修改用户角色（仅 admin，禁止修改自己）
 * Body: { role: 'admin' | 'editor' | 'viewer' }
 */
router.patch('/:id/role', requirePermission('user:manage'), (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法用户 id' })
    return
  }
  const { role } = req.body || {}
  if (!role || !VALID_ROLES.includes(role)) {
    res.status(400).json({ code: 400, message: '非法角色值' })
    return
  }
  // 防自降级：不能修改自己的角色
  if (req.user!.id === id) {
    res.status(403).json({ code: 403, message: '不能修改自己的角色' })
    return
  }
  try {
    const updated = updateUserRole(id, role as Role, req.user!)
    res.json({ code: 0, message: 'ok', data: updated })
  } catch (e) {
    res.status(400).json({ code: 400, message: (e as Error).message })
  }
})

/**
 * PATCH /:id/profile 修改用户资料（本人或 admin/editor）
 * Body: { name?, avatar? }
 */
router.patch('/:id/profile', (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法用户 id' })
    return
  }
  const user = req.user!
  const isPrivileged = user.role === 'admin' || user.role === 'editor'
  if (!isPrivileged && user.id !== id) {
    res.status(403).json({ code: 403, message: '无权限修改其他用户资料' })
    return
  }
  const { name, avatar } = req.body || {}
  try {
    const updated = updateUserProfile(id, {
      name: name !== undefined ? String(name) : undefined,
      avatar: avatar !== undefined ? avatar : undefined,
    })
    res.json({ code: 0, message: 'ok', data: updated })
  } catch (e) {
    res.status(400).json({ code: 400, message: (e as Error).message })
  }
})

export default router
