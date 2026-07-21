process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import type { Application } from 'express'
import type { SuperTest, Test } from 'supertest'

const { runMigrations } = require('../src/db/migrate')
runMigrations()

const app = require('../src/app').default as Application
const request = require('supertest') as (app: Application) => SuperTest<Test>
const { resetDatabase } = require('../src/db/seed') as typeof import('../src/db/seed')
const db = require('../src/db').default as typeof import('../src/db').default
const { signToken } = require('../src/middlewares/auth') as typeof import('../src/middlewares/auth')

beforeEach(() => {
  resetDatabase()
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'") } catch (e) { /* status column already exists via 008 migration */ }
})

// 模块级递增 id：避免 verifyToken 的 userCache（30s TTL）跨测试命中旧用户
// resetDatabase drop 后 AUTOINCREMENT 从 1 重新开始；若用自增 id，viewer -> editor 顺序
// 会让 editor 用户的 id 命中上一个 viewer 测试的缓存，导致 role 被错误判定为 viewer
let _userIdCounter = 1000

function createUser(role: 'admin' | 'editor' | 'viewer', name?: string) {
  const id = ++_userIdCounter
  const openid = `${role}-${id}-${Math.random().toString(36).slice(2, 8)}`
  db.prepare('INSERT INTO users (id, openid, name, role) VALUES (?, ?, ?, ?)').run(
    id,
    openid,
    name || role,
    role
  )
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as {
    id: number
    openid: string
    name: string
    role: string
    status: string
  }
  return { token: signToken(user as any), id: user.id, role, user }
}

describe('PATCH /api/users/:id/profile', () => {
  test('未登录返回 401', async () => {
    const res = await request(app).patch('/api/users/1/profile').send({ name: 'x' })
    expect(res.status).toBe(401)
  })

  test('admin 修改任意用户资料成功', async () => {
    const admin = createUser('admin')
    const viewer = createUser('viewer')
    const res = await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: '新名字', avatar: 'https://example.com/a.png' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.name).toBe('新名字')
    expect(res.body.data.avatar).toBe('https://example.com/a.png')
  })

  test('editor 也能修改他人资料（isPrivileged = admin/editor）', async () => {
    const editor = createUser('editor')
    const viewer = createUser('viewer')
    const res = await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ name: '由editor改名' })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('由editor改名')
  })

  test('viewer 修改他人资料返回 403', async () => {
    const viewer1 = createUser('viewer', 'v1')
    const viewer2 = createUser('viewer', 'v2')
    const res = await request(app)
      .patch(`/api/users/${viewer1.id}/profile`)
      .set('Authorization', `Bearer ${viewer2.token}`)
      .send({ name: '被改' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe(403)
  })

  test('viewer 修改自己资料成功', async () => {
    const viewer = createUser('viewer')
    const res = await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ name: '自查自改' })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('自查自改')
  })

  test('只更新 name，avatar 保持原值', async () => {
    const admin = createUser('admin')
    const viewer = createUser('viewer')
    // 先设置 avatar
    await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ avatar: 'https://example.com/avatar.png' })
    // 只更新 name
    const res = await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: '只改名' })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('只改名')
    expect(res.body.data.avatar).toBe('https://example.com/avatar.png')
  })

  test('name 为空字符串也能更新成功（service 未校验非空）', async () => {
    const admin = createUser('admin')
    const viewer = createUser('viewer')
    const res = await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: '' })
    // 已知行为：updateUserProfile 不校验 name 为空，直接 String('')=''
    // 待后续加固校验后需更新此测试
    expect(res.status).toBe(200)
  })

  test('不传任何字段，updateUserProfile 不更新', async () => {
    const admin = createUser('admin')
    const viewer = createUser('viewer', '原名')
    const res = await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('原名')
  })

  test('非法用户 id 返回 400', async () => {
    const admin = createUser('admin')
    const res = await request(app)
      .patch('/api/users/abc/profile')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'x' })
    expect(res.status).toBe(400)
  })

  test('不存在的用户 id 返回 400（updateUserProfile 抛 \"用户不存在\"）', async () => {
    const admin = createUser('admin')
    const res = await request(app)
      .patch('/api/users/99999/profile')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: '不存在' })
    // updateUserProfile 对不存在用户抛 Error('用户不存在')，路由 catch 返回 400
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('用户不存在')
  })

  test('avatar 为 null 时清空头像', async () => {
    const admin = createUser('admin')
    const viewer = createUser('viewer')
    // 先设置
    await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ avatar: 'https://example.com/x.png' })
    // 再清空
    const res = await request(app)
      .patch(`/api/users/${viewer.id}/profile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ avatar: null })
    expect(res.status).toBe(200)
    expect(res.body.data.avatar).toBeNull()
  })
})