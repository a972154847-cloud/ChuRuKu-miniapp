process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import { resetDatabase } from '../src/db/seed'
import db from '../src/db'

/**
 * Task 10.2: 后端集成测试（Supertest）
 * 完整出入库流程串联 + 权限全链路 + 通知触发不阻塞 + 日志写入验证 + AI 降级链集成
 *
 * 测试隔离：每个用例前 resetDatabase() 重建 :memory: 库 + 重新迁移 + 种子数据
 */
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

/** =========================================================================
 * 场景 1: 完整出入库流程串联
 * ========================================================================= */
describe('场景 1: 完整出入库流程串联', () => {
  test('入库 + 出库 + 列表 + 详情，全程贯通', async () => {
    // 1.1 入库记录
    const inRes = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 10 })
    expect(inRes.status).toBe(201)
    expect(inRes.body.data.quantity).toBe(10)
    expect(inRes.body.data.type).toBe('in')
    // logs 应有 record.create
    const inLog = db
      .prepare("SELECT * FROM logs WHERE action = 'record.create' AND entity_id = ?")
      .get(inRes.body.data.id)
    expect(inLog).toBeTruthy()

    // 1.2 出库记录
    const outRes = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'out', quantity: 3 })
    expect(outRes.status).toBe(201)
    expect(outRes.body.data.quantity).toBe(3)
    expect(outRes.body.data.type).toBe('out')
    const outLog = db
      .prepare("SELECT * FROM logs WHERE action = 'record.create' AND entity_id = ?")
      .get(outRes.body.data.id)
    expect(outLog).toBeTruthy()

    // 1.3 查询记录列表（应至少 2 条）
    const listRes = await request(app)
      .get('/api/records')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(listRes.status).toBe(200)
    expect(listRes.body.data.total).toBeGreaterThanOrEqual(2)
    expect(listRes.body.data.list.length).toBeGreaterThanOrEqual(2)

    // 1.4 查询详情（含 photos + related_logs）
    const detailRes = await request(app)
      .get(`/api/records/${inRes.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(detailRes.status).toBe(200)
    expect(detailRes.body.data.id).toBe(inRes.body.data.id)
    // 详情应含 equipment / operator
    expect(detailRes.body.data.equipment).toBeTruthy()
    expect(detailRes.body.data.equipment.name).toBe(equipmentName)
    expect(detailRes.body.data.operator).toBeTruthy()
    expect(detailRes.body.data.operator.id).toBe(inRes.body.data.operator_id)
    // 详情应含 photos 数组（即使空也是数组）
    expect(Array.isArray(detailRes.body.data.photos)).toBe(true)
    // 详情应含 related_logs 时间线，至少有 record.create
    expect(Array.isArray(detailRes.body.data.related_logs)).toBe(true)
    expect(detailRes.body.data.related_logs.length).toBeGreaterThanOrEqual(1)
    const hasCreateLog = detailRes.body.data.related_logs.some(
      (l: { action: string }) => l.action === 'record.create'
    )
    expect(hasCreateLog).toBe(true)
  })

  test('详情 related_logs 按 created_at 升序（create 在 update 前）', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    await request(app)
      .put(`/api/records/${create.body.data.id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ quantity: 8 })

    const res = await request(app)
      .get(`/api/records/${create.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    const logs = res.body.data.related_logs
    expect(logs.length).toBeGreaterThanOrEqual(2)
    expect(logs[0].action).toBe('record.create')
    expect(logs[1].action).toBe('record.update')
  })
})

/** =========================================================================
 * 场景 2: 权限全链路（admin/editor/viewer/无 token）
 * ========================================================================= */
describe('场景 2: 权限全链路', () => {
  test('admin 可创建记录', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 1 })
    expect(res.status).toBe(201)
  })

  test('editor 可创建记录', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 1 })
    expect(res.status).toBe(201)
  })

  test('viewer 创建记录返回 403', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 1 })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe(403)
  })

  test('无 token 创建记录返回 401', async () => {
    const res = await request(app)
      .post('/api/records')
      .send({ equipment_name: equipmentName, type: 'in', quantity: 1 })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe(401)
  })

  test('editor 不能删除记录（403），admin 可以删除（200）', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 1 })
    const id = create.body.data.id
    const editorDel = await request(app)
      .delete(`/api/records/${id}`)
      .set('Authorization', `Bearer ${editorToken}`)
    expect(editorDel.status).toBe(403)
    const adminDel = await request(app)
      .delete(`/api/records/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(adminDel.status).toBe(200)
  })
})

/** =========================================================================
 * 场景 3: 通知触发不阻塞
 * ========================================================================= */
describe('场景 3: 通知触发不阻塞', () => {
  test('创建记录 API 响应时间 < 1s（通知异步不阻塞）', async () => {
    const start = Date.now()
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const elapsed = Date.now() - start
    expect(res.status).toBe(201)
    // 通知服务未配置 wxAppId 时也不应阻塞主流程
    expect(elapsed).toBeLessThan(1000)
  })

  test('通知服务未配置 wxAppId 时记录创建仍成功', async () => {
    // 即使环境无 wxAppId（测试环境默认无），notifyRecordEvent 内部 catch 后 void
    // 记录创建不应受影响
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 2 })
    expect(res.status).toBe(201)
    expect(res.body.data.id).toBeGreaterThan(0)
    const row = db
      .prepare('SELECT * FROM records WHERE id = ?')
      .get(res.body.data.id)
    expect(row).toBeTruthy()
  })

  test('更新记录（quantity 变更触发通知）也不阻塞', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const start = Date.now()
    const res = await request(app)
      .put(`/api/records/${create.body.data.id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ quantity: 8 })
    const elapsed = Date.now() - start
    expect(res.status).toBe(200)
    expect(elapsed).toBeLessThan(1000)
    expect(res.body.data.quantity).toBe(8)
  })
})

/** =========================================================================
 * 场景 4: 日志写入验证（create/update/delete + 不可篡改）
 * ========================================================================= */
describe('场景 4: 日志写入验证', () => {
  test('创建记录 → logs 表有 record.create 日志', async () => {
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    const log = db
      .prepare(
        "SELECT * FROM logs WHERE action = 'record.create' AND entity_id = ? AND entity = 'record'"
      )
      .get(res.body.data.id) as
      | { action: string; entity: string; entity_id: number; after_json: string | null }
      | undefined
    expect(log).toBeTruthy()
    expect(log!.entity).toBe('record')
    expect(log!.entity_id).toBe(res.body.data.id)
    // after_json 应包含记录内容
    expect(log!.after_json).toBeTruthy()
    expect(log!.after_json).toContain('"quantity":5')
  })

  test('修改记录 → logs 表有 record.update 日志（含 before/after）', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    await request(app)
      .put(`/api/records/${create.body.data.id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ quantity: 8, remark: 'updated' })

    const log = db
      .prepare(
        "SELECT * FROM logs WHERE action = 'record.update' AND entity_id = ?"
      )
      .get(create.body.data.id) as
      | { action: string; before_json: string | null; after_json: string | null }
      | undefined
    expect(log).toBeTruthy()
    expect(log!.before_json).toContain('"quantity":5')
    expect(log!.after_json).toContain('"quantity":8')
  })

  test('删除记录 → logs 表有 record.delete 日志（含 before）', async () => {
    const create = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ equipment_name: equipmentName, type: 'in', quantity: 5 })
    await request(app)
      .delete(`/api/records/${create.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const log = db
      .prepare(
        "SELECT * FROM logs WHERE action = 'record.delete' AND entity_id = ?"
      )
      .get(create.body.data.id) as
      | { action: string; before_json: string | null }
      | undefined
    expect(log).toBeTruthy()
    expect(log!.before_json).toContain('"quantity":5')
  })

  test('尝试 UPDATE logs → 失败（append-only 触发器）', async () => {
    db.prepare('INSERT INTO logs (action, entity) VALUES (?, ?)').run(
      'integration_test',
      'test'
    )
    expect(() => {
      db.prepare('UPDATE logs SET action = ? WHERE action = ?').run(
        'hacked',
        'integration_test'
      )
    }).toThrow(/append-only|forbidden/i)
  })

  test('尝试 DELETE logs → 失败（append-only 触发器）', async () => {
    db.prepare('INSERT INTO logs (action, entity) VALUES (?, ?)').run(
      'integration_test_del',
      'test'
    )
    const id = (
      db
        .prepare("SELECT id FROM logs WHERE action = 'integration_test_del' LIMIT 1")
        .get() as { id: number }
    ).id
    expect(() => {
      db.prepare('DELETE FROM logs WHERE id = ?').run(id)
    }).toThrow(/append-only|forbidden/i)
  })
})

/** =========================================================================
 * 场景 5: AI 降级链集成
 * ========================================================================= */
describe('场景 5: AI 降级链集成', () => {
  test('POST /api/ai/recognize 带 query 自动降级到 text stage', async () => {
    // 测试环境无 AI API Key、无 embedding 模型，应自动降级到 text stage
    const res = await request(app)
      .post('/api/ai/recognize')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ query: '干粉' })
    expect(res.status).toBe(200)
    expect(res.body.data.stage).toBe('text')
    expect(Array.isArray(res.body.data.matches)).toBe(true)
    expect(res.body.data.matches.length).toBeGreaterThan(0)
    // text stage 匹配应包含"干粉"
    expect(res.body.data.matches[0].name).toContain('干粉')
  })

  test('POST /api/ai/text-search 返回匹配器材', async () => {
    const res = await request(app)
      .post('/api/ai/text-search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '灭火器' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.matches)).toBe(true)
    expect(res.body.data.matches.length).toBeGreaterThan(0)
    // 灭火器类器材应被匹配
    const names = res.body.data.matches.map((m: { name: string }) => m.name)
    expect(names.some((n: string) => n.includes('灭火器'))).toBe(true)
  })

  test('AI 端点权限：viewer 403，未登录 401，editor 200', async () => {
    const viewerRes = await request(app)
      .post('/api/ai/text-search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ keyword: '干粉' })
    expect(viewerRes.status).toBe(403)

    const noTokenRes = await request(app)
      .post('/api/ai/text-search')
      .send({ keyword: '干粉' })
    expect(noTokenRes.status).toBe(401)

    const editorRes = await request(app)
      .post('/api/ai/text-search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '干粉' })
    expect(editorRes.status).toBe(200)
  })

  test('recognize 无 image_url 无 query → 仍返回 text stage 空匹配（不报错）', async () => {
    const res = await request(app)
      .post('/api/ai/recognize')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.data.stage).toBe('text')
    expect(Array.isArray(res.body.data.matches)).toBe(true)
  })
})
