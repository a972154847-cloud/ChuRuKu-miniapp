process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import { resetDatabase } from '../src/db/seed'

let adminToken: string
let editorToken: string
let viewerToken: string

beforeEach(async () => {
  resetDatabase()
  const admin = await request(app).post('/api/auth/dev-login?override=true').send({})
  adminToken = admin.body.data.token
  const editor = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'e1', name: 'Editor', role: 'editor' })
  editorToken = editor.body.data.token
  const viewer = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'v1', name: 'Viewer', role: 'viewer' })
  viewerToken = viewer.body.data.token
})

describe('器材搜索 POST /api/equipments/search', () => {
  test('未登录返回 401', async () => {
    const res = await request(app)
      .post('/api/equipments/search')
      .send({ keyword: '干粉' })
    expect(res.status).toBe(401)
  })

  test('viewer 不能搜索（403）', async () => {
    const res = await request(app)
      .post('/api/equipments/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ keyword: '干粉' })
    expect(res.status).toBe(403)
  })

  test('editor 能搜索（200）', async () => {
    const res = await request(app)
      .post('/api/equipments/search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '干粉' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(Array.isArray(res.body.data.list)).toBe(true)
  })

  test('search 命中"干粉"返回多条结果', async () => {
    const res = await request(app)
      .post('/api/equipments/search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '干粉' })
    expect(res.status).toBe(200)
    // 种子数据里有 4 条含"干粉"：2kg/4kg/8kg ABC + 推车式 25kg
    expect(res.body.data.list.length).toBeGreaterThanOrEqual(4)
    // 每条都应包含 category_name（关联分类）
    for (const item of res.body.data.list) {
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('name')
      expect(item).toHaveProperty('category_name')
      expect(item.name).toContain('干粉')
    }
  })

  test('search 同时匹配 name 和 spec', async () => {
    // spec='25kg' 命中"推车式干粉灭火器 25kg"
    const res = await request(app)
      .post('/api/equipments/search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '25kg' })
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThanOrEqual(1)
    const hasSpecMatch = res.body.data.list.some(
      (item: any) => item.spec === '25kg'
    )
    expect(hasSpecMatch).toBe(true)
  })

  test('search 无结果返回空列表', async () => {
    const res = await request(app)
      .post('/api/equipments/search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '不存在的器材XYZ' })
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBe(0)
  })

  test('search 空关键字返回空列表', async () => {
    const res = await request(app)
      .post('/api/equipments/search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '' })
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBe(0)
  })

  test('admin 也能搜索', async () => {
    const res = await request(app)
      .post('/api/equipments/search')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ keyword: '消防' })
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
  })
})

describe('GET /api/equipments 保持现状', () => {
  test('viewer 可访问 GET /', async () => {
    const res = await request(app)
      .get('/api/equipments')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('list')
    expect(res.body.data).toHaveProperty('total')
  })
})
