import db from '../db'
import { LogEntry, PaginatedResult } from '../types'

/** 列表查询行：日志 + 操作人名称（左联，可能为 null） */
export type LogRow = LogEntry & {
  actor_name?: string | null
}

/** listLogs 筛选参数 */
export interface ListLogsFilters {
  actor_id?: number
  action?: string
  entity?: string
  /** 起始日期 'YYYY-MM-DD'（含），与 created_at 前缀比较 */
  start_date?: string
  /** 结束日期 'YYYY-MM-DD'（含，按当天 23:59:59 处理） */
  end_date?: string
  page?: number
  page_size?: number
}

/** stats 返回结构 */
export interface LogStats {
  total: number
  today: number
  by_action: Array<{ action: string; count: number }>
}

/**
 * 分页查询日志，支持按操作人/action/entity/时间范围筛选
 * - logs 表 append-only，仅 SELECT
 * - created_at 为 TEXT（'YYYY-MM-DD HH:MM:SS'），用字符串前缀比较
 */
export function listLogs(filters: ListLogsFilters): PaginatedResult<LogRow> {
  const page = filters.page && filters.page > 0 ? filters.page : 1
  const pageSize = Math.min(
    Math.max(
      filters.page_size && filters.page_size > 0 ? filters.page_size : 20,
      1
    ),
    100
  )

  const where: string[] = []
  const params: unknown[] = []
  if (filters.actor_id !== undefined) {
    where.push('l.actor_id = ?')
    params.push(filters.actor_id)
  }
  if (filters.action) {
    where.push('l.action = ?')
    params.push(filters.action)
  }
  if (filters.entity) {
    where.push('l.entity = ?')
    params.push(filters.entity)
  }
  if (filters.start_date) {
    where.push('l.created_at >= ?')
    params.push(`${filters.start_date} 00:00:00`)
  }
  if (filters.end_date) {
    where.push('l.created_at <= ?')
    params.push(`${filters.end_date} 23:59:59`)
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM logs l ${whereClause}`).get(
      ...params
    ) as { c: number }
  ).c

  const list = db
    .prepare(
      `SELECT l.*, u.name as actor_name
       FROM logs l
       LEFT JOIN users u ON l.actor_id = u.id
       ${whereClause}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as LogRow[]

  return { list, total, page, pageSize }
}

/**
 * 单条日志详情（含 actor_name）
 */
export function getLogById(id: number): LogRow | null {
  const row = db
    .prepare(
      `SELECT l.*, u.name as actor_name
       FROM logs l
       LEFT JOIN users u ON l.actor_id = u.id
       WHERE l.id = ?`
    )
    .get(id) as LogRow | undefined
  return row ?? null
}

/**
 * 日志统计：总数 / 今日 / 按 action 分组
 * - 今日按服务器 +8 时区计算
 */
export function getLogStats(): LogStats {
  const total = (
    db.prepare('SELECT COUNT(*) as c FROM logs').get() as { c: number }
  ).c

  const today = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM logs
         WHERE created_at >= date('now','+8 hours')`
      )
      .get() as { c: number }
  ).c

  const byAction = db
    .prepare(
      `SELECT action, COUNT(*) as count
       FROM logs
       GROUP BY action
       ORDER BY count DESC, action ASC`
    )
    .all() as Array<{ action: string; count: number }>

  return { total, today, by_action: byAction }
}

export default { listLogs, getLogById, getLogStats }
