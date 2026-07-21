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

async function inbound(
  token: string,
  equipmentName: string,
  quantity: number
): Promise<void> {
  const res = await request(app)
    .post('/api/records')
    .set('Authorization', `Bearer ${token}`)
    .send({ equipment_name: equipmentName, type: 'in', quantity })
  expect(res.status).toBe(201)
}

async function outbound(
  token: string,
  equipmentName: string,
  quantity: number,
  recipient: string = '领用人'
): Promise<{ status: number; body: any }> {
  const res = await request(app)
    .post('/api/records')
    .set('Authorization', `Bearer ${token}`)
    .send({
      equipment_name: equipmentName,
      type: 'out',
      quantity,
      recipient,
      purpose: '测试',
    })
  return { status: res.status, body: res.body }
}

function getStock(equipmentName: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) as stock
       FROM records r JOIN equipments e ON r.equipment_id = e.id
       WHERE e.name = ?`
    )
    .get(equipmentName) as { stock: number }
  return row.stock
}

describe('出库库存不足校验（POST /api/records type=out）', () => {
  test('未登录返回 401', async () => {
    const res = await request(app)
      .post('/api/records')
      .send({ equipment_name: '灭火器', type: 'out', quantity: 1 })
    expect(res.status).toBe(401)
  })

  test('viewer 出库返回 403', async () => {
    const viewer = createUser('viewer')
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ equipment_name: '灭火器', type: 'out', quantity: 1 })
    expect(res.status).toBe(403)
  })

  test('无库存（器材不存在）出库返回 400，事务回滚不创建器材', async () => {
    const editor = createUser('editor')
    const res = await outbound(editor.token, '新器材-无库存', 1)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('库存不足')
    expect(res.body.message).toContain('当前库存 0')
    // createRecord 整个流程在 db.transaction 内：getOrCreateEquipment 创建器材 -> 校验库存抛错
    // -> 事务回滚 -> equipments 表的 INSERT 也被回滚，器材不会被创建
    // 这符合 "出库时根据器材名称匹配库存" 的硬约束：出库前器材应已存在
    const eq = db.prepare('SELECT name FROM equipments WHERE name = ?').get('新器材-无库存')
    expect(eq).toBeUndefined()
  })

  test('出库数量大于库存返回 400', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-X', 5)
    // 库存 5，出库 6
    const res = await outbound(editor.token, '灭火器-X', 6)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('库存不足')
    expect(res.body.message).toContain('当前库存 5')
    expect(res.body.message).toContain('出库数量 6')
    // 库存不变
    expect(getStock('灭火器-X')).toBe(5)
  })

  test('出库数量等于库存成功', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-EQ', 3)
    const res = await outbound(editor.token, '灭火器-EQ', 3)
    expect(res.status).toBe(201)
    expect(res.body.code).toBe(0)
    expect(getStock('灭火器-EQ')).toBe(0)
  })

  test('出库数量小于库存成功', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-LT', 10)
    const res = await outbound(editor.token, '灭火器-LT', 3)
    expect(res.status).toBe(201)
    expect(getStock('灭火器-LT')).toBe(7)
  })

  test('多次出库后累计库存正确', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-MULTI', 10)
    await outbound(editor.token, '灭火器-MULTI', 3)
    await outbound(editor.token, '灭火器-MULTI', 2)
    await outbound(editor.token, '灭火器-MULTI', 1)
    expect(getStock('灭火器-MULTI')).toBe(4)
  })

  test('出库导致库存为 0 后再出库返回 400', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-ZERO', 2)
    await outbound(editor.token, '灭火器-ZERO', 2)
    expect(getStock('灭火器-ZERO')).toBe(0)
    const res = await outbound(editor.token, '灭火器-ZERO', 1)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('当前库存 0')
  })

  test('出库 quantity=0 返回 400', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-Q0', 5)
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ equipment_name: '灭火器-Q0', type: 'out', quantity: 0, recipient: 'r' })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('quantity')
  })

  test('出库 quantity 为负数返回 400', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-NEG', 5)
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ equipment_name: '灭火器-NEG', type: 'out', quantity: -3, recipient: 'r' })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('quantity')
  })

  test('出库 quantity 为非数字返回 400', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-NaN', 5)
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ equipment_name: '灭火器-NaN', type: 'out', quantity: 'abc', recipient: 'r' })
    expect(res.status).toBe(400)
  })

  test('出库 type 非法返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ equipment_name: '灭火器', type: 'invalid', quantity: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('type')
  })

  test('出库 equipment_name 为空返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ equipment_name: '', type: 'out', quantity: 1, recipient: 'r' })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('器材名称')
  })

  test('并发出库（库存仅够 1 个，两个并发请求）不超卖', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-CONC', 1)
    expect(getStock('灭火器-CONC')).toBe(1)

    // 两个并发出库请求，各出 1 个
    const [r1, r2] = await Promise.all([
      outbound(editor.token, '灭火器-CONC', 1, '领用人A'),
      outbound(editor.token, '灭火器-CONC', 1, '领用人B'),
    ])

    const statuses = [r1.status, r2.status].sort()
    // 一个成功（201），一个失败（400）
    expect(statuses).toContain(201)
    expect(statuses).toContain(400)
    // 库存应为 0（不超卖）
    expect(getStock('灭火器-CONC')).toBe(0)
  })

  test('并发出库（库存 5，10 个并发请求各出 1）总成功数不超过 5', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-CONC5', 5)

    const requests = Array.from({ length: 10 }, (_, i) =>
      outbound(editor.token, '灭火器-CONC5', 1, `领用人${i}`)
    )
    const results = await Promise.all(requests)
    const successCount = results.filter((r) => r.status === 201).length
    const failCount = results.filter((r) => r.status === 400).length

    expect(successCount).toBe(5)
    expect(failCount).toBe(5)
    expect(getStock('灭火器-CONC5')).toBe(0)
  })

  test('出库失败不写 record.create 日志', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-NOLOG', 1)
    await outbound(editor.token, '灭火器-NOLOG', 5) // 失败
    const records = db
      .prepare("SELECT * FROM records WHERE equipment_id = (SELECT id FROM equipments WHERE name = '灭火器-NOLOG') AND type = 'out'")
      .all()
    expect(records).toHaveLength(0)
  })

  test('出库成功写 record.create 日志', async () => {
    const editor = createUser('editor')
    await inbound(editor.token, '灭火器-LOGOK', 5)
    await outbound(editor.token, '灭火器-LOGOK', 2)
    const logs = db
      .prepare("SELECT * FROM logs WHERE action = 'record.create'")
      .all() as Array<{ action: string }>
    // 1 入库 + 1 出库 = 2 条
    expect(logs.length).toBe(2)
  })

  test('入库无库存限制（任意数量）', async () => {
    const editor = createUser('editor')
    const res = await inbound(editor.token, '灭火器-NO-LIMIT', 1000)
    expect(getStock('灭火器-NO-LIMIT')).toBe(1000)
  })
})