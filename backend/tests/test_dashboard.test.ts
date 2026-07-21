process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import { resetDatabase } from '../src/db/seed'
import db from '../src/db'

let adminToken: string
let editorToken: string
let powderEquipmentId: number
let co2EquipmentId: number

/** 生成 N 年前的日期字符串（YYYY-MM-DD 00:00:00），用于直接 SQL 插入历史记录 */
function dateStrYearsAgo(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day} 00:00:00`
}

/** 今天的日期（YYYY-MM-DD），用于校验 trend 最新一天 */
function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 直接用 SQL 插入一条记录（绕过 service，可指定 created_at） */
function insertRecord(
  equipmentId: number,
  type: 'in' | 'out',
  quantity: number,
  createdAt: string
): void {
  db.prepare(
    `INSERT INTO records (equipment_id, type, quantity, operator_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(equipmentId, type, quantity, 1, createdAt, createdAt)
}

beforeEach(async () => {
  resetDatabase()
  const admin = await request(app).post('/api/auth/dev-login?override=true').send({})
  adminToken = admin.body.data.token
  const editor = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'e1', name: 'Editor', role: 'editor' })
  editorToken = editor.body.data.token

  // 拿到干粉灭火器（scrap_years=10）和二氧化碳灭火器（scrap_years=12）的 id
  const powder = db
    .prepare("SELECT id FROM equipments WHERE name LIKE '手提式干粉灭火器 2kg%' LIMIT 1")
    .get() as { id: number } | undefined
  powderEquipmentId = powder?.id || 1
  const co2 = db
    .prepare("SELECT id FROM equipments WHERE name LIKE '手提式二氧化碳灭火器 3kg%' LIMIT 1")
    .get() as { id: number } | undefined
  co2EquipmentId = co2?.id || 4
})

describe('仪表盘 API', () => {
  test('1. GET /api/dashboard 未登录返回 401', async () => {
    const res = await request(app).get('/api/dashboard')
    expect(res.status).toBe(401)
  })

  test('2. GET /api/dashboard 登录后返回完整结构', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data).toBeTruthy()
    expect(data.totals).toBeTruthy()
    expect(typeof data.totals.equipment_count).toBe('number')
    expect(typeof data.totals.stock_quantity).toBe('number')
    expect(typeof data.totals.today_count).toBe('number')
    expect(typeof data.totals.month_count).toBe('number')
    expect(Array.isArray(data.byCategory)).toBe(true)
    expect(Array.isArray(data.trend7d)).toBe(true)
    expect(Array.isArray(data.trend30d)).toBe(true)
    expect(Array.isArray(data.trend)).toBe(true)
    expect(Array.isArray(data.categoryRatio)).toBe(true)
    expect(Array.isArray(data.lowStock)).toBe(true)
    expect(Array.isArray(data.expiringSoon)).toBe(true)
    expect(Array.isArray(data.expired)).toBe(true)
  })

  test('3. GET /api/dashboard?days=7 返回 trend7d 且 trend 指向 7 天', async () => {
    const res = await request(app)
      .get('/api/dashboard?days=7')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.trend7d.length).toBeLessThanOrEqual(7)
    // trend 应与 trend7d 一致
    expect(data.trend).toEqual(data.trend7d)
  })

  test('4. GET /api/dashboard?days=30 返回 trend30d 且 trend 指向 30 天', async () => {
    const res = await request(app)
      .get('/api/dashboard?days=30')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.trend30d.length).toBeLessThanOrEqual(30)
    expect(data.trend).toEqual(data.trend30d)
  })

  test('5. GET /api/dashboard/low-stock 返回低库存列表（current_quantity < threshold）', async () => {
    // 给干粉器材入库 2 件（threshold=5，2<5 仍属于低库存）
    insertRecord(powderEquipmentId, 'in', 2, dateStrYearsAgo(0))
    const res = await request(app)
      .get('/api/dashboard/low-stock')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const list = res.body.data.list
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThan(0)
    // 每条都满足 current_quantity < threshold
    for (const item of list) {
      expect(item.current_quantity).toBeLessThan(item.threshold)
      expect(item).toHaveProperty('equipment_id')
      expect(item).toHaveProperty('name')
      expect(item).toHaveProperty('suggested_replenish')
    }
    // 干粉器材（库存 2，阈值 5）应出现在列表中
    const powder = list.find((i: any) => i.equipment_id === powderEquipmentId)
    expect(powder).toBeTruthy()
    expect(powder.current_quantity).toBe(2)
    expect(powder.suggested_replenish).toBe(3)
  })

  test('6. GET /api/dashboard/expiring 返回过期清单', async () => {
    // 干粉 scrap_years=10，插入 11 年前的入库记录 → 已过期
    insertRecord(powderEquipmentId, 'in', 1, dateStrYearsAgo(11))
    const res = await request(app)
      .get('/api/dashboard/expiring')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(Array.isArray(data.expired)).toBe(true)
    expect(Array.isArray(data.expiringSoon)).toBe(true)
    expect(Array.isArray(data.list)).toBe(true)
    // 干粉器材应出现在 expired 列表
    const expiredPowder = data.expired.find(
      (i: any) => i.equipment_id === powderEquipmentId
    )
    expect(expiredPowder).toBeTruthy()
    expect(expiredPowder.status).toBe('expired')
    expect(expiredPowder.days_remaining).toBeLessThan(0)
    expect(expiredPowder).toHaveProperty('expire_date')
    expect(expiredPowder).toHaveProperty('scrap_years')
  })

  test('7. byCategory 数据正确（按一级分类分组求和）', async () => {
    // 干粉属"灭火器类"，入库 10 件
    insertRecord(powderEquipmentId, 'in', 10, dateStrYearsAgo(0))
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const byCategory = res.body.data.byCategory
    // 应包含"灭火器类"
    const extinguisher = byCategory.find(
      (c: any) => c.category_name === '灭火器类'
    )
    expect(extinguisher).toBeTruthy()
    expect(extinguisher.total_quantity).toBeGreaterThanOrEqual(10)
    expect(extinguisher.equipment_count).toBeGreaterThan(0)
    // categoryRatio 也应包含对应占比
    const ratio = res.body.data.categoryRatio.find(
      (c: any) => c.category_name === '灭火器类'
    )
    expect(ratio).toBeTruthy()
    expect(typeof ratio.percentage).toBe('number')
  })

  test('8. trend 数据按日期升序且包含出入库双向数据', async () => {
    // 今天入库 5、出库 2
    insertRecord(powderEquipmentId, 'in', 5, dateStrYearsAgo(0))
    insertRecord(powderEquipmentId, 'out', 2, dateStrYearsAgo(0))
    const res = await request(app)
      .get('/api/dashboard?days=7')
      .set('Authorization', `Bearer ${editorToken}`)
    expect(res.status).toBe(200)
    const trend = res.body.data.trend7d
    expect(trend.length).toBeGreaterThan(0)
    // 校验日期升序
    for (let i = 1; i < trend.length; i++) {
      expect(trend[i].date >= trend[i - 1].date).toBe(true)
    }
    // 最新一天应为今天
    const last = trend[trend.length - 1]
    expect(last.date).toBe(todayStr())
    // 今天应有出入库双向数据
    expect(last.in_count).toBeGreaterThanOrEqual(1)
    expect(last.in_quantity).toBeGreaterThanOrEqual(5)
    expect(last.out_count).toBeGreaterThanOrEqual(1)
    expect(last.out_quantity).toBeGreaterThanOrEqual(2)
    // 每条都包含四个字段
    expect(last).toHaveProperty('date')
    expect(last).toHaveProperty('in_count')
    expect(last).toHaveProperty('in_quantity')
    expect(last).toHaveProperty('out_count')
    expect(last).toHaveProperty('out_quantity')
  })
})
