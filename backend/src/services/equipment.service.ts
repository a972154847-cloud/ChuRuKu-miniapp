import db from '../db'
import { Equipment } from '../types'
import { toInt } from '../utils/helpers'

/** 带分类信息的器材（JOIN categories 后的行） */
export interface EquipmentWithCategory extends Equipment {
  category_name?: string | null
  category_code?: string | null
}

export interface ListEquipmentsParams {
  keyword?: string
  page?: number
  pageSize?: number
}

export interface ListEquipmentsResult {
  list: EquipmentWithCategory[]
  total: number
  page: number
  pageSize: number
}

export function listEquipments(params: ListEquipmentsParams = {}): ListEquipmentsResult {
  const page = params.page && params.page > 0 ? params.page : 1
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 20
  const keyword = params.keyword ? String(params.keyword) : undefined

  const where: string[] = ['e.is_active = 1']
  const args: unknown[] = []
  if (keyword) {
    where.push('e.name LIKE ?')
    args.push(`%${keyword}%`)
  }
  const whereClause = 'WHERE ' + where.join(' AND ')

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM equipments e ${whereClause}`).get(...args) as {
      c: number
    }
  ).c

  const list = db
    .prepare(
      `SELECT e.*, c.name as category_name, c.code as category_code
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       ${whereClause}
       ORDER BY e.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize) as EquipmentWithCategory[]

  return { list, total, page, pageSize }
}

/**
 * 器材搜索：同时匹配 name 和 spec，返回带分类名的候选清单。
 * - 空关键字返回 []
 * - 仅返回 is_active = 1 的器材
 * - 按 name 升序，最多 20 条
 */
export function searchEquipments(keyword: string): EquipmentWithCategory[] {
  const kw = keyword ? String(keyword).trim() : ''
  if (!kw) return []

  return db
    .prepare(
      `SELECT e.*, c.name as category_name, c.code as category_code
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.is_active = 1 AND (e.name LIKE ? OR e.spec LIKE ?)
       ORDER BY e.name ASC
       LIMIT 20`
    )
    .all(`%${kw}%`, `%${kw}%`) as EquipmentWithCategory[]
}

/**
 * 获取器材详情（含当前库存 + 最近出入库记录）
 * - 返回完整器材信息、当前库存量、阈值、报废年限
 * - 附带最近 10 条出入库记录（含记录类型、数量、操作人、时间）
 */
export interface EquipmentDetail extends EquipmentWithCategory {
  current_stock: number
  recent_records: Array<{
    id: number
    type: string
    quantity: number
    operator_name: string
    created_at: string
  }>
}

export function getEquipmentDetail(id: number): EquipmentDetail | null {
  const equip = db
    .prepare(
      `SELECT e.*, c.name as category_name, c.code as category_code,
       COALESCE((
         SELECT SUM(CASE WHEN r.type='in' THEN r.quantity ELSE -r.quantity END)
         FROM records r WHERE r.equipment_id = e.id
       ), 0) AS current_stock
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.id = ?`
    )
    .get(id) as (EquipmentWithCategory & { current_stock: number }) | undefined

  if (!equip) return null

  const recent_records = db
    .prepare(
      `SELECT r.id, r.type, r.quantity, u.name as operator_name, r.created_at
       FROM records r
       LEFT JOIN users u ON r.operator_id = u.id
       WHERE r.equipment_id = ?
       ORDER BY r.created_at DESC
       LIMIT 10`
    )
    .all(id) as Array<{
    id: number
    type: string
    quantity: number
    operator_name: string
    created_at: string
  }>

  return { ...equip, recent_records }
}

export default { listEquipments, searchEquipments, getEquipmentDetail }
