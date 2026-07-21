import db from '../db'

/**
 * P1-12 兜底：确保 logs 表包含 ip / user_agent 字段
 * - 正常流程由 migrations/006_logs.sql 创建
 * - 此处兜底处理老库未迁移的情况（SQLite 不支持 ADD COLUMN IF NOT EXISTS，需 PRAGMA 检查）
 * - 用 try-catch 包裹：测试环境 migrations 未运行时 logs 表不存在，静默跳过（migrations 会创建）
 */
function ensureLogsColumns(): void {
  try {
    const cols = db.prepare('PRAGMA table_info(logs)').all() as Array<{ name: string }>
    if (cols.length === 0) return // logs 表不存在，跳过（migrations 会创建）
    if (!cols.some((c) => c.name === 'ip')) {
      db.exec('ALTER TABLE logs ADD COLUMN ip TEXT')
    }
    if (!cols.some((c) => c.name === 'user_agent')) {
      db.exec('ALTER TABLE logs ADD COLUMN user_agent TEXT')
    }
  } catch (err) {
    // 模块加载时机早于 migrations 时 logs 表不存在，静默跳过
    console.warn('[log.service] ensureLogsColumns skipped:', (err as Error).message)
  }
}
ensureLogsColumns()

/**
 * 写入操作日志（append-only，logs 表触发器禁止 UPDATE/DELETE）
 */
export function writeLog(params: {
  actorId?: number | null
  action: string
  entity: string
  entityId?: number | null
  before?: unknown
  after?: unknown
  ip?: string | null
  userAgent?: string | null
}): void {
  db.prepare(
    `INSERT INTO logs (actor_id, action, entity, entity_id, before_json, after_json, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.actorId ?? null,
    params.action,
    params.entity,
    params.entityId ?? null,
    params.before ? JSON.stringify(params.before) : null,
    params.after ? JSON.stringify(params.after) : null,
    params.ip ?? null,
    params.userAgent ?? null
  )
}

export default { writeLog }