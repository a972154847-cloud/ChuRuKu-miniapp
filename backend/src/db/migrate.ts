import fs from 'fs'
import path from 'path'
import db from './index'

interface MigrationRow {
  filename: string
}

/**
 * 简易 migrations 框架
 * - 扫描 migrations/ 目录下所有 .sql 文件（按文件名排序）
 * - 在数据库中维护 _migrations 表记录已执行的迁移
 * - 启动时自动执行未执行的迁移
 */
export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const migrationsDir = path.join(__dirname, '..', '..', 'migrations')
  if (!fs.existsSync(migrationsDir)) {
    console.log('[migrate] migrations 目录不存在，跳过')
    return
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('[migrate] 无迁移文件')
    return
  }

  const applied = new Set(
    (db.prepare('SELECT filename FROM _migrations').all() as MigrationRow[]).map(
      (r) => r.filename
    )
  )

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    console.log(`[migrate] 执行迁移: ${file}`)
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      db.exec(sql)
    } catch (err) {
      // 幂等处理：模块加载时可能有兜底代码（如 auth.ts 的 ensureUsersStatusColumn、
      // log.service.ts 的 ensureLogsColumns）先于迁移执行了 ALTER TABLE ADD COLUMN。
      // 若迁移因 duplicate column 失败，静默跳过（列已存在，迁移等价于已完成）。
      const msg = (err as Error).message
      if (msg.includes('duplicate column name')) {
        console.log(`[migrate]  ${file} 中列已存在（幂等跳过）: ${msg}`)
      } else {
        throw err
      }
    }
    db.exec('PRAGMA foreign_keys = ON')
    db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file)
  }
  console.log('[migrate] 迁移完成')
}

/**
 * 迁移回滚映射：每个迁移文件对应的反向 SQL。
 * DOWN 仅作为开发/调试辅助，默认回滚最近一次迁移；
 * 生产环境禁用，且回滚前应先备份数据库。
 *
 * 注意：
 * - 回滚顺序与 UP 相反，按 _migrations.id DESC 逐个执行
 * - 若回滚会破坏外键依赖（例如 002 仍被 003 引用），需先手动清理依赖数据
 * - 007 的 DOWN 把 equipments.category_id 重建为 NOT NULL；
 *   若存在 category_id IS NULL 的行，回滚会失败（符合预期，需先清理）
 */
const DOWN_MIGRATIONS: Record<string, string> = {
  '001_users.sql': `
    DROP INDEX IF EXISTS idx_users_openid;
    DROP TABLE IF EXISTS users;
  `,
  '002_categories.sql': `
    DROP TABLE IF EXISTS categories;
  `,
  '003_equipments.sql': `
    DROP INDEX IF EXISTS idx_equipments_category;
    DROP TABLE IF EXISTS equipments;
  `,
  '004_records.sql': `
    DROP INDEX IF EXISTS idx_records_created_at;
    DROP INDEX IF EXISTS idx_records_type_created;
    DROP INDEX IF EXISTS idx_records_operator;
    DROP INDEX IF EXISTS idx_records_equipment;
    DROP TABLE IF EXISTS records;
  `,
  '005_record_photos.sql': `
    DROP INDEX IF EXISTS idx_record_photos_record;
    DROP TABLE IF EXISTS record_photos;
  `,
  '006_logs.sql': `
    DROP TRIGGER IF EXISTS trg_logs_no_delete;
    DROP TRIGGER IF EXISTS trg_logs_no_update;
    DROP INDEX IF EXISTS idx_logs_created_at;
    DROP INDEX IF EXISTS idx_logs_action;
    DROP INDEX IF EXISTS idx_logs_entity;
    DROP INDEX IF EXISTS idx_logs_actor;
    DROP TABLE IF EXISTS logs;
  `,
  '007_equipments_category_null.sql': `
    PRAGMA foreign_keys = OFF;
    CREATE TABLE equipments_notnull (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      spec TEXT,
      image_url TEXT,
      scrap_years INTEGER,
      threshold INTEGER DEFAULT 5,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    );
    INSERT INTO equipments_notnull (id, name, category_id, spec, image_url, scrap_years, threshold, is_active, created_at, updated_at)
      SELECT id, name, category_id, spec, image_url, scrap_years, threshold, is_active, created_at, updated_at
      FROM equipments WHERE category_id IS NOT NULL;
    DROP TABLE equipments;
    ALTER TABLE equipments_notnull RENAME TO equipments;
    CREATE INDEX IF NOT EXISTS idx_equipments_category ON equipments(category_id);
    PRAGMA foreign_keys = ON;
  `,
  '008_users_status.sql': `
    -- SQLite 3.35.0+ 支持 DROP COLUMN
    ALTER TABLE users DROP COLUMN status;
  `,
}

/**
 * 回滚最近 N 次迁移（默认 1 次）。
 * - 从 _migrations 表按 id DESC 取最近 N 条记录
 * - 对每条记录执行对应 DOWN SQL
 * - 执行成功后从 _migrations 表删除该记录
 * - 整个回滚过程在一个事务内，失败则回滚
 */
export function runMigrationsDown(steps: number = 1): void {
  if (!Number.isFinite(steps) || steps <= 0) {
    throw new Error('steps 必须是正整数')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = db
    .prepare('SELECT filename FROM _migrations ORDER BY id DESC LIMIT ?')
    .all(steps) as MigrationRow[]

  if (applied.length === 0) {
    console.log('[migrate:down] 无可回滚的迁移')
    return
  }

  for (const row of applied) {
    const downSql = DOWN_MIGRATIONS[row.filename]
    if (!downSql) {
      throw new Error(
        `[migrate:down] 缺少 ${row.filename} 的 DOWN 脚本，拒绝回滚`
      )
    }
    console.log(`[migrate:down] 回滚迁移: ${row.filename}`)
    const rollback = db.transaction(() => {
      db.exec('PRAGMA foreign_keys = OFF')
      db.exec(downSql)
      db.exec('PRAGMA foreign_keys = ON')
      db.prepare('DELETE FROM _migrations WHERE filename = ?').run(row.filename)
    })
    rollback()
  }
  console.log(`[migrate:down] 已回滚 ${applied.length} 次迁移`)
}

// 命令行入口：
//   npm run migrate            => UP（执行未应用的迁移）
//   npm run migrate -- down    => DOWN（回滚最近一次迁移）
//   npm run migrate -- down 3  => DOWN（回滚最近 3 次迁移）
if (require.main === module) {
  const arg = process.argv[2]
  if (arg === 'down') {
    const steps = parseInt(process.argv[3] || '1', 10)
    runMigrationsDown(Number.isFinite(steps) && steps > 0 ? steps : 1)
  } else {
    runMigrations()
  }
  process.exit(0)
}
