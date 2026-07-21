process.env.DB_PATH = ':memory:'

import db from '../src/db'
import { runMigrations } from '../src/db/migrate'

beforeAll(() => {
  runMigrations()
})

describe('数据库 Schema 与种子数据', () => {
  test('6 张业务表均存在', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,1) <> '_'"
      )
      .all() as { name: string }[]
    const names = tables.map((t) => t.name).sort()
    expect(names).toContain('users')
    expect(names).toContain('categories')
    expect(names).toContain('equipments')
    expect(names).toContain('records')
    expect(names).toContain('record_photos')
    expect(names).toContain('logs')
  })

  test('categories 种子数据 >= 25 条', () => {
    const count = db.prepare('SELECT COUNT(*) as c FROM categories').get() as {
      c: number
    }
    expect(count.c).toBeGreaterThanOrEqual(25)
  })

  test('equipments 种子数据 >= 20 条', () => {
    const count = db.prepare('SELECT COUNT(*) as c FROM equipments').get() as {
      c: number
    }
    expect(count.c).toBeGreaterThanOrEqual(20)
  })

  test('logs 表禁止 UPDATE', () => {
    db.prepare('INSERT INTO logs (action, entity) VALUES (?, ?)').run(
      'test',
      'test'
    )
    expect(() => {
      db.prepare('UPDATE logs SET action = ? WHERE id = ?').run('hacked', 1)
    }).toThrow(/append-only|forbidden/i)
  })

  test('logs 表禁止 DELETE', () => {
    expect(() => {
      db.prepare('DELETE FROM logs WHERE id = ?').run(1)
    }).toThrow(/append-only|forbidden/i)
  })

  test('records.quantity 负数应被拒绝', () => {
    // 先插入一个 user 和 equipment 以满足外键
    db.prepare('INSERT INTO users (openid, name) VALUES (?, ?)').run(
      'test_openid',
      'Test User'
    )
    db.prepare(
      "INSERT INTO equipments (name, category_id) VALUES ('test', (SELECT id FROM categories LIMIT 1))"
    ).run()
    expect(() => {
      db.prepare(
        'INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, ?, ?, ?)'
      ).run(1, 'in', -1, 1)
    }).toThrow(/CHECK constraint failed/i)
  })

  test('users.role 非法值应被拒绝', () => {
    expect(() => {
      db.prepare(
        'INSERT INTO users (openid, name, role) VALUES (?, ?, ?)'
      ).run('test2', 'Test', 'superadmin')
    }).toThrow(/CHECK constraint failed/i)
  })
})
