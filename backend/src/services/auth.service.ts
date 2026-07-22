import db from '../db'
import { config } from '../config'
import { writeLog } from './log.service'
import { Role, User } from '../types'

interface UserInfo {
  name?: string
  avatar?: string | null
}

/**
 * 微信登录/注册：根据 openid 查找用户
 * - 已存在：更新 name/avatar（若提供），写 user.login 日志，返回用户
 * - 不存在：按"首用户 admin、其余 viewer"规则分配角色，写入并写 user.register 日志
 */
export function loginOrRegister(openid: string, userInfo?: UserInfo): User {
  const existing = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid) as
    | User
    | undefined

  if (existing) {
    if (userInfo?.name) {
      db.prepare(
        "UPDATE users SET name = ?, updated_at = datetime('now','+8 hours') WHERE id = ?"
      ).run(userInfo.name, existing.id)
    }
    if (userInfo?.avatar !== undefined) {
      db.prepare(
        "UPDATE users SET avatar = ?, updated_at = datetime('now','+8 hours') WHERE id = ?"
      ).run(userInfo.avatar, existing.id)
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as User
    writeLog({
      actorId: updated.id,
      action: 'user.login',
      entity: 'user',
      entityId: updated.id,
    })
    return updated
  }

  const count = (
    db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  ).c
  const role: Role = count === 0 ? 'admin' : 'viewer'
  const result = db
    .prepare('INSERT INTO users (openid, name, role, avatar) VALUES (?, ?, ?, ?)')
    .run(openid, userInfo?.name || openid, role, userInfo?.avatar ?? null)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User
  writeLog({
    actorId: user.id,
    action: 'user.register',
    entity: 'user',
    entityId: user.id,
    after: { role },
  })
  return user
}

interface DevLoginOptions {
  openid?: string
  name?: string
  role?: Role
  /** V-3 安全修复：test 环境下显式 opt-in 才能覆盖 role
   * - 默认 false：role 参数被忽略，使用"首用户 admin、其余 viewer"逻辑
   * - true：信任调用方传入的 role（仅供测试/初始化使用）
   * - dev 环境永远忽略 role（强制 viewer，不受此参数影响）
   */
  allowRoleOverride?: boolean
}

/**
 * 开发环境登录：仅在 development/test 环境可用
 * - 默认 openid='dev-openid', name='开发者'
 * - P0-2: development 环境首用户为 admin，已存在用户保留原角色（不降级）
 * - V-3: test 环境下，role 覆盖需 allowRoleOverride=true 显式 opt-in
 */
export function devLogin(opts?: DevLoginOptions): User {
  // P0-2: 双重校验（路由层已守卫，service 层再校验一次防止绕过）
  // 允许 development 与 test 环境（Jest 默认 NODE_ENV=test，原有测试依赖 dev-login 获取 token）
  if (config.nodeEnv !== 'development' && config.nodeEnv !== 'test') {
    throw new Error('dev-login disabled in production')
  }

  const openid = opts?.openid || 'dev-openid'
  const name = opts?.name || '开发者'
  // P0-2: development 环境首用户为 admin，已存在用户保留原角色
  // test 环境例外：
  //   - V-3 修复：role 覆盖需 allowRoleOverride=true 显式 opt-in
  //   - 显式 opt-in 时使用该 role（便于测试权限控制）
  //   - 未 opt-in 时保留"首用户 admin、其余 viewer"的旧行为（兼容原有测试）
  let role: Role
  if (config.nodeEnv === 'test') {
    if (opts?.allowRoleOverride && opts?.role) {
      role = opts.role
    } else {
      const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
      role = count === 0 ? 'admin' : 'viewer'
    }
  } else {
    // development 环境：首用户 admin，已存在用户不降级
    const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
    role = count === 0 ? 'admin' : 'viewer'
  }

  const existing = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid) as
    | User
    | undefined

  if (existing) {
    db.prepare(
      "UPDATE users SET name = ?, updated_at = datetime('now','+8 hours') WHERE id = ?"
    ).run(name, existing.id)

    // 不降级已存在的用户角色（保留手动在 DB 中提升的 admin 权限）
    const effectiveRole = existing.role
    if (config.nodeEnv === 'test' && opts?.allowRoleOverride && opts?.role && opts.role !== existing.role) {
      db.prepare(
        "UPDATE users SET role = ?, updated_at = datetime('now','+8 hours') WHERE id = ?"
      ).run(opts.role, existing.id)
      writeLog({
        actorId: existing.id,
        action: 'role.change',
        entity: 'user',
        entityId: existing.id,
        before: { role: existing.role },
        after: { role: opts.role },
      })
    }

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as User
    writeLog({
      actorId: updated.id,
      action: 'user.login',
      entity: 'user',
      entityId: updated.id,
    })
    return updated
  }

  const result = db
    .prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)')
    .run(openid, name, role)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User
  writeLog({
    actorId: user.id,
    action: 'user.register',
    entity: 'user',
    entityId: user.id,
    after: { role },
  })
  return user
}

export default { loginOrRegister, devLogin }