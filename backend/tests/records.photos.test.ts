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

describe('PUT /api/records/:id/photos (replacePhotos)', () => {
  test('未登录返回 401', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app).put(`/api/records/${recordId}/photos`).send({ photos: [] })
    expect(res.status).toBe(401)
  })

  test('viewer 返回 403', async () => {
    const editor = createUser('editor')
    const viewer = createUser('viewer')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ photos: [{ url: '/uploads/a.png', kind: 'product' }] })
    expect(res.status).toBe(403)
  })

  test('editor 替换照片成功（先有 2 张，替换为 1 张）', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    // 先插入 2 张
    insertPhoto(recordId, '/uploads/old1.png', 'product')
    insertPhoto(recordId, '/uploads/old2.png', 'product')
    // 替换为 1 张
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [{ url: '/uploads/new.png', kind: 'product' }] })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.list).toHaveLength(1)
    expect(res.body.data.list[0].url).toBe('/uploads/new.png')

    // 旧照片应被删除
    const photos = db
      .prepare('SELECT * FROM record_photos WHERE record_id = ?')
      .all(recordId) as Array<{ url: string }>
    expect(photos).toHaveLength(1)
    expect(photos[0].url).toBe('/uploads/new.png')
  })

  test('空数组清空所有照片', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    insertPhoto(recordId, '/uploads/keep1.png', 'product')
    insertPhoto(recordId, '/uploads/keep2.png', 'location')

    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [] })
    expect(res.status).toBe(200)
    expect(res.body.data.list).toHaveLength(0)

    const photos = db
      .prepare('SELECT * FROM record_photos WHERE record_id = ?')
      .all(recordId)
    expect(photos).toHaveLength(0)
  })

  test('photos 非数组返回 400', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: 'not-an-array' })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('数组')
  })

  test('超过 PHOTO_LIMIT(3) 返回 400', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        photos: [
          { url: '/uploads/1.png', kind: 'product' },
          { url: '/uploads/2.png', kind: 'product' },
          { url: '/uploads/3.png', kind: 'product' },
          { url: '/uploads/4.png', kind: 'product' },
        ],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('上限')
  })

  test('kind 非法返回 400', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [{ url: '/uploads/x.png', kind: 'invalid-kind' }] })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('kind')
  })

  test('url 为空返回 400', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [{ url: '', kind: 'product' }] })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('url')
  })

  test('不存在的 record 返回 404', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .put('/api/records/99999/photos')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [{ url: '/uploads/a.png', kind: 'product' }] })
    expect(res.status).toBe(404)
    expect(res.body.message).toContain('不存在')
  })

  test('非法 record id 返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .put('/api/records/abc/photos')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [] })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('非法')
  })

  test('超过 VIDEO_LIMIT(1) 返回 400', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        photos: [
          { url: '/uploads/v1.mp4', kind: 'video' },
          { url: '/uploads/v2.mp4', kind: 'video' },
        ],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('视频')
  })

  test('3 张图片 + 1 个视频（未超限）替换成功', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        photos: [
          { url: '/uploads/p1.png', kind: 'product' },
          { url: '/uploads/p2.png', kind: 'location' },
          { url: '/uploads/p3.png', kind: 'annotated' },
          { url: '/uploads/v.mp4', kind: 'video' },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.list).toHaveLength(4)
  })

  test('替换照片写 record.replace_photos 日志', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [{ url: '/uploads/log.png', kind: 'product' }] })
    const logs = db
      .prepare("SELECT * FROM logs WHERE action = 'record.replace_photos' AND entity_id = ?")
      .all(recordId) as Array<{ after_json: string | null }>
    expect(logs.length).toBe(1)
    const after = logs[0].after_json ? JSON.parse(logs[0].after_json) : null
    expect(after.count).toBe(1)
  })

  test('响应结构包含 code/message/data.list', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ photos: [{ url: '/uploads/struct.png', kind: 'product' }] })
    expect(res.body).toHaveProperty('code')
    expect(res.body).toHaveProperty('message')
    expect(res.body.data).toHaveProperty('list')
  })

  test('annotation_json 字段透传保存', async () => {
    const editor = createUser('editor')
    const recordId = createRecord(editor.id)
    const annotation = JSON.stringify({ marks: [{ x: 10, y: 20 }] })
    const res = await request(app)
      .put(`/api/records/${recordId}/photos`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        photos: [
          { url: '/uploads/anno.png', kind: 'annotated', annotation_json: annotation },
        ],
      })
    expect(res.status).toBe(200)
    const photo = db
      .prepare('SELECT annotation_json FROM record_photos WHERE record_id = ?')
      .get(recordId) as { annotation_json: string | null }
    expect(photo.annotation_json).toBe(annotation)
  })
})