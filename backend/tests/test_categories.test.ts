process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import db from '../src/db'
import { resetDatabase } from '../src/db/seed'

let adminToken: string
let editorToken: string
let viewerToken: string

beforeEach(async () => {
  resetDatabase()
  const admin = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'a1', name: 'Admin', role: 'admin' })
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

function getCatId(code: string): number {
  const row = db.prepare('SELECT id FROM categories WHERE code = ?').get(code) as
    | { id: number }
    | undefined
  if (!row) throw new Error(`分类 ${code} 不存在`)
  return row.id
}

describe('器材分类 Task 6', () => {
  test('1. GET /api/categories 返回完整树（带 children 嵌套）', async () => {
    const res = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    const tree = res.body.data
    expect(Array.isArray(tree)).toBe(true)
    // 5 大类
    expect(tree).toHaveLength(5)
    // 灭火器类应有 5 个子类
    const extinguisher = tree.find(
      (c: { code: string }) => c.code === 'EXTINGUISHER'
    )
    expect(extinguisher).toBeDefined()
    expect(Array.isArray(extinguisher.children)).toBe(true)
    expect(extinguisher.children).toHaveLength(5)
    // 子类不应带 children 字段（叶子节点）
    const powder = extinguisher.children.find(
      (c: { code: string }) => c.code === 'PORTABLE_POWDER'
    )
    expect(powder).toBeDefined()
    expect(powder.children).toBeUndefined()
  })

  test('2. GET /api/categories/flat 返回扁平列表', async () => {
    const res = await request(app)
      .get('/api/categories/flat')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(Array.isArray(res.body.data)).toBe(true)
    // 5 大类 + 20 子类 = 25
    expect(res.body.data).toHaveLength(25)
    // 不应有 children 字段
    expect(res.body.data[0].children).toBeUndefined()
  })

  test('3. POST /api/categories/auto-suggest 命中灭火器关键词（confidence >= 0.5）', async () => {
    const res = await request(app)
      .post('/api/categories/auto-suggest')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ description: '手提式干粉灭火器 ABC 磷酸铵盐' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    const data = res.body.data
    expect(Array.isArray(data.suggestions)).toBe(true)
    expect(data.suggestions.length).toBeGreaterThan(0)
    // 最高置信度应 >= 0.5
    expect(data.suggestions[0].confidence).toBeGreaterThanOrEqual(0.5)
    // 命中的应是干粉灭火器子类
    expect(data.suggestions[0].category_name).toContain('干粉')
    expect(data.suggestions[0]).toHaveProperty('reason')
    expect(data.suggestions[0]).toHaveProperty('category_id')
    expect(data.suggestions[0]).toHaveProperty('category_name')
  })

  test('4. POST /api/categories/auto-suggest 无关键词命中 → fallback: manual', async () => {
    const res = await request(app)
      .post('/api/categories/auto-suggest')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ description: '一个不知名的东西XYZ12345' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    const data = res.body.data
    expect(data.suggestions).toHaveLength(0)
    expect(data.fallback).toBe('manual')
  })

  test('5. POST /api/categories（Admin 创建成功 + 写日志）', async () => {
    const parentId = getCatId('EXTINGUISHER')
    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '新型灭火器',
        code: 'NEW_EXTINGUISHER',
        parent_id: parentId,
        level: 2,
      })
    expect(res.status).toBe(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.name).toBe('新型灭火器')
    expect(res.body.data.code).toBe('NEW_EXTINGUISHER')
    expect(res.body.data.parent_id).toBe(parentId)
    // 验证日志写入
    const logs = db
      .prepare(
        "SELECT * FROM logs WHERE action = 'category.create' AND entity = 'category'"
      )
      .all() as { id: number }[]
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  test('6. PATCH /api/categories/:id（Admin 修改 + 写日志）', async () => {
    const id = getCatId('FIRE_SEPARATION')
    const res = await request(app)
      .patch(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '防火分隔设施（修订）' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.name).toBe('防火分隔设施（修订）')
    // 验证日志写入
    const logs = db
      .prepare(
        "SELECT * FROM logs WHERE action = 'category.update' AND entity = 'category' AND entity_id = ?"
      )
      .all(id) as { id: number }[]
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  test('7. DELETE /api/categories/:id（无子节点无器材关联 → 删除成功）', async () => {
    // FIRE_SEPARATION 无子节点、无器材关联
    const id = getCatId('FIRE_SEPARATION')
    const res = await request(app)
      .delete(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    // 验证已删除
    const row = db.prepare('SELECT id FROM categories WHERE id = ?').get(id)
    expect(row).toBeUndefined()
    // 验证日志写入
    const logs = db
      .prepare(
        "SELECT * FROM logs WHERE action = 'category.delete' AND entity = 'category' AND entity_id = ?"
      )
      .all(id) as { id: number }[]
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  test('8. DELETE /api/categories/:id（有子节点 → 400 错误）', async () => {
    // EXTINGUISHER 有 5 个子节点
    const id = getCatId('EXTINGUISHER')
    const res = await request(app)
      .delete(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
    expect(res.body.message).toContain('子分类')
  })

  test('9. 非 Admin 调写接口 → 403', async () => {
    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ name: '尝试创建', code: 'TRY_CREATE', parent_id: null, level: 1 })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe(403)
  })

  test('10. 未登录调用 → 401', async () => {
    const res = await request(app)
      .post('/api/categories')
      .send({ name: '匿名创建', code: 'ANON', parent_id: null, level: 1 })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe(401)
  })
})
