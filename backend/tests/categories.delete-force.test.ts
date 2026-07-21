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

function createCategory(code: string, parentId: number | null = null, level: number = 1) {
  const result = db
    .prepare('INSERT INTO categories (parent_id, code, name, level) VALUES (?, ?, ?, ?)')
    .run(parentId, code, `分类-${code}`, level)
  return result.lastInsertRowid as number
}

function createEquipment(name: string, categoryId: number | null = null) {
  const result = db
    .prepare('INSERT INTO equipments (name, category_id, threshold, is_active) VALUES (?, ?, 0, 1)')
    .run(name, categoryId)
  return result.lastInsertRowid as number
}

describe('DELETE /api/categories/:id (force=true 解除器材关联)', () => {
  test('未登录返回 401', async () => {
    const catId = createCategory('LEAF_1')
    const res = await request(app).delete(`/api/categories/${catId}`)
    expect(res.status).toBe(401)
  })

  test('viewer 删除返回 403', async () => {
    const viewer = createUser('viewer')
    const catId = createCategory('LEAF_2')
    const res = await request(app)
      .delete(`/api/categories/${catId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
    expect(res.status).toBe(403)
  })

  test('editor 删除返回 403（仅 admin 可删除）', async () => {
    const editor = createUser('editor')
    const catId = createCategory('LEAF_3')
    const res = await request(app)
      .delete(`/api/categories/${catId}`)
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(403)
  })

  test('无关联器材的叶子分类，无 force 删除成功', async () => {
    const admin = createUser('admin')
    const catId = createCategory('LEAF_NO_EQ_1')
    const res = await request(app)
      .delete(`/api/categories/${catId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.message).toBe('ok')

    const gone = db.prepare('SELECT id FROM categories WHERE id = ?').get(catId)
    expect(gone).toBeUndefined()
  })

  test('有关联器材，无 force 返回 400 + has_equipments: true', async () => {
    const admin = createUser('admin')
    const catId = createCategory('LEAF_WITH_EQ_1')
    createEquipment('器材-A', catId)
    const res = await request(app)
      .delete(`/api/categories/${catId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
    expect(res.body.has_equipments).toBe(true)
    expect(res.body.message).toContain('关联器材')

    // 分类仍存在
    const stillThere = db.prepare('SELECT id FROM categories WHERE id = ?').get(catId)
    expect(stillThere).toBeDefined()
  })

  test('有关联器材，force=true 删除成功且器材 category_id 被置为 NULL', async () => {
    const admin = createUser('admin')
    const catId = createCategory('LEAF_FORCE_1')
    const eqId = createEquipment('器材-B', catId)

    const res = await request(app)
      .delete(`/api/categories/${catId}?force=true`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)

    // 分类已删除
    const gone = db.prepare('SELECT id FROM categories WHERE id = ?').get(catId)
    expect(gone).toBeUndefined()

    // 器材仍存在，category_id=NULL
    const eq = db.prepare('SELECT id, name, category_id FROM equipments WHERE id = ?').get(eqId) as {
      id: number
      name: string
      category_id: number | null
    }
    expect(eq).toBeDefined()
    expect(eq.category_id).toBeNull()
  })

  test('force=true 删除写日志，after 记录 unlinked_equipments', async () => {
    const admin = createUser('admin')
    const catId = createCategory('LEAF_FORCE_LOG')
    createEquipment('器材-C1', catId)
    createEquipment('器材-C2', catId)
    createEquipment('器材-C3', catId)

    await request(app)
      .delete(`/api/categories/${catId}?force=true`)
      .set('Authorization', `Bearer ${admin.token}`)

    const logs = db
      .prepare("SELECT * FROM logs WHERE action = 'category.delete' AND entity_id = ?")
      .all(catId) as Array<{ after_json: string | null }>
    expect(logs.length).toBe(1)
    const after = logs[0].after_json ? JSON.parse(logs[0].after_json) : null
    expect(after).toBeTruthy()
    expect(after.force).toBe(true)
    expect(after.unlinked_equipments).toBe(3)
  })

  test('force=false 显式传参与默认行为一致（有关联器材仍返回 400）', async () => {
    const admin = createUser('admin')
    const catId = createCategory('LEAF_FORCE_FALSE')
    createEquipment('器材-D', catId)
    const res = await request(app)
      .delete(`/api/categories/${catId}?force=false`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(400)
    expect(res.body.has_equipments).toBe(true)
  })

  test('有子分类，force=true 仍返回 400（子分类检查在器材检查前）', async () => {
    const admin = createUser('admin')
    const parentId = createCategory('PARENT_WITH_CHILD')
    createCategory('CHILD_1', parentId, 2)

    const res = await request(app)
      .delete(`/api/categories/${parentId}?force=true`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('子分类')
    expect(res.body.has_equipments).toBeUndefined()

    // 父分类仍存在
    const stillThere = db.prepare('SELECT id FROM categories WHERE id = ?').get(parentId)
    expect(stillThere).toBeDefined()
  })

  test('不存在的分类返回 404', async () => {
    const admin = createUser('admin')
    const res = await request(app)
      .delete('/api/categories/99999')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe(404)
    expect(res.body.message).toContain('不存在')
  })

  test('非法 id 格式返回 400', async () => {
    const admin = createUser('admin')
    const res = await request(app)
      .delete('/api/categories/abc')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
    expect(res.body.message).toContain('非法')
  })

  test('force 参数大小写不敏感（TRUE 也生效）', async () => {
    const admin = createUser('admin')
    const catId = createCategory('LEAF_FORCE_UPPER')
    createEquipment('器材-E', catId)
    const res = await request(app)
      .delete(`/api/categories/${catId}?force=TRUE`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
  })

  test('force 参数为非 true 字符串（如 1）不生效', async () => {
    const admin = createUser('admin')
    const catId = createCategory('LEAF_FORCE_ONE')
    createEquipment('器材-F', catId)
    const res = await request(app)
      .delete(`/api/categories/${catId}?force=1`)
      .set('Authorization', `Bearer ${admin.token}`)
    // 仅 'true'（大小写不敏感）触发 force
    expect(res.status).toBe(400)
    expect(res.body.has_equipments).toBe(true)
  })
})