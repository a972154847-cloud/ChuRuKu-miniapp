/**
 * equipment.service 单元测试
 * 覆盖：
 * - listEquipments：分页 / 关键字过滤 / 默认值（page=1, pageSize=20）
 * - searchEquipments：空关键字 / is_active=1 / name+spec / 限制 20 条
 * - 默认导出
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

const { runMigrations } = require('../src/db/migrate')
runMigrations()

const db = require('../src/db').default as typeof import('../src/db').default
const {
  listEquipments,
  searchEquipments,
} = require('../src/services/equipment.service')
const { resetDatabase } = require('../src/db/seed') as typeof import('../src/db/seed')

beforeEach(() => {
  resetDatabase()
  // 清空迁移预置的 20 条种子器材与关联记录
  db.exec('DELETE FROM record_photos')
  db.exec('DELETE FROM records')
  db.exec('DELETE FROM equipments')
  // 造 5 个器材：3 个 active + 1 个 inactive + 1 个空 spec
  db.prepare(
    "INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)"
  ).run('手提式干粉灭火器', '4kg', 1)
  db.prepare(
    "INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)"
  ).run('推车式干粉灭火器', '25kg', 1)
  db.prepare(
    "INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)"
  ).run('二氧化碳灭火器', '5kg', 1)
  db.prepare(
    "INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)"
  ).run('已停用器材', null, 0)
  db.prepare(
    "INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)"
  ).run('安全帽', null, 1)
})

describe('listEquipments', () => {
  test('默认参数返回第 1 页 20 条', () => {
    const res = listEquipments()
    expect(res.page).toBe(1)
    expect(res.pageSize).toBe(20)
    expect(res.total).toBe(5) // 含 is_active=0
    expect(res.list.length).toBe(5)
  })

  test('keyword 过滤 name LIKE', () => {
    const res = listEquipments({ keyword: '干粉' })
    expect(res.list).toHaveLength(2)
    for (const e of res.list) {
      expect(e.name).toContain('干粉')
    }
  })

  test('无匹配 → 空 list + total=0', () => {
    const res = listEquipments({ keyword: '不存在的关键字' })
    expect(res.list).toEqual([])
    expect(res.total).toBe(0)
  })

  test('page=2 OFFSET 正确', () => {
    const res = listEquipments({ page: 2, pageSize: 2 })
    expect(res.list).toHaveLength(2)
    expect(res.page).toBe(2)
    expect(res.total).toBe(5)
  })

  test('page<=0 走默认 1', () => {
    const res = listEquipments({ page: 0, pageSize: 2 })
    expect(res.page).toBe(1)
    expect(res.list.length).toBe(2)
  })

  test('pageSize<=0 走默认 20', () => {
    const res = listEquipments({ page: 1, pageSize: -1 })
    expect(res.pageSize).toBe(20)
  })

  test('包含 category_name 和 category_code 字段（关联 categories）', () => {
    // 给第一个器材设置分类
    const cat = db
      .prepare("SELECT id FROM categories LIMIT 1")
      .get() as { id: number }
    db.prepare('UPDATE equipments SET category_id = ? WHERE name = ?').run(
      cat.id,
      '手提式干粉灭火器'
    )
    const res = listEquipments({ keyword: '手提' })
    expect(res.list[0]).toHaveProperty('category_name')
    expect(res.list[0]).toHaveProperty('category_code')
  })

  test('按 id ASC 排序', () => {
    const res = listEquipments()
    const ids = res.list.map((e: any) => e.id)
    const sorted = [...ids].sort((a, b) => a - b)
    expect(ids).toEqual(sorted)
  })
})

describe('searchEquipments', () => {
  test('空关键字 → []', () => {
    expect(searchEquipments('')).toEqual([])
  })

  test('纯空白 → []', () => {
    expect(searchEquipments('   ')).toEqual([])
  })

  test('undefined → []', () => {
    expect(searchEquipments(undefined as any)).toEqual([])
  })

  test('关键字命中 name', () => {
    const res = searchEquipments('手提')
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('手提式干粉灭火器')
  })

  test('关键字命中 spec', () => {
    const res = searchEquipments('25kg')
    expect(res).toHaveLength(1)
    expect(res[0].spec).toBe('25kg')
  })

  test('只返回 is_active=1 的器材（过滤已停用）', () => {
    const res = searchEquipments('已停用')
    expect(res).toEqual([])
  })

  test('同时匹配 name 和 spec 的同一关键字', () => {
    const res = searchEquipments('灭火器')
    expect(res.length).toBe(3) // 干粉×2 + 二氧化碳
  })

  test('按 name ASC 排序', () => {
    const res = searchEquipments('灭火器')
    const names = res.map((e: any) => e.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(sorted)
  })

  test('LIMIT 20 限制（边界）', () => {
    // 造 25 个 active 器材
    for (let i = 0; i < 25; i++) {
      db.prepare('INSERT INTO equipments (name, is_active) VALUES (?, ?)').run(
        `extra${i}`,
        1
      )
    }
    const res = searchEquipments('extra')
    expect(res.length).toBe(20)
  })

  test('首尾空白被 trim', () => {
    const res = searchEquipments('  手提  ')
    expect(res).toHaveLength(1)
  })
})

describe('equipment.service 默认导出', () => {
  test('default export 包含 listEquipments / searchEquipments / toInt', () => {
    const mod = require('../src/services/equipment.service')
    expect(mod.default).toBeDefined()
    expect(typeof mod.default.listEquipments).toBe('function')
    expect(typeof mod.default.searchEquipments).toBe('function')
    expect(typeof mod.default.toInt).toBe('function')
  })

  test('toInt 解析合法数字', () => {
    const mod = require('../src/services/equipment.service')
    expect(mod.default.toInt('123', 0)).toBe(123)
  })

  test('toInt 解析非法值返回默认值', () => {
    const mod = require('../src/services/equipment.service')
    expect(mod.default.toInt('abc', 5)).toBe(5)
    expect(mod.default.toInt(undefined, 10)).toBe(10)
    expect(mod.default.toInt(NaN as any, 7)).toBe(7)
  })
})
