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

export default { listEquipments, searchEquipments }
