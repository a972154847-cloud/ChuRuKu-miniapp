/**
 * 回收站服务：管理被删除数据的恢复与永久清理
 *
 * 原则：
 * - 删除操作将完整数据 + 关联数据序列化为 JSON 存入 recycle_bin 表
 * - 恢复操作从 JSON 反序列化并 INSERT 回到原表
 * - 物理删除（永久清理）仅删除 recycle_bin 记录
 * - 所有操作均写入操作日志
 */
import db from '../db'
import { writeLog } from './log.service'
import { NotFoundError, ValidationError } from '../utils/errors'

/* ========== 类型定义 ========== */

export type EntityType = 'record' | 'category'

export interface RecycleBinRow {
  id: number
  entity_type: EntityType
  entity_id: number
  entity_data: string
  entity_summary: string | null
  deleted_by: number | null
  deleted_at: string
  restored_at: string | null
  restored_by: number | null
}

/** 列表展示用的回收站条目（含删除者姓名） */
export interface RecycleBinItem {
  id: number
  entity_type: EntityType
  entity_id: number
  entity_data: any
  entity_summary: string | null
  deleted_by: number | null
  deleted_by_name: string | null
  deleted_at: string
  restored_at: string | null
}

/** 分页结果 */
export interface PaginatedRecycleResult {
  list: RecycleBinItem[]
  total: number
  page: number
  pageSize: number
}

/* ========== 查询 ========== */

/**
 * 查询回收站列表（仅显示尚未恢复的条目）
 */
export function listRecycleBin(params: {
  entity_type?: EntityType
  page?: number
  pageSize?: number
}): PaginatedRecycleResult {
  const page = params.page && params.page > 0 ? params.page : 1
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 20

  const conditions: string[] = ['rb.restored_at IS NULL']
  const args: unknown[] = []

  if (params.entity_type) {
    conditions.push('rb.entity_type = ?')
    args.push(params.entity_type)
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ')

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM recycle_bin rb ${whereClause}`).get(...args) as {
      c: number
    }
  ).c

  const rows = db
    .prepare(
      `SELECT rb.*, u.name as deleted_by_name
       FROM recycle_bin rb
       LEFT JOIN users u ON rb.deleted_by = u.id
       ${whereClause}
       ORDER BY rb.deleted_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize) as (RecycleBinRow & {
    deleted_by_name: string | null
  })[]

  const list = rows.map((row) => ({
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    entity_data: safeParseJson(row.entity_data),
    entity_summary: row.entity_summary,
    deleted_by: row.deleted_by,
    deleted_by_name: row.deleted_by_name,
    deleted_at: row.deleted_at,
    restored_at: row.restored_at,
  }))

  return { list, total, page, pageSize }
}

/**
 * 获取单条回收站记录（含 entity_data 解析）
 */
function getRecycleItem(itemId: number): RecycleBinItem | null {
  const row = db
    .prepare(
      `SELECT rb.*, u.name as deleted_by_name
       FROM recycle_bin rb
       LEFT JOIN users u ON rb.deleted_by = u.id
       WHERE rb.id = ?`
    )
    .get(itemId) as (RecycleBinRow & { deleted_by_name: string | null }) | undefined

  if (!row) return null

  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    entity_data: safeParseJson(row.entity_data),
    entity_summary: row.entity_summary,
    deleted_by: row.deleted_by,
    deleted_by_name: row.deleted_by_name,
    deleted_at: row.deleted_at,
    restored_at: row.restored_at,
  }
}

/* ========== 删除时移入回收站 ========== */

/**
 * 将记录及其关联照片移入回收站
 * 调用方应在事务中调用此函数（配合 writeLog 等操作）
 */
export function saveRecordToRecycleBin(
  record: Record<string, unknown>,
  photos: Record<string, unknown>[],
  operatorId: number
): void {
  const data = {
    record,
    photos,
    equipment_name: (record as any).equipment_name || null,
    operator_name: (record as any).operator_name || null,
  }

  const typeLabel = record.type === 'in' ? '入库' : '出库'
  const summary = `${typeLabel} ${record.quantity}件 - ${data.equipment_name || `ID:${record.id}`}`

  db.prepare(
    `INSERT INTO recycle_bin (entity_type, entity_id, entity_data, entity_summary, deleted_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run('record', record.id, JSON.stringify(data), summary, operatorId)
}

/**
 * 将分类移入回收站
 * 调用方应在事务中调用此函数
 */
export function saveCategoryToRecycleBin(
  category: Record<string, unknown>,
  operatorId: number
): void {
  const summary = `${category.name}${category.code ? ` (${category.code})` : ''}`
  const data = { category }

  db.prepare(
    `INSERT INTO recycle_bin (entity_type, entity_id, entity_data, entity_summary, deleted_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run('category', category.id, JSON.stringify(data), summary, operatorId)
}

/* ========== 恢复操作 ========== */

/**
 * 从回收站恢复数据
 * 根据 entity_type 执行对应的恢复逻辑
 */
export function restoreItem(itemId: number, operatorId: number): RecycleBinItem {
  const item = getRecycleItem(itemId)
  if (!item) {
    throw new NotFoundError('回收站记录不存在')
  }
  if (item.restored_at) {
    throw new ValidationError('该数据已被恢复，不能重复恢复')
  }

  const entityData = item.entity_data
  if (!entityData) {
    throw new ValidationError('回收站数据损坏，无法恢复')
  }

  db.transaction(() => {
    switch (item.entity_type) {
      case 'record':
        restoreRecord(entityData, item.entity_id, operatorId)
        break
      case 'category':
        restoreCategory(entityData, item.entity_id, operatorId)
        break
      default:
        throw new ValidationError(`不支持恢复 ${item.entity_type} 类型`)
    }

    // 标记回收站记录为已恢复
    db.prepare(
      `UPDATE recycle_bin SET restored_at = datetime('now', '+8 hours'), restored_by = ? WHERE id = ?`
    ).run(operatorId, itemId)

    writeLog({
      actorId: operatorId,
      action: `recycle.restore.${item.entity_type}`,
      entity: 'recycle_bin',
      entityId: itemId,
      before: { entity_type: item.entity_type, entity_id: item.entity_id },
      after: { restored: true },
    })
  })()

  return getRecycleItem(itemId)!
}

/** 恢复记录：重新插入 records 表和关联的 record_photos */
function restoreRecord(
  data: { record: any; photos?: any[] },
  originalId: number,
  operatorId: number
): void {
  const record = data.record
  if (!record) throw new ValidationError('记录数据缺失')

  // 检查原 ID 是否已被占用（极小概率，但做幂等保护）
  const existing = db.prepare('SELECT id FROM records WHERE id = ?').get(originalId)
  if (existing) {
    throw new ValidationError(`记录 ID ${originalId} 已存在，无法恢复（可能已被其他操作重新创建）`)
  }

  // 重新插入记录
  db.prepare(
    `INSERT INTO records (id, equipment_id, type, quantity, operator_id, produced_at,
      location_photo_url, ai_source, name_source, recipient, purpose,
      expected_return_at, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    originalId,
    record.equipment_id,
    record.type,
    record.quantity,
    record.operator_id,
    record.produced_at ?? null,
    record.location_photo_url ?? null,
    record.ai_source ?? null,
    record.name_source ?? null,
    record.recipient ?? null,
    record.purpose ?? null,
    record.expected_return_at ?? null,
    record.remark ?? null,
    record.created_at,
    record.updated_at
  )

  // 恢复关联照片
  const photos: any[] = data.photos || []
  for (const photo of photos) {
    const existingPhoto = db
      .prepare('SELECT id FROM record_photos WHERE id = ?')
      .get(photo.id) as { id: number } | undefined
    if (existingPhoto) continue // 照片已存在则跳过

    db.prepare(
      `INSERT INTO record_photos (id, record_id, url, kind, annotation_json, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      photo.id,
      photo.record_id,
      photo.url,
      photo.kind,
      photo.annotation_json ?? null,
      photo.sort_order ?? 0,
      photo.created_at
    )
  }

  writeLog({
    actorId: operatorId,
    action: 'record.restore',
    entity: 'record',
    entityId: originalId,
    after: { restored_from_recycle_bin: true, photos_count: photos.length },
  })
}

/** 恢复分类：重新插入 categories 表 */
function restoreCategory(
  data: { category: any },
  originalId: number,
  operatorId: number
): void {
  const category = data.category
  if (!category) throw new ValidationError('分类数据缺失')

  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(originalId)
  if (existing) {
    throw new ValidationError(`分类 ID ${originalId} 已存在，无法恢复`)
  }

  db.prepare(
    `INSERT INTO categories (id, parent_id, code, name, level, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    originalId,
    category.parent_id ?? null,
    category.code,
    category.name,
    category.level,
    category.sort_order ?? 0,
    category.created_at
  )

  writeLog({
    actorId: operatorId,
    action: 'category.restore',
    entity: 'category',
    entityId: originalId,
    after: { restored_from_recycle_bin: true },
  })
}

/* ========== 永久删除 ========== */

/**
 * 从回收站永久删除记录（物理删除）
 * 调用前应确认用户已确认此操作不可逆
 */
export function permanentlyDelete(itemId: number, operatorId: number): void {
  const item = getRecycleItem(itemId)
  if (!item) {
    throw new NotFoundError('回收站记录不存在')
  }

  db.transaction(() => {
    writeLog({
      actorId: operatorId,
      action: `recycle.permanent_delete.${item.entity_type}`,
      entity: 'recycle_bin',
      entityId: itemId,
      before: {
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        summary: item.entity_summary,
      },
    })

    db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(itemId)
  })()
}

/* ========== 工具函数 ========== */

function safeParseJson(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

export default {
  listRecycleBin,
  restoreItem,
  permanentlyDelete,
  saveRecordToRecycleBin,
  saveCategoryToRecycleBin,
}
