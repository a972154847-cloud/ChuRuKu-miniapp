/**
 * log.service 单元测试
 * 覆盖：
 * - writeLog 全参数组合（actorId / entityId / before / after / ip / userAgent 全可选）
 * - ensureLogsColumns 列兜底逻辑（ip / user_agent 列缺失时自动 ADD）
 * - writeLog 序列化（before/after 写入 JSON 字符串）
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

// 必须先 migrate 再加载 app：log.service.ts 模块加载时调 ensureLogsColumns 执行 ALTER TABLE logs
const { runMigrations } = require('../src/db/migrate')
runMigrations()

const db = require('../src/db').default
const logService = require('../src/services/log.service')
const writeLog = logService.writeLog

// ensureLogsColumns 在模块加载时已经执行过；drop+recreate 后再 require 一次
// 让 ensureLogsColumns 重新检查（fix 已 DROP 的列）

beforeEach(() => {
  // logs 表触发器禁止 UPDATE/DELETE；清空用截断表的方式（drop + recreate）
  // 同时关闭外键，避免 actor_id=0/entity_id 不存在时 FK 失败
  db.pragma('foreign_keys = OFF')
  db.exec('DROP TABLE IF EXISTS logs')
  db.exec('DROP TRIGGER IF EXISTS trg_logs_no_update')
  db.exec('DROP TRIGGER IF EXISTS trg_logs_no_delete')
  const sql = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'migrations', '006_logs.sql'),
    'utf-8'
  )
  db.exec(sql)
  // 重置 ensureLogsColumns 标记（drop+recreate 之后模块级 _added 状态已失效）
  jest.resetModules()
})

describe('log.service writeLog 全字段写入', () => {
  test('最小入参（仅 action/entity）写入成功', () => {
    writeLog({ action: 'test.min', entity: 'test' })
    const row = db
      .prepare('SELECT * FROM logs WHERE action = ?')
      .get('test.min') as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.actor_id).toBeNull()
    expect(row.entity_id).toBeNull()
    expect(row.before_json).toBeNull()
    expect(row.after_json).toBeNull()
    expect(row.ip).toBeNull()
    expect(row.user_agent).toBeNull()
  })

  test('actorId / entityId 为 0 时不转为 null（? 用 ?? 兜底，0 不被替换）', () => {
    // 0 是有效 id（首条记录的 id），不应被 ?? 替换为 null
    writeLog({ action: 'test.zero', entity: 'x', actorId: 0, entityId: 0 })
    const row = db
      .prepare('SELECT actor_id, entity_id FROM logs WHERE action = ?')
      .get('test.zero') as { actor_id: number; entity_id: number }
    expect(row.actor_id).toBe(0)
    expect(row.entity_id).toBe(0)
  })

  test('before / after 写入 JSON 字符串', () => {
    const before = { name: 'old', stock: 1 }
    const after = { name: 'new', stock: 2 }
    writeLog({
      action: 'test.diff',
      entity: 'equipment',
      before,
      after,
    })
    const row = db
      .prepare('SELECT before_json, after_json FROM logs WHERE action = ?')
      .get('test.diff') as { before_json: string; after_json: string }
    expect(JSON.parse(row.before_json)).toEqual(before)
    expect(JSON.parse(row.after_json)).toEqual(after)
  })

  test('ip / userAgent 写入', () => {
    writeLog({
      action: 'test.net',
      entity: 'auth',
      ip: '192.168.1.1',
      userAgent: 'Mozilla/5.0 (test)',
    })
    const row = db
      .prepare('SELECT ip, user_agent FROM logs WHERE action = ?')
      .get('test.net') as { ip: string; user_agent: string }
    expect(row.ip).toBe('192.168.1.1')
    expect(row.user_agent).toBe('Mozilla/5.0 (test)')
  })

  test('before 传空字符串/falsy 值时存 null（? 三目兜底）', () => {
    writeLog({ action: 'test.empty', entity: 'x', before: '' })
    const row = db
      .prepare('SELECT before_json FROM logs WHERE action = ?')
      .get('test.empty') as { before_json: string | null }
    // 空字符串是 falsy，应被存为 null
    expect(row.before_json).toBeNull()
  })

  test('after 传 0 数字时存 null（? 三目兜底）', () => {
    writeLog({ action: 'test.zero.after', entity: 'x', after: 0 })
    const row = db
      .prepare('SELECT after_json FROM logs WHERE action = ?')
      .get('test.zero.after') as { after_json: string | null }
    // 0 是 falsy，? 三目会走 null 分支
    expect(row.after_json).toBeNull()
  })

  test('ip 为 undefined 走 ?? null 分支', () => {
    writeLog({ action: 'test.noip', entity: 'x' })
    const row = db
      .prepare('SELECT ip FROM logs WHERE action = ?')
      .get('test.noip') as { ip: string | null }
    expect(row.ip).toBeNull()
  })

  test('all-in-one 全字段写入', () => {
    writeLog({
      actorId: 1,
      action: 'test.full',
      entity: 'record',
      entityId: 99,
      before: { old: 1 },
      after: { new: 2 },
      ip: '10.0.0.1',
      userAgent: 'curl/7.0',
    })
    const row = db
      .prepare('SELECT * FROM logs WHERE action = ?')
      .get('test.full') as Record<string, unknown>
    expect(row.actor_id).toBe(1)
    expect(row.entity_id).toBe(99)
    expect(JSON.parse(row.before_json as string)).toEqual({ old: 1 })
    expect(JSON.parse(row.after_json as string)).toEqual({ new: 2 })
    expect(row.ip).toBe('10.0.0.1')
    expect(row.user_agent).toBe('curl/7.0')
  })
})

describe('log.service ensureLogsColumns 列兜底', () => {
  test('ip 列缺失时自动 ALTER ADD（用 jest.spyOn 模拟 PRAGMA 返回）', () => {
    // 直接调用 db.exec DROP COLUMN 是可行的，但 ensureLogsColumns 只能通过模块加载触发
    // 方案：用 jest.isolateModules + jest.doMock 注入自定义 db
    // 注意：jest.isolateModules 会重新评估 db 模块的依赖链
    const Database = require('better-sqlite3')
    const testDb = new Database(':memory:')
    testDb.exec(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    // verify 起点
    const colsBefore = testDb
      .prepare('PRAGMA table_info(logs)')
      .all() as Array<{ name: string }>
    expect(colsBefore.find((c) => c.name === 'ip')).toBeUndefined()

    // 用 jest.isolateModules 隔离 + jest.doMock 替换 db 模块
    // __esModule: true 是必须的，因为 log.service 用 __importDefault(require('../db'))
    // 无 __esModule 标记会被二次包装成 { default: { default: testDb } }
    jest.isolateModules(() => {
      jest.doMock('../src/db', () => ({ default: testDb, __esModule: true }))
      require('../src/services/log.service')
    })

    const colsAfter = testDb
      .prepare('PRAGMA table_info(logs)')
      .all() as Array<{ name: string }>
    expect(colsAfter.find((c) => c.name === 'ip')).toBeDefined()
    testDb.close()
  })

  test('user_agent 列缺失时自动 ALTER ADD', () => {
    const Database = require('better-sqlite3')
    const testDb = new Database(':memory:')
    testDb.exec(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        before_json TEXT,
        after_json TEXT,
        ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    const colsBefore = testDb
      .prepare('PRAGMA table_info(logs)')
      .all() as Array<{ name: string }>
    expect(colsBefore.find((c) => c.name === 'user_agent')).toBeUndefined()

    jest.isolateModules(() => {
      jest.doMock('../src/db', () => ({ default: testDb, __esModule: true }))
      require('../src/services/log.service')
    })

    const colsAfter = testDb
      .prepare('PRAGMA table_info(logs)')
      .all() as Array<{ name: string }>
    expect(colsAfter.find((c) => c.name === 'user_agent')).toBeDefined()
    testDb.close()
  })

  test('logs 表不存在时（cols.length===0）静默跳过', () => {
    const Database = require('better-sqlite3')
    const testDb = new Database(':memory:')
    // 故意不创建 logs 表

    expect(() => {
      jest.isolateModules(() => {
        jest.doMock('../src/db', () => ({ default: testDb, __esModule: true }))
        require('../src/services/log.service')
      })
    }).not.toThrow()
    testDb.close()
  })

  test('PRAGMA 抛错时进入 catch 并 warn（不抛错）', () => {
    const brokenDb = {
      default: {
        prepare: () => {
          throw new Error('mock PRAGMA failure')
        },
        exec: () => {
          throw new Error('mock exec failure')
        },
      },
      __esModule: true,
    }

    const origWarn = console.warn
    const warnMock = jest.fn()
    console.warn = warnMock

    try {
      jest.isolateModules(() => {
        jest.doMock('../src/db', () => brokenDb)
        require('../src/services/log.service')
      })
      // catch 生效，未向上抛
      expect(warnMock).toHaveBeenCalled()
      expect(warnMock.mock.calls[0][0]).toContain('ensureLogsColumns skipped')
    } finally {
      console.warn = origWarn
    }
  })
})

describe('log.service 默认导出', () => {
  test('default export 包含 writeLog', () => {
    const mod = require('../src/services/log.service')
    expect(mod.default).toBeDefined()
    expect(typeof mod.default.writeLog).toBe('function')
    expect(mod.default.writeLog).toBe(mod.writeLog)
  })
})
