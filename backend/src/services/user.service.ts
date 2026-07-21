import db from '../db'
import { writeLog } from './log.service'
import { NotFoundError, ValidationError } from '../utils/errors'
import { PaginatedResult, Role, User } from '../types'
import { invalidateUserCache } from '../middlewares/auth'

interface ListUsersOptions {
  role?: Role
  keyword?: string
  page?: number
  pageSize?: number
}

interface Operator {
  id: number
}

/**
 * 用户分页列表，支持按角色与关键字（name 模糊）筛选
 */
export function listUsers(opts: ListUsersOptions): PaginatedResult<User> {
  const page = opts.page && opts.page > 0 ? opts.page : 1
  const pageSize = Math.min(Math.max(opts.pageSize && opts.pageSize > 0 ? opts.pageSize : 20, 1), 100)

  const where: string[] = []
  const params: unknown[] = []
  if (opts.role) {
    where.push('role = ?')
    params.push(opts.role)
  }
  if (opts.keyword) {
    where.push('name LIKE ?')
    params.push(`%${opts.keyword}%`)
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM users ${whereClause}`).get(...params) as { c: number }
  ).c
  const list = db
    .prepare(`SELECT * FROM users ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as User[]

  return { list, total, page, pageSize }
}

/**
 * 根据 id 查询用户，不存在返回 null
 */
export function getUserById(id: number): User | null {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
  return user ?? null
}

/**
 * 修改用户角色：禁止修改自己，记录 role.change 日志
 */
export function updateUserRole(id: number, newRole: Role, operator: Operator): User {
  if (operator.id === id) {
    throw new Error('不能修改自己的角色')
  }
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
  if (!existing) {
    throw new NotFoundError('用户不存在')
  }
  const oldRole = existing.role
  db.prepare(
    "UPDATE users SET role = ?, updated_at = datetime('now','+8 hours') WHERE id = ?"
  ).run(newRole, id)
  // V-2 安全修复：角色变更立即失效缓存，防止旧 token 30s 内继续按旧角色访问
  invalidateUserCache(id)
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User
  writeLog({
    actorId: operator.id,
    action: 'role.change',
    entity: 'user',
    entityId: id,
    before: { role: oldRole },
    after: { role: newRole },
  })
  return updated
}

interface UpdateProfileOptions {
  name?: string
  avatar?: string | null
}

/**
 * 修改用户资料（name / avatar）
 */
export function updateUserProfile(id: number, opts: UpdateProfileOptions): User {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
  if (!existing) {
    throw new NotFoundError('用户不存在')
  }
  if (opts.name !== undefined) {
    db.prepare(
      "UPDATE users SET name = ?, updated_at = datetime('now','+8 hours') WHERE id = ?"
    ).run(opts.name, id)
  }
  if (opts.avatar !== undefined) {
    db.prepare(
      "UPDATE users SET avatar = ?, updated_at = datetime('now','+8 hours') WHERE id = ?"
    ).run(opts.avatar, id)
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User
}

export default { listUsers, getUserById, updateUserRole, updateUserProfile }
