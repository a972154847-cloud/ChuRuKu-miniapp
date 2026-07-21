import request from './request'

/** 操作日志行（含 actor_name） */
export interface LogEntry {
  id: number
  actor_id?: number | null
  action: string
  entity: string
  entity_id?: number | null
  before_json?: string | null
  after_json?: string | null
  ip?: string | null
  user_agent?: string | null
  created_at: string
  actor_name?: string | null
}

export interface ListLogsParams {
  actor_id?: number
  action?: string
  entity?: string
  start_date?: string
  end_date?: string
  page?: number
  page_size?: number
}

export interface ListLogsResult {
  list: LogEntry[]
  total: number
  page: number
  pageSize: number
}

export interface LogStats {
  total: number
  today: number
  by_action: Array<{ action: string; count: number }>
}

/** 日志分页列表（仅 Admin） */
export function listLogs(params: ListLogsParams = {}) {
  return request<ListLogsResult>({ url: '/logs', method: 'GET', data: params })
}

/** 日志统计 */
export function getLogStats() {
  return request<LogStats>({ url: '/logs/stats', method: 'GET' })
}

/** 单条日志详情 */
export function getLogById(id: number) {
  return request<LogEntry>({ url: `/logs/${id}`, method: 'GET' })
}
