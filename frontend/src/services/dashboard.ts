import request from './request'

/** 仪表盘顶部汇总指标 */
export interface DashboardTotals {
  equipment_count: number
  stock_quantity: number
  today_count: number
  month_count: number
}

/** 按一级分类分组的库存量（柱状图） */
export interface CategoryBucket {
  category_name: string
  total_quantity: number
  equipment_count: number
}

/** 分类占比（饼图） */
export interface CategoryRatio {
  category_name: string
  percentage: number
  quantity: number
}

/** 出入库趋势单点（折线图） */
export interface TrendPoint {
  date: string
  in_count: number
  in_quantity: number
  out_count: number
  out_quantity: number
}

/** 低库存预警项 */
export interface LowStockItem {
  equipment_id: number
  name: string
  current_quantity: number
  threshold: number
  suggested_replenish: number
}

export type ExpiryStatus = 'expired' | 'expiring_soon' | 'normal'

/** 过期/即将过期器材项 */
export interface ExpiringItem {
  equipment_id: number
  name: string
  first_record_date: string
  scrap_years: number
  expire_date: string
  days_remaining: number
  status: ExpiryStatus
}

/** 综合仪表盘数据 */
export interface DashboardOverview {
  totals: DashboardTotals
  byCategory: CategoryBucket[]
  trend7d: TrendPoint[]
  trend30d: TrendPoint[]
  trend: TrendPoint[]
  categoryRatio: CategoryRatio[]
  lowStock: LowStockItem[]
  expiringSoon: ExpiringItem[]
  expired: ExpiringItem[]
}

export interface ExpiringResult {
  list: ExpiringItem[]
  expired: ExpiringItem[]
  expiringSoon: ExpiringItem[]
}

export type DashboardDays = 7 | 30

/**
 * 综合仪表盘数据
 * @param days 趋势时间范围，7 或 30（默认 7）
 */
export function getDashboardOverview(days: DashboardDays = 7) {
  return request<DashboardOverview>({
    url: '/dashboard',
    method: 'GET',
    data: { days }
  })
}

/** 低库存预警列表 */
export function getLowStockList() {
  return request<{ list: LowStockItem[] }>({
    url: '/dashboard/low-stock',
    method: 'GET'
  })
}

/** 过期 / 即将过期器材清单 */
export function getExpiringList() {
  return request<ExpiringResult>({
    url: '/dashboard/expiring',
    method: 'GET'
  })
}

/** 系统活动项 */
export interface ActivityItem {
  id: number
  action: string
  action_label: string
  entity: string
  entity_label: string
  actor_name: string | null
  created_at: string
}

/** 系统活动动态 */
export function getDashboardActivities() {
  return request<{ list: ActivityItem[] }>({
    url: '/dashboard/activities',
    method: 'GET'
  })
}
