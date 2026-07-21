process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import { resetDatabase } from '../src/db/seed'
import db from '../src/db'

let adminToken: string
let editorToken: string
let viewerToken: string
let editorId: number
let equipmentName: string

beforeEach(async () => {
  resetDatabase()
  const admin = await request(app).post('/api/auth/dev-login?override=true').send({})
  adminToken = admin.body.data.token
  const editor = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'e1', name: 'Editor', role: 'editor' })
  editorToken = editor.body.data.token
  const me = await request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${editorToken}`)
  editorId = me.body.data.id
  const viewer = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'v1', name: 'Viewer', role: 'viewer' })
  viewerToken = viewer.body.data.token
  const eqList = await request(app)
    .get('/api/equipments')
    .set('Authorization', `Bearer ${adminToken}`)
  equipmentName = eqList.body.data?.list?.[0]?.name || eqList.body.data?.[0]?.name || '手提式干粉灭火器'
})

describe('日志查询 API（F7）', () => {
  test('GET /api/logs 未登录 → 401', async () => {
    const res = await request(app).get('/api/logs')
    expect(res.status).toBe(401)
  })

  test('GET /api/logs 非 Admin → 403', async () => {
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(res.status).toBe(403)
  })

  test('GET /api/logs Admin → 返回分页列表', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.list)).toBe(true)
    expect(typeof res.body.data.total).toBe('number')
    expect(res.body.data.page).toBe(1)
    expect(res.body.data.pageSize).toBe(20)
  })

  test('GET /api/logs?actor_id=xxx → 按操作人筛选', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const res = await request(app)
      .get(`/api/logs?actor_id=${editorId}&action=record.create`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
    expect(
      res.body.data.list.every((l: any) => l.actor_id === editorId)
    ).toBe(true)
  })

  test('GET /api/logs?action=record.create → 按 action 筛选', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const res = await request(app)
      .get('/api/logs?action=record.create')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
    expect(
      res.body.data.list.every((l: any) => l.action === 'record.create')
    ).toBe(true)
  })

  test('GET /api/logs/stats → 返回统计', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const res = await request(app)
      .get('/api/logs/stats')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(typeof res.body.data.total).toBe('number')
    expect(typeof res.body.data.today).toBe('number')
    expect(Array.isArray(res.body.data.by_action)).toBe(true)
    expect(res.body.data.total).toBeGreaterThan(0)
  })

  test('GET /api/logs/:id → 返回单条日志', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const list = await request(app)
      .get('/api/logs?action=record.create')
      .set('Authorization', `Bearer ${adminToken}`)
    const id = list.body.data.list[0].id
    const res = await request(app)
      .get(`/api/logs/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(id)
    expect(res.body.data.action).toBe('record.create')
  })

  test('GET /api/logs/:id 不存在 → 404', async () => {
    const res = await request(app)
      .get('/api/logs/999999')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })

  test('创建记录后 logs 表有 record.create 日志（触发器链路）', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const log = db
      .prepare("SELECT * FROM logs WHERE action = 'record.create'")
      .get()
    expect(log).toBeTruthy()
  })

  test('尝试 UPDATE logs → 失败（不可篡改）', async () => {
    db.prepare('INSERT INTO logs (action, entity) VALUES (?, ?)').run(
      'test',
      'test'
    )
    expect(() => {
      db.prepare('UPDATE logs SET action = ? WHERE id = ?').run('hacked', 1)
    }).toThrow(/append-only|forbidden/i)
  })

  test('尝试 DELETE logs → 失败（不可篡改）', async () => {
    db.prepare('INSERT INTO logs (action, entity) VALUES (?, ?)').run(
      'test2',
      'test'
    )
    const id = (
      db
        .prepare("SELECT id FROM logs WHERE action = 'test2' LIMIT 1")
        .get() as { id: number }
    ).id
    expect(() => {
      db.prepare('DELETE FROM logs WHERE id = ?').run(id)
    }).toThrow(/append-only|forbidden/i)
  })

  test('GET /api/logs?entity=record → 按 entity 筛选', async () => {
    await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'out', quantity: 2 })
    const res = await request(app)
      .get('/api/logs?entity=record&action=record.create')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(
      res.body.data.list.every((l: any) => l.entity === 'record')
    ).toBe(true)
  })
})
