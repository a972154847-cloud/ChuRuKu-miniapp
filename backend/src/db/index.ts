import Database from 'better-sqlite3'
import { config } from '../config'

const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
// P2-1: 并发写事务时 5s 等待，避免立即返回 SQLITE_BUSY
// 测试环境 (:memory:) 无并发，仍然设置保持行为一致
db.pragma('busy_timeout = 5000')

export default db
