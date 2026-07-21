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

const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

describe('POST /api/upload/multiple', () => {
  test('未登录返回 401', async () => {
    const res = await request(app).post('/api/upload/multiple')
    expect(res.status).toBe(401)
  })

  test('viewer 上传返回 403', async () => {
    const viewer = createUser('viewer')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${viewer.token}`)
      .attach('files', PNG_BUFFER, { filename: 'a.png', contentType: 'image/png' })
    expect(res.status).toBe(403)
  })

  test('editor 上传单个图片成功', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
      .attach('files', PNG_BUFFER, { filename: 'a.png', contentType: 'image/png' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.message).toBe('ok')
    expect(Array.isArray(res.body.data.list)).toBe(true)
    expect(res.body.data.list).toHaveLength(1)
    expect(res.body.data.list[0].url).toMatch(/^\/uploads\//)
    expect(res.body.data.list[0].filename).toMatch(/\.png$/)
    expect(res.body.data.list[0].mimeType).toBe('image/png')
  })

  test('admin 上传多个图片（3 个）成功', async () => {
    const admin = createUser('admin')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${admin.token}`)
      .attach('files', PNG_BUFFER, { filename: 'a.png', contentType: 'image/png' })
      .attach('files', PNG_BUFFER, { filename: 'b.png', contentType: 'image/png' })
      .attach('files', PNG_BUFFER, { filename: 'c.png', contentType: 'image/png' })
    expect(res.status).toBe(200)
    expect(res.body.data.list).toHaveLength(3)
    // 文件名应被重命名为 UUID.ext（防伪造）
    expect(res.body.data.list[0].filename).not.toBe('a.png')
  })

  test('上传 5 个文件（上限）成功', async () => {
    const editor = createUser('editor')
    let req = request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
    for (let i = 0; i < 5; i++) {
      req = req.attach('files', PNG_BUFFER, {
        filename: `f${i}.png`,
        contentType: 'image/png',
      })
    }
    const res = await req
    expect(res.status).toBe(200)
    expect(res.body.data.list).toHaveLength(5)
  })

  test('上传超过 5 个文件触发 multer LIMIT_FILE_COUNT', async () => {
    const editor = createUser('editor')
    let req = request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
    for (let i = 0; i < 6; i++) {
      req = req.attach('files', PNG_BUFFER, {
        filename: `f${i}.png`,
        contentType: 'image/png',
      })
    }
    const res = await req
    // multer 限制：超过 maxCount 抛 LIMIT_FILE_COUNT，走 errorHandler 返回 500
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('未提供任何文件返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('未提供文件')
  })

  test('上传 .html 文件返回 500（fileFilter 抛错走 errorHandler）', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
      .attach('files', Buffer.from('<html></html>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      })
    // 已知行为：fileFilter 抛 Error，errorHandler 返回 500 + message
    // 待 P0-5 加固（返回 400）后需更新此测试
    expect(res.status).toBe(500)
    expect(res.body.message).toContain('不支持的文件类型')
  })

  test('上传 mimetype 伪造的文件（.png 扩展名但 image/jpeg）通过双重校验', async () => {
    const editor = createUser('editor')
    // mimetype=image/jpeg 但扩展名 .png，MIME_TO_EXT 映射后文件名为 .jpg
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
      .attach('files', PNG_BUFFER, {
        filename: 'forged.png',
        contentType: 'image/jpeg',
      })
    expect(res.status).toBe(200)
    // 文件名根据 mimetype 重命名为 .jpg
    expect(res.body.data.list[0].filename).toMatch(/\.jpg$/)
    expect(res.body.data.list[0].mimeType).toBe('image/jpeg')
  })

  test('上传视频 mp4 成功', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
      .attach('files', Buffer.from('fake-mp4'), {
        filename: 'v.mp4',
        contentType: 'video/mp4',
      })
    expect(res.status).toBe(200)
    expect(res.body.data.list[0].mimeType).toBe('video/mp4')
    expect(res.body.data.list[0].filename).toMatch(/\.mp4$/)
  })

  test('响应结构包含 code/message/data.list', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
      .attach('files', PNG_BUFFER, { filename: 'a.png', contentType: 'image/png' })
    expect(res.body).toHaveProperty('code')
    expect(res.body).toHaveProperty('message')
    expect(res.body.data).toHaveProperty('list')
  })

  test('字段名错误（file 而非 files）抛 MulterError 由 errorHandler 处理为 500', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/upload/multiple')
      .set('Authorization', `Bearer ${editor.token}`)
      .attach('file', PNG_BUFFER, { filename: 'a.png', contentType: 'image/png' })
    // upload.array('files', 5) 收到错误字段名时抛 MulterError: Unexpected field
    // 路由未捕获，由 errorHandler 处理，dev 环境返回 500 + err.message
    expect(res.status).toBe(500)
    expect(res.body.message).toContain('Unexpected field')
  })
})