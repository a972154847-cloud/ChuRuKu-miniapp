process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import { resetDatabase } from '../src/db/seed'
import db from '../src/db'

let adminToken: string
let editorToken: string
let viewerToken: string
let equipmentName: string
let powderCategoryId: number

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

  const eqList = await request(app)
    .get('/api/equipments')
    .set('Authorization', `Bearer ${adminToken}`)
  equipmentName = eqList.body.data?.list?.[0]?.name || eqList.body.data?.[0]?.name || '手提式干粉灭火器'

  const catRow = db
    .prepare("SELECT id FROM categories WHERE code = 'PORTABLE_POWDER'")
    .get() as { id: number } | undefined
  powderCategoryId = catRow?.id ?? 1
})

async function createRecord(opts: {
  type?: 'in' | 'out'
  quantity?: number
} = {}): Promise<{ id: number; operator_id: number }> {
  const res = await request(app)
    .post('/api/records')
    .set('Authorization', `Bearer ${editorToken}`)
    .send({
      equipment_name: equipmentName,
      type: opts.type || 'in',
      quantity: opts.quantity ?? 5,
    })
  return { id: res.body.data.id, operator_id: res.body.data.operator_id }
}

describe('Task 9: 记录列表筛选与详情', () => {
  test('1. GET /api/records?type=in 只返回入库记录', async () => {
    await createRecord({ type: 'in' })
    await createRecord({ type: 'out' })
    const res = await request(app)
      .get('/api/records?type=in')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
    expect(res.body.data.list.every((r: any) => r.type === 'in')).toBe(true)
  })

  test('2. GET /api/records?type=out 只返回出库记录', async () => {
    await createRecord({ type: 'in' })
    await createRecord({ type: 'out' })
    const res = await request(app)
      .get('/api/records?type=out')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
    expect(res.body.data.list.every((r: any) => r.type === 'out')).toBe(true)
  })

  test('3. GET /api/records?category_id=xxx 按分类筛选（已取消分类选择，返回空）', async () => {
    await createRecord({ type: 'in' })
    const res = await request(app)
      .get(`/api/records?category_id=${powderCategoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
  })

  test('4. GET /api/records?operator_id=xxx 按操作人筛选', async () => {
    const created = await createRecord({ type: 'in' })
    const res = await request(app)
      .get(`/api/records?operator_id=${created.operator_id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
    expect(
      res.body.data.list.every((r: any) => r.operator_id === created.operator_id)
    ).toBe(true)
  })

  test('5. GET /api/records?keyword=干粉 按器材名称模糊搜索', async () => {
    await createRecord({ type: 'in' })
    const res = await request(app)
      .get('/api/records?keyword=' + encodeURIComponent('干粉'))
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
    expect(
      res.body.data.list.every((r: any) =>
        String(r.equipment_name || '').includes('干粉')
      )
    ).toBe(true)
  })

  test('6. GET /api/records?start_date&end_date 按时间范围筛选（基于 created_at）', async () => {
    await createRecord({ type: 'in' })
    const res = await request(app)
      .get(`/api/records?start_date=${new Date().toISOString().split('T')[0]}&end_date=${new Date().toISOString().split('T')[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
  })

  test('7. GET /api/records?page=1&page_size=10 分页', async () => {
    // 创建 3 条记录
    await createRecord({ type: 'in' })
    await createRecord({ type: 'in' })
    await createRecord({ type: 'in' })
    const res = await request(app)
      .get('/api/records?page=1&page_size=2')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBe(2)
    expect(res.body.data.page).toBe(1)
    expect(res.body.data.page_size).toBe(2)
    expect(res.body.data.total).toBe(3)
  })

  test('8. GET /api/records/:id 返回完整详情（含 photos + related_logs）', async () => {
    const created = await createRecord({ type: 'in' })
    // 关联一张照片
    const up = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', Buffer.from('fake-image'), 'test.jpg')
    await request(app)
      .post(`/api/records/${created.id}/photos`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ photos: [{ url: up.body.data.url, kind: 'product' }] })

    const res = await request(app)
      .get(`/api/records/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.equipment).toBeTruthy()
    expect(res.body.data.equipment.name).toBeTruthy()
    expect(res.body.data.operator).toBeTruthy()
    expect(Array.isArray(res.body.data.photos)).toBe(true)
    expect(res.body.data.photos.length).toBe(1)
    expect(Array.isArray(res.body.data.related_logs)).toBe(true)
    expect(res.body.data.related_logs.length).toBeGreaterThanOrEqual(1)
  })

  test('9. GET /api/records/:id 不存在返回 404', async () => {
    const res = await request(app)
      .get('/api/records/99999')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })

  test('10. 验证 has_more 字段正确（total > page*page_size 时为 true）', async () => {
    await createRecord({ type: 'in' })
    await createRecord({ type: 'in' })
    await createRecord({ type: 'in' })
    // page=1, page_size=2, total=3 → has_more = 3 > 1*2 = true
    const res1 = await request(app)
      .get('/api/records?page=1&page_size=2')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res1.body.data.has_more).toBe(true)
    // page=2, page_size=2, total=3 → has_more = 3 > 2*2 = false
    const res2 = await request(app)
      .get('/api/records?page=2&page_size=2')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res2.body.data.has_more).toBe(false)
  })

  test('11. 返回结构同时含 items / page_size 别名字段（向后兼容）', async () => {
    await createRecord({ type: 'in' })
    const res = await request(app)
      .get('/api/records')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    // 旧字段
    expect(Array.isArray(res.body.data.list)).toBe(true)
    expect(res.body.data.pageSize).toBe(20)
    // 新字段（任务规范）
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(res.body.data.page_size).toBe(20)
    expect(res.body.data.has_more).toBe(false)
    // items 与 list 应为同一引用
    expect(res.body.data.items).toEqual(res.body.data.list)
  })

  test('12. related_logs 按 created_at 升序排列（create 在 update 前）', async () => {
    const created = await createRecord({ type: 'in' })
    // 触发 record.update 日志
    await request(app)
      .put(`/api/records/${created.id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ quantity: 8 })

    const res = await request(app)
      .get(`/api/records/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    const logs = res.body.data.related_logs
    expect(logs.length).toBeGreaterThanOrEqual(2)
    expect(logs[0].action).toBe('record.create')
    expect(logs[1].action).toBe('record.update')
  })

  test('13. viewer 可访问列表（权限不回归）', async () => {
    await createRecord({ type: 'in' })
    const res = await request(app)
      .get('/api/records')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.list)).toBe(true)
  })

  test('14. page_size 超过 100 被限制为 100', async () => {
    await createRecord({ type: 'in' })
    const res = await request(app)
      .get('/api/records?page_size=500')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.page_size).toBe(100)
  })
})
