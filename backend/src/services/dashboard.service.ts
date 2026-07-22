import db from '../db'

/** 仪表盘顶部汇总指标 */
export interface DashboardTotals {
  equipment_count: number
  stock_quantity: number
  today_count: number
  month_count: number
}

/** 按一级分类分组的库存量（用于柱状图） */
export interface CategoryBucket {
  category_name: string
  total_quantity: number
  equipment_count: number
}

/** 分类占比（用于饼图） */
export interface CategoryRatio {
  category_name: string
  percentage: number
  quantity: number
}

/** 出入库趋势单点（用于折线图） */
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

interface RawTrendRow {
  date: string
  in_count: number
  in_quantity: number
  out_count: number
  out_quantity: number
}

/** 顶部 4 项汇总：总器材数 / 当前库存总量 / 今日操作次数 / 本月操作次数 */
function getTotals(): DashboardTotals {
  const equipmentCount = (
    db.prepare('SELECT COUNT(*) as c FROM equipments WHERE is_active = 1').get() as {
      c: number
    }
  ).c

  const stockRow = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END), 0) as total
       FROM records`
    )
    .get() as { total: number }

  const todayRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM records
       WHERE date(created_at) = date('now', '+8 hours')`
    )
    .get() as { c: number }

  const monthRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM records
       WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', '+8 hours')`
    )
    .get() as { c: number }

  return {
    equipment_count: equipmentCount,
    stock_quantity: stockRow.total,
    today_count: todayRow.c,
    month_count: monthRow.c,
  }
}

/**
 * 按一级分类（level=1）分组聚合当前库存量与器材数。
 * 器材挂在二级分类下，需 JOIN 到 parent 一级分类。
 *
 * P2-3 修复：使用 LEFT JOIN 包含三种特殊情况
 * 1) e.category_id IS NULL（未分类器材）
 * 2) e.category_id 指向二级分类但二级分类的 parent_id 为 NULL（数据异常兜底）
 * 3) 全部正常的有分类器材
 * 三种情况在结果中分别用 "未分类" / "其他" / 真实分类名表示
 */
function getByCategory(): CategoryBucket[] {
  const rows = db
    .prepare(
      `SELECT
         CASE
           WHEN e.category_id IS NULL THEN '未分类'
           WHEN c1.id IS NULL THEN '其他'
           ELSE c1.name
         END as category_name,
         COALESCE(SUM(CASE WHEN r.type = 'in' THEN r.quantity ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN r.type = 'out' THEN r.quantity ELSE 0 END), 0) as total_quantity,
         COUNT(DISTINCT e.id) as equipment_count
       FROM equipments e
       LEFT JOIN categories c2 ON e.category_id = c2.id
       LEFT JOIN categories c1 ON c2.parent_id = c1.id
       LEFT JOIN records r ON r.equipment_id = e.id
       WHERE e.is_active = 1
       GROUP BY category_name
       ORDER BY total_quantity DESC, category_name ASC`
    )
    .all() as Array<{
    category_name: string
    total_quantity: number
    equipment_count: number
  }>

  return rows.map((r) => ({
    category_name: r.category_name,
    total_quantity: Number(r.total_quantity),
    equipment_count: Number(r.equipment_count),
  }))
}

/** 基于 byCategory 计算分类占比（百分比保留一位小数） */
function buildCategoryRatio(byCategory: CategoryBucket[]): CategoryRatio[] {
  const total = byCategory.reduce((s, c) => s + c.total_quantity, 0)
  return byCategory.map((c) => ({
    category_name: c.category_name,
    percentage: total > 0 ? Math.round((c.total_quantity / total) * 1000) / 10 : 0,
    quantity: c.total_quantity,
  }))
}

/**
 * 近 N 天出入库趋势（含今天，缺失日期补 0，按日期升序）。
 * 用 SQLite 递归 CTE 生成日期序列，时区统一 +8 hours，避免 JS 时区漂移。
 */
function buildTrend(days: number): TrendPoint[] {
  const offset = Math.max(0, days - 1)
  const modifier = `-${offset} days`
  const rows = db
    .prepare(
      `WITH RECURSIVE dates(d) AS (
         SELECT date('now', '+8 hours', ?)
         UNION ALL
         SELECT date(d, '+1 day') FROM dates WHERE d < date('now', '+8 hours')
       )
       SELECT d as date,
              COALESCE(SUM(CASE WHEN r.type = 'in' THEN 1 ELSE 0 END), 0) as in_count,
              COALESCE(SUM(CASE WHEN r.type = 'in' THEN r.quantity ELSE 0 END), 0) as in_quantity,
              COALESCE(SUM(CASE WHEN r.type = 'out' THEN 1 ELSE 0 END), 0) as out_count,
              COALESCE(SUM(CASE WHEN r.type = 'out' THEN r.quantity ELSE 0 END), 0) as out_quantity
       FROM dates d
       LEFT JOIN records r ON r.created_at >= d AND r.created_at < datetime(d, '+1 day')
       GROUP BY d
       ORDER BY d ASC`
    )
    .all(modifier) as RawTrendRow[]

  return rows.map((r) => ({
    date: r.date,
    in_count: Number(r.in_count),
    in_quantity: Number(r.in_quantity),
    out_count: Number(r.out_count),
    out_quantity: Number(r.out_quantity),
  }))
}

/** 低库存预警：当前库存 < threshold，建议补货量 = threshold - current */
export function getLowStock(): LowStockItem[] {
  const rows = db
    .prepare(
      `SELECT e.id as equipment_id, e.name, e.threshold,
              COALESCE(SUM(CASE WHEN r.type = 'in' THEN r.quantity ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN r.type = 'out' THEN r.quantity ELSE 0 END), 0) as current_quantity
       FROM equipments e
       LEFT JOIN records r ON r.equipment_id = e.id
       WHERE e.is_active = 1
       GROUP BY e.id, e.name, e.threshold
       HAVING current_quantity < e.threshold
       ORDER BY current_quantity ASC, e.id ASC`
    )
    .all() as Array<{
    equipment_id: number
    name: string
    threshold: number
    current_quantity: number
  }>

  return rows.map((r) => ({
    equipment_id: r.equipment_id,
    name: r.name,
    current_quantity: Number(r.current_quantity),
    threshold: Number(r.threshold),
    suggested_replenish: Math.max(0, Number(r.threshold) - Number(r.current_quantity)),
  }))
}

/**
 * 过期/即将过期判定：
 * - 基准日期 = 首次入库记录时间（无入库记录则用 equipment.created_at）
 * - expire_date = 基准日期 + scrap_years 年
 * - days_remaining < 0 → expired；0..30 → expiring_soon；其余 normal
 * - scrap_years 为 NULL 或 <= 0 的器材不参与判定
 */
export function getExpiry(): {
  expired: ExpiringItem[]
  expiringSoon: ExpiringItem[]
  list: ExpiringItem[]
} {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.scrap_years, e.created_at,
              (SELECT MIN(created_at) FROM records WHERE equipment_id = e.id AND type = 'in') as first_record_date
       FROM equipments e
       WHERE e.is_active = 1 AND e.scrap_years IS NOT NULL AND e.scrap_years > 0`
    )
    .all() as Array<{
    id: number
    name: string
    scrap_years: number
    created_at: string
    first_record_date: string | null
  }>

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const expired: ExpiringItem[] = []
  const expiringSoon: ExpiringItem[] = []
  const list: ExpiringItem[] = []

  for (const row of rows) {
    const baseStr = row.first_record_date || row.created_at
    const baseDay = baseStr.slice(0, 10)
    const parts = baseDay.split('-').map(Number)
    const baseYear = parts[0]
    const baseMonth = parts[1]
    const baseDayNum = parts[2]
    const expire = new Date(baseYear + row.scrap_years, baseMonth - 1, baseDayNum)
    const diffDays = Math.floor(
      (expire.getTime() - today.getTime()) / 86400000
    )
    const expireDateStr = `${expire.getFullYear()}-${String(
      expire.getMonth() + 1
    ).padStart(2, '0')}-${String(expire.getDate()).padStart(2, '0')}`
    const status: ExpiryStatus =
      diffDays < 0 ? 'expired' : diffDays <= 30 ? 'expiring_soon' : 'normal'

    const item: ExpiringItem = {
      equipment_id: row.id,
      name: row.name,
      first_record_date: baseDay,
      scrap_years: row.scrap_years,
      expire_date: expireDateStr,
      days_remaining: diffDays,
      status,
    }
    list.push(item)
    if (status === 'expired') expired.push(item)
    else if (status === 'expiring_soon') expiringSoon.push(item)
  }

  // 过期按剩余天数升序（越早过期越靠前），即将过期同理
  expired.sort((a, b) => a.days_remaining - b.days_remaining)
  expiringSoon.sort((a, b) => a.days_remaining - b.days_remaining)

  return { expired, expiringSoon, list }
}

/**
 * 综合仪表盘数据
 * @param days 趋势时间范围，7 或 30，决定 trend 字段指向哪份数据（trend7d/trend30d 始终都返回）
 */
export function getDashboardOverview(days: number = 7): DashboardOverview {
  const totals = getTotals()
  const byCategory = getByCategory()
  const trend7d = buildTrend(7)
  const trend30d = buildTrend(30)
  const trend = days === 30 ? trend30d : trend7d
  const categoryRatio = buildCategoryRatio(byCategory)
  const lowStock = getLowStock()
  const { expired, expiringSoon } = getExpiry()

  return {
    totals,
    byCategory,
    trend7d,
    trend30d,
    trend,
    categoryRatio,
    lowStock,
    expiringSoon,
    expired,
  }
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

/** 操作映射为友好中文标签 */
const ACTION_LABELS: Record<string, string> = {
  'record.create': '新增出入库',
  'record.update': '编辑出入库',
  'record.delete': '删除出入库',
  'record.attach_photos': '添加照片',
  'record.replace_photos': '替换照片',
  'record.detach_photo': '删除照片',
  'equipment.create': '新增器材',
  'equipment.update': '编辑器材',
  'user.login': '用户登录',
  'auth.failed': '认证失败',
}

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action
}

function getEntityLabel(entity: string, entityId: number | null): string {
  if (entity === 'record') return '出入库记录'
  if (entity === 'equipment') return '器材'
  if (entity === 'user') return '用户'
  if (entity === 'category') return '分类'
  if (entity === 'record_photo') return '照片'
  return entity
}

/**
 * 获取最近系统活动动态
 * - 从 logs 表取最近 20 条记录，JOIN users 表获取操作人姓名
 * - 仅返回 viewer 及以上角色可查看的常规活动
 */
export function getDashboardActivities(): ActivityItem[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.action, l.entity, l.entity_id, l.created_at,
              u.name as actor_name
       FROM logs l
       LEFT JOIN users u ON l.actor_id = u.id
       WHERE l.action NOT LIKE 'auth.%'
       ORDER BY l.created_at DESC
       LIMIT 20`
    )
    .all() as Array<{
    id: number
    action: string
    entity: string
    entity_id: number | null
    created_at: string
    actor_name: string | null
  }>

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    action_label: getActionLabel(r.action),
    entity: r.entity,
    entity_label: getEntityLabel(r.entity, r.entity_id),
    actor_name: r.actor_name,
    created_at: r.created_at,
  }))
}

export default {
  getDashboardOverview,
  getLowStock,
  getExpiry,
  getDashboardActivities,
}
