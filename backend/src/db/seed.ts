import db from './index'
import { config } from '../config'
import { runMigrations } from './migrate'

/**
 * 业务表清单（按依赖反向排序，关闭外键后顺序无影响，仅保持清晰）
 */
const BUSINESS_TABLES = [
  'logs',
  'record_photos',
  'records',
  'equipments',
  'categories',
  'users',
] as const

/**
 * 重置开发数据库：清空所有业务表与迁移记录后重新执行迁移。
 * 生产环境拒绝执行，避免误删线上数据。
 */
export function resetDatabase(): void {
  if (config.nodeEnv === 'production') {
    throw new Error('[seed] 生产环境禁止执行 resetDatabase')
  }

  db.pragma('foreign_keys = OFF')
  try {
    for (const table of BUSINESS_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }
    db.exec('DROP TABLE IF EXISTS _migrations')
  } finally {
    db.pragma('foreign_keys = ON')
  }

  runMigrations()
}

// 命令行入口：ts-node src/db/seed.ts
if (require.main === module) {
  resetDatabase()
  console.log('[seed] 数据库已重置并重新迁移')
  process.exit(0)
}
