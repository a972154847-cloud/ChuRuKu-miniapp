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

function createRecord(operatorId: number) {
  const eqResult = db
    .prepare('INSERT INTO equipments (name, category_id, threshold, is_active) VALUES (?, NULL, 0, 1)')
    .run(`器材-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  const recResult = db
    .prepare("INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, 'in', 1, ?)")
    .run(eqResult.lastInsertRowid, operatorId)
  return recResult.lastInsertRowid as number
}

function insertPhoto(recordId: number, url: string, kind: string = 'product') {
  const result = db
    .prepare(
      'INSERT INTO record_photos (record_id, url, kind, sort_order) VALUES (?, ?, ?, 0)'
    )
    .run(recordId, url, kind)
  return result.lastInsertRowid as number
}

describe('DELETE /api/records/:id/photos/:photoId (detachPhoto)', () => {
  test('未登录返回 401', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const photoId = insertPhoto(recordId, '/uploads/p.png')
    const res = await request(app).delete(`/api/records/${recordId}/photos/${photoId}`)
    expect(res.status).toBe(401)
  })

  test('viewer 返回 403', async () => {
    const editor = createUser('editor')
    const viewer = createUser('viewer')
    const recordId = createRecord(editor.id)
    const photoId = insertPhoto(recordId, '/uploads/p.png')
    const res = await request(app)
      .delete(`/api/records/${recordId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
    expect(res.status).toBe(403)
  })

  test('editor 删除照片成功', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const photoId = insertPhoto(recordId, '/uploads/del.png', 'product')

    const res = await request(app)
      .delete(`/api/records/${recordId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.message).toBe('ok')

    const gone = db
      .prepare('SELECT id FROM record_photos WHERE id = ?')
      .get(photoId)
    expect(gone).toBeUndefined()
  })

  test('admin 删除照片成功', async () => {
    const admin = createUser('admin')
    const recordId = createRecord(admin.id)
    const photoId = insertPhoto(recordId, '/uploads/admin-del.png', 'product')

    const res = await request(app)
      .delete(`/api/records/${recordId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
  })

  test('删除 video kind 照片成功', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const photoId = insertPhoto(recordId, '/uploads/v.mp4', 'video')

    const res = await request(app)
      .delete(`/api/records/${recordId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(200)
  })

  test('删除后其他照片仍保留', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const keepId = insertPhoto(recordId, '/uploads/keep.png', 'product')
    const delId = insertPhoto(recordId, '/uploads/del.png', 'location')

    await request(app)
      .delete(`/api/records/${recordId}/photos/${delId}`)
      .set('Authorization', `Bearer ${editor.token}`)

    const photos = db
      .prepare('SELECT * FROM record_photos WHERE record_id = ?')
      .all(recordId) as Array<{ id: number }>
    expect(photos).toHaveLength(1)
    expect(photos[0].id).toBe(keepId)
  })

  test('不存在的 photoId 返回 404', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .delete(`/api/records/${recordId}/photos/99999`)
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe(404)
    expect(res.body.message).toContain('照片不存在')
  })

  test('不存在的 recordId 返回 404', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const photoId = insertPhoto(recordId, '/uploads/x.png')
    // 用不存在的 recordId
    const res = await request(app)
      .delete(`/api/records/99999/photos/${photoId}`)
      .set('Authorization', `Bearer ${editor.token}`)
    // detachPhoto 查 photo 时同时匹配 record_id，不匹配返回"照片不存在"
    expect(res.status).toBe(404)
    expect(res.body.message).toContain('照片不存在')
  })

  test('photo 属于其他 record，删除返回 404', async () => {
    const editor = createUser('editor')
    const recordA = createRecord(editor.id)
    const recordB = createRecord(editor.id)
    const photoOfB = insertPhoto(recordB, '/uploads/b.png')
    // 用 recordA + photoOfB 删除，应 404
    const res = await request(app)
      .delete(`/api/records/${recordA}/photos/${photoOfB}`)
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(404)
  })

  test('非法 record id 返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .delete('/api/records/abc/photos/1')
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
  })

  test('非法 photoId 返回 400', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .delete(`/api/records/${recordId}/photos/xyz`)
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
  })

  test('删除照片写 record.detach_photo 日志', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const photoId = insertPhoto(recordId, '/uploads/log.png')
    await request(app)
      .delete(`/api/records/${recordId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${editor.token}`)
    const logs = db
      .prepare("SELECT * FROM logs WHERE action = 'record.detach_photo' AND entity_id = ?")
      .all(photoId) as Array<{ action: string }>
    expect(logs.length).toBe(1)
  })

  test('删除被 location 引用的 photo 不影响 record', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const photoId = insertPhoto(recordId, '/uploads/loc.png', 'location')

    const res = await request(app)
      .delete(`/api/records/${recordId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(200)

    const record = db.prepare('SELECT id FROM records WHERE id = ?').get(recordId)
    expect(record).toBeDefined()
  })
})