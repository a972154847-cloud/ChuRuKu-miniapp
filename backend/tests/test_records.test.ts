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
})

describe('记录 CRUD', () => {
  test('创建记录成功', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 10 })
    expect(res.status).toBe(201)
    expect(res.body.data.quantity).toBe(10)
  })

  test('quantity 负数返回 400', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: -1 })
    expect(res.status).toBe(400)
  })

  test('type 非法值返回 400', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'invalid', quantity: 1 })
    expect(res.status).toBe(400)
  })

  test('equipment_name 为空返回 400', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: '', type: 'in', quantity: 1 })
    expect(res.status).toBe(400)
  })

  test('viewer 不能创建记录（403）', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 1 })
    expect(res.status).toBe(403)
  })

  test('创建记录成功后 logs 表有 record.create', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const log = db.prepare("SELECT * FROM logs WHERE action = 'record.create'").get()
    expect(log).toBeTruthy()
  })

  test('GET 列表按 type 筛选', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'out', quantity: 2 })
    const res = await request(app)
      .get('/api/records?type=in')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.every((r: any) => r.type === 'in')).toBe(true)
  })

  test('GET 详情含 equipment 和 operator', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const id = create.body.data.id
    const res = await request(app)
      .get(`/api/records/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.equipment).toBeTruthy()
    expect(res.body.data.operator).toBeTruthy()
  })

  test('PUT 更新记录成功', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const id = create.body.data.id
    const res = await request(app)
      .put(`/api/records/${id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ quantity: 8, remark: 'updated' })
    expect(res.status).toBe(200)
    expect(res.body.data.quantity).toBe(8)
    expect(res.body.data.remark).toBe('updated')
  })

  test('DELETE 记录需要 admin', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const id = create.body.data.id
    // editor 删除应 403
    const editorDel = await request(app)
      .delete(`/api/records/${id}`)
      .set('Authorization', `Bearer ${editorToken}`)
    expect(editorDel.status).toBe(403)
    // admin 删除成功
    const adminDel = await request(app)
      .delete(`/api/records/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(adminDel.status).toBe(200)
  })

  test('POST /upload 上传图片成功', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', Buffer.from('fake-image-data'), 'test.jpg')
    expect(res.status).toBe(200)
    expect(res.body.data.url).toMatch(/^\/uploads\//)
  })

  test('POST /records/:id/photos 关联照片，超过 3 张限制', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const id = create.body.data.id
    // 上传 4 张图
    const photos = []
    for (let i = 0; i < 4; i++) {
      const up = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', Buffer.from(`img-${i}`), `test-${i}.jpg`)
      photos.push({ url: up.body.data.url, kind: 'product' })
    }
    const res = await request(app)
      .post(`/api/records/${id}/photos`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ photos })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/3|超过|上限/)
  })

  test('PUT 更新记录时 equipment_name 为空返回 400', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const id = create.body.data.id
    const res = await request(app)
      .put(`/api/records/${id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: '' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/器材名称不能为空/)
  })

  test('DELETE 出库记录时记录特殊日志', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 10 })
    const createOut = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'out', quantity: 3 })
    const outId = createOut.body.data.id
    await request(app)
      .delete(`/api/records/${outId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    const log = db.prepare("SELECT * FROM logs WHERE action = 'record.delete.out'").get() as { after_json?: string } | undefined
    expect(log).toBeTruthy()
    expect(JSON.parse(log!.after_json || '{}')).toHaveProperty('new_stock')
  })

  test('创建新器材时 category_id 为 NULL', async () => {
    const newEquipmentName = '全新器材测试'
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: newEquipmentName, type: 'in', quantity: 5 })
    const eq = db.prepare('SELECT category_id FROM equipments WHERE name = ?').get(newEquipmentName) as { category_id: number | null } | undefined
    expect(eq).toBeTruthy()
    expect(eq!.category_id).toBe(null)
  })

  test('GET /records/equipment-in 返回分页数据', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 10 })
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const res = await request(app)
      .get(`/api/records/equipment-in?name=${encodeURIComponent(equipmentName)}&page=1&pageSize=1`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBe(1)
    expect(res.body.data.total).toBeGreaterThanOrEqual(2)
  })

  test('GET /records/stats 返回正确统计', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 10 })
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'out', quantity: 3 })
    const res = await request(app)
      .get('/api/records/stats')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.total_in).toBeGreaterThanOrEqual(15)
    expect(res.body.data.total_out).toBeGreaterThanOrEqual(3)
    expect(res.body.data.current_stock).toBeGreaterThanOrEqual(12)
  })
})
