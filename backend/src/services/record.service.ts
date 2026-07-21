import db from '../db'
import { writeLog } from './log.service'
import { notifyRecordEvent } from './notification.service'
import { PHOTO_LIMIT, VIDEO_LIMIT } from './upload.service'
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors'
import type { LogRow } from './log-query.service'
import {
  PaginatedResult,
  Record,
  RecordPhoto,
  RecordType,
  PhotoKind,
  AiSource,
  NameSource,
} from '../types'

interface CreateRecordInput {
  equipment_name: string
  type: RecordType
  quantity: number
  location_photo_url?: string | null
  ai_source?: AiSource
  name_source?: NameSource
  recipient?: string | null
  purpose?: string | null
  expected_return_at?: string | null
  remark?: string | null
}

interface UpdateRecordInput {
  equipment_name?: string
  quantity?: number
  location_photo_url?: string | null
  ai_source?: AiSource
  name_source?: NameSource
  recipient?: string | null
  purpose?: string | null
  expected_return_at?: string | null
  remark?: string | null
}

interface ListRecordsFilters {
  type?: RecordType
  equipment_id?: number
  operator_id?: number
  equipment_name?: string
  keyword?: string
  start_date?: string
  end_date?: string
  page?: number
  pageSize?: number
}

type ListRecordsResult = PaginatedResult<Record> & {
  has_more: boolean
}

type RecordListRow = Record & {
  equipment_name?: string
  operator_name?: string
}

interface AttachPhotoInput {
  url: string
  kind: PhotoKind
  annotation_json?: string | null
  sort_order?: number
}

const VALID_TYPES: RecordType[] = ['in', 'out']
const VALID_PHOTO_KINDS: PhotoKind[] = ['product', 'location', 'annotated', 'video']

function getOrCreateEquipment(name: string): { id: number; name: string } {
  name = name.trim()
  if (!name) {
    throw new ValidationError('器材名称不能为空')
  }
  const existing = db
    .prepare('SELECT id, name FROM equipments WHERE name = ?')
    .get(name) as { id: number; name: string } | undefined
  if (existing) {
    return existing
  }
  const result = db
    .prepare('INSERT INTO equipments (name, category_id, threshold, is_active) VALUES (?, NULL, 0, 1)')
    .run(name)
  return { id: result.lastInsertRowid as number, name }
}

function getEquipmentStock(equipmentId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) as stock
       FROM records WHERE equipment_id = ?`
    )
    .get(equipmentId) as { stock: number }
  return row.stock
}

export function createRecord(input: CreateRecordInput, operatorId: number): Record {
  if (!VALID_TYPES.includes(input.type)) {
    throw new ValidationError('type 必须为 in 或 out')
  }
  const qty = Number(input.quantity)
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ValidationError('quantity 必须为正数')
  }

  // 事务包裹：getOrCreateEquipment → checkStock → INSERT record → writeLog
  // better-sqlite3 transaction 同步串行执行，等价 SERIALIZABLE，
  // 保证并发出库不会读到中间态库存、日志失败时整笔回滚
  const create = db.transaction((): { record: Record; eq: { id: number; name: string } } => {
    const eq = getOrCreateEquipment(input.equipment_name)

    if (input.type === 'out') {
      const stock = getEquipmentStock(eq.id)
      if (qty > stock) {
        throw new ConflictError(`库存不足：当前库存 ${stock}，出库数量 ${qty}`)
      }
    }

    const result = db
      .prepare(
        `INSERT INTO records
          (equipment_id, type, quantity, operator_id, location_photo_url,
           ai_source, name_source, recipient, purpose, expected_return_at, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eq.id,
        input.type,
        qty,
        operatorId,
        input.location_photo_url ?? null,
        input.ai_source ?? null,
        input.name_source ?? 'manual',
        input.recipient ?? null,
        input.purpose ?? null,
        input.expected_return_at ?? null,
        input.remark ?? null
      )

    const record = db.prepare('SELECT * FROM records WHERE id = ?').get(
      result.lastInsertRowid
    ) as Record
    writeLog({
      actorId: operatorId,
      action: 'record.create',
      entity: 'record',
      entityId: record.id,
      after: record,
    })
    return { record, eq }
  })

  const { record, eq } = create()

  const operator = db
    .prepare('SELECT name FROM users WHERE id = ?')
    .get(operatorId) as { name: string } | undefined
  void notifyRecordEvent({
    type: input.type,
    equipment_name: eq.name,
    quantity: qty,
    operator_name: operator?.name || '',
  }).catch((e) =>
    console.warn('[notification] createRecord notify failed:', (e as Error).message)
  )

  return record
}

export function listRecords(filters: ListRecordsFilters): ListRecordsResult {
  const page = filters.page && filters.page > 0 ? filters.page : 1
  const rawPageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20
  const pageSize = Math.min(Math.max(rawPageSize, 1), 100)

  const where: string[] = []
  const params: unknown[] = []
  // type 必须是 'in' 或 'out'，其它值（含字符串 "undefined"）一律忽略
  if (filters.type === 'in' || filters.type === 'out') {
    where.push('r.type = ?')
    params.push(filters.type)
  }
  if (filters.equipment_id) {
    where.push('r.equipment_id = ?')
    params.push(filters.equipment_id)
  }
  if (filters.operator_id) {
    where.push('r.operator_id = ?')
    params.push(filters.operator_id)
  }
  // 兼容前端 equipment_name 与 keyword 两种参数，统一按器材名模糊匹配
  const kw = (filters.keyword && filters.keyword.trim())
    || (filters.equipment_name && filters.equipment_name.trim())
  if (kw) {
    where.push('e.name LIKE ?')
    params.push(`%${kw}%`)
  }
  // 时间范围筛选：按 created_at 过滤
  // created_at 以 datetime('now','+8 hours') 存储（北京时间 naive 字符串），
  // 前端传入的 start_date/end_date 为 YYYY-MM-DD（本地日期），
  // 直接字符串比较即可，避免 '+8 hours' 再偏移导致 0-8 点记录被漏掉
  if (filters.start_date && filters.start_date.trim()) {
    // start_date 取当天 00:00:00 起
    where.push('r.created_at >= ?')
    params.push(`${filters.start_date.trim()} 00:00:00`)
  }
  if (filters.end_date && filters.end_date.trim()) {
    // end_date 取当天 23:59:59 止
    where.push('r.created_at <= ?')
    params.push(`${filters.end_date.trim()} 23:59:59`)
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM records r LEFT JOIN equipments e ON r.equipment_id = e.id ${whereClause}`
      )
      .get(...params) as { c: number }
  ).c

  const list = db
    .prepare(
      `SELECT r.*, e.name as equipment_name, u.name as operator_name
       FROM records r
       LEFT JOIN equipments e ON r.equipment_id = e.id
       LEFT JOIN users u ON r.operator_id = u.id
       ${whereClause}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as RecordListRow[]

  const has_more = total > page * pageSize
  return { list, total, page, pageSize, has_more }
}

export function getRecordById(id: number): (Record & {
  equipment: { id: number; name: string } | null
  operator: { id: number; name: string; role: string } | null
  photos: RecordPhoto[]
  related_logs: LogRow[]
  current_stock: number
}) | null {
  const row = db
    .prepare(
      `SELECT r.*, e.id as eq_id, e.name as eq_name,
              u.id as op_id, u.name as op_name, u.role as op_role
       FROM records r
       LEFT JOIN equipments e ON r.equipment_id = e.id
       LEFT JOIN users u ON r.operator_id = u.id
       WHERE r.id = ?`
    )
    .get(id) as
    | (Record & {
        eq_id: number
        eq_name: string
        op_id: number
        op_name: string
        op_role: string
      })
    | undefined

  if (!row) return null

  const photos = db
    .prepare('SELECT * FROM record_photos WHERE record_id = ? ORDER BY sort_order ASC, id ASC')
    .all(id) as RecordPhoto[]

  const related_logs = db
    .prepare(
      `SELECT l.*, u.name as actor_name
       FROM logs l
       LEFT JOIN users u ON l.actor_id = u.id
       WHERE l.entity = 'record' AND l.entity_id = ?
       ORDER BY l.created_at ASC, l.id ASC`
    )
    .all(id) as LogRow[]

  const current_stock = getEquipmentStock(row.eq_id)

  const { eq_id, eq_name, op_id, op_name, op_role, ...record } = row
  return {
    ...record,
    equipment: eq_id ? { id: eq_id, name: eq_name } : null,
    operator: op_id ? { id: op_id, name: op_name, role: op_role } : null,
    photos,
    related_logs,
    current_stock,
  }
}

export function updateRecord(
  id: number,
  input: UpdateRecordInput,
  operatorId: number
): Record {
  const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record | undefined
  if (!existing) {
    throw new NotFoundError('记录不存在')
  }

  // 事务包裹：校验 + UPDATE record + writeLog 原子化，
  // 避免更新与日志之间的中间态被并发请求读到
  const update = db.transaction((): Record => {
    const fields: string[] = []
    const params: unknown[] = []

    if (input.equipment_name !== undefined) {
      if (!input.equipment_name.trim()) {
        throw new ValidationError('器材名称不能为空')
      }
      const eq = getOrCreateEquipment(input.equipment_name)
      fields.push('equipment_id = ?')
      params.push(eq.id)
    }

    if (input.quantity !== undefined) {
      const qty = Number(input.quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ValidationError('quantity 必须为正数')
      }

      if (existing.type === 'out') {
        const currentStock = getEquipmentStock(existing.equipment_id)
        const delta = qty - existing.quantity
        if (delta > 0 && delta > currentStock) {
          throw new ConflictError(`库存不足：当前库存 ${currentStock}，需要增加出库数量 ${delta}`)
        }
      }

      fields.push('quantity = ?')
      params.push(qty)
    }

    if (input.location_photo_url !== undefined) {
      fields.push('location_photo_url = ?')
      params.push(input.location_photo_url)
    }
    if (input.ai_source !== undefined) {
      fields.push('ai_source = ?')
      params.push(input.ai_source)
    }
    if (input.name_source !== undefined) {
      fields.push('name_source = ?')
      params.push(input.name_source)
    }
    if (input.recipient !== undefined) {
      fields.push('recipient = ?')
      params.push(input.recipient)
    }
    if (input.purpose !== undefined) {
      fields.push('purpose = ?')
      params.push(input.purpose)
    }
    if (input.expected_return_at !== undefined) {
      fields.push('expected_return_at = ?')
      params.push(input.expected_return_at)
    }
    if (input.remark !== undefined) {
      fields.push('remark = ?')
      params.push(input.remark)
    }

    if (fields.length === 0) {
      throw new ValidationError('没有需要更新的字段')
    }
    fields.push("updated_at = datetime('now','+8 hours')")
    params.push(id)

    db.prepare(`UPDATE records SET ${fields.join(', ')} WHERE id = ?`).run(...params)

    const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record
    writeLog({
      actorId: operatorId,
      action: 'record.update',
      entity: 'record',
      entityId: id,
      before: existing,
      after: updated,
    })
    return updated
  })

  const updated = update()

  if (input.quantity !== undefined) {
    const eq = db
      .prepare('SELECT name FROM equipments WHERE id = ?')
      .get(updated.equipment_id) as { name: string } | undefined
    const operator = db
      .prepare('SELECT name FROM users WHERE id = ?')
      .get(operatorId) as { name: string } | undefined
    void notifyRecordEvent({
      type: updated.type,
      equipment_name: eq?.name || '',
      quantity: Number(updated.quantity),
      operator_name: operator?.name || '',
    }).catch((e) =>
      console.warn('[notification] updateRecord notify failed:', (e as Error).message)
    )
  }

  return updated
}

export function deleteRecord(id: number, operatorId: number): void {
  const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record | undefined
  if (!existing) {
    throw new NotFoundError('记录不存在')
  }

  // 事务包裹：库存校验 + DELETE record + writeLog 原子化。
  // 库存由 records 动态 SUM 计算，删除 record 即自动恢复库存；
  // 事务保证校验与删除之间无并发写入，日志失败时整笔回滚
  db.transaction(() => {
    const currentStock = getEquipmentStock(existing.equipment_id)

    if (existing.type === 'in') {
      if (currentStock - existing.quantity < 0) {
        throw new ConflictError(`删除后库存将为负数：当前库存 ${currentStock}，入库数量 ${existing.quantity}`)
      }
    }

    const newStock = existing.type === 'in' ? currentStock - existing.quantity : currentStock + existing.quantity

    db.prepare('DELETE FROM records WHERE id = ?').run(id)
    writeLog({
      actorId: operatorId,
      action: existing.type === 'out' ? 'record.delete.out' : 'record.delete',
      entity: 'record',
      entityId: id,
      before: existing,
      after: { new_stock: newStock },
    })
  })()
}

interface RecordStats {
  total_in: number
  total_out: number
  current_stock: number
}

export function getRecordStats(): RecordStats {
  const inRow = db
    .prepare("SELECT COALESCE(SUM(quantity),0) as total FROM records WHERE type = 'in'")
    .get() as { total: number }
  const outRow = db
    .prepare("SELECT COALESCE(SUM(quantity),0) as total FROM records WHERE type = 'out'")
    .get() as { total: number }

  const total_in = inRow.total
  const total_out = outRow.total
  const current_stock = total_in - total_out

  return { total_in, total_out, current_stock }
}

export function getEquipmentList(): Array<{ id: number; name: string; stock: number }> {
  return db
    .prepare(
      `SELECT e.id, e.name,
              COALESCE(SUM(CASE WHEN r.type = 'in' THEN r.quantity ELSE -r.quantity END), 0) as stock
       FROM equipments e
       LEFT JOIN records r ON r.equipment_id = e.id
       GROUP BY e.id, e.name
       ORDER BY e.name ASC`
    )
    .all() as Array<{ id: number; name: string; stock: number }>
}

export function getEquipmentStockByName(name: string): number {
  const eq = db
    .prepare('SELECT id FROM equipments WHERE name = ?')
    .get(name) as { id: number } | undefined
  if (!eq) {
    return 0
  }
  return getEquipmentStock(eq.id)
}

export function attachPhotos(recordId: number, photos: AttachPhotoInput[]): RecordPhoto[] {
  const record = db.prepare('SELECT id FROM records WHERE id = ?').get(recordId)
  if (!record) {
    throw new Error('记录不存在')
  }
  for (const p of photos) {
    if (!VALID_PHOTO_KINDS.includes(p.kind)) {
      throw new ValidationError('kind 非法，必须为 product/location/annotated/video')
    }
    if (!p.url) {
      throw new ValidationError('照片 url 不能为空')
    }
  }

  // 事务包裹：count existing → check limit → INSERT all
  // 避免并发追加时数量校验与插入之间产生超限写入
  const insert = db.transaction((): RecordPhoto[] => {
    const existing = db
      .prepare('SELECT kind FROM record_photos WHERE record_id = ?')
      .all(recordId) as Array<{ kind: PhotoKind }>
    const existingNonVideo = existing.filter((p) => p.kind !== 'video').length
    const existingVideo = existing.filter((p) => p.kind === 'video').length

    const newNonVideo = photos.filter((p) => p.kind !== 'video').length
    const newVideo = photos.filter((p) => p.kind === 'video').length

    if (existingNonVideo + newNonVideo > PHOTO_LIMIT) {
      throw new ValidationError(`照片数量超过上限（最多 ${PHOTO_LIMIT} 张）`)
    }
    if (existingVideo + newVideo > VIDEO_LIMIT) {
      throw new ValidationError(`视频数量超过上限（最多 ${VIDEO_LIMIT} 个）`)
    }

    const inserted: RecordPhoto[] = []
    for (const p of photos) {
      const result = db
        .prepare(
          `INSERT INTO record_photos (record_id, url, kind, annotation_json, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(recordId, p.url, p.kind, p.annotation_json ?? null, p.sort_order ?? 0)
      const row = db.prepare('SELECT * FROM record_photos WHERE id = ?').get(
        result.lastInsertRowid
      ) as RecordPhoto
      inserted.push(row)
    }
    return inserted
  })
  return insert()
}

export function detachPhoto(recordId: number, photoId: number): void {
  const photo = db
    .prepare('SELECT * FROM record_photos WHERE id = ? AND record_id = ?')
    .get(photoId, recordId) as RecordPhoto | undefined
  if (!photo) {
    throw new NotFoundError('照片不存在')
  }
  db.prepare('DELETE FROM record_photos WHERE id = ?').run(photoId)
}

/**
 * 替换记录的所有照片（先删后增）
 * - 用于编辑入库记录时，整体覆盖照片列表
 * - 不受"追加后超限"限制，因为先清空再插入
 */
export function replacePhotos(recordId: number, photos: AttachPhotoInput[]): RecordPhoto[] {
  const record = db.prepare('SELECT id FROM records WHERE id = ?').get(recordId)
  if (!record) {
    throw new NotFoundError('记录不存在')
  }
  for (const p of photos) {
    if (!VALID_PHOTO_KINDS.includes(p.kind)) {
      throw new ValidationError('kind 非法，必须为 product/location/annotated/video')
    }
    if (!p.url) {
      throw new ValidationError('照片 url 不能为空')
    }
  }
  const newNonVideo = photos.filter((p) => p.kind !== 'video').length
  const newVideo = photos.filter((p) => p.kind === 'video').length
  if (newNonVideo > PHOTO_LIMIT) {
    throw new ValidationError(`照片数量超过上限（最多 ${PHOTO_LIMIT} 张）`)
  }
  if (newVideo > VIDEO_LIMIT) {
    throw new ValidationError(`视频数量超过上限（最多 ${VIDEO_LIMIT} 个）`)
  }

  // 事务内：先删除所有旧照片，再插入新照片
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM record_photos WHERE record_id = ?').run(recordId)
    const inserted: RecordPhoto[] = []
    for (const p of photos) {
      const result = db
        .prepare(
          `INSERT INTO record_photos (record_id, url, kind, annotation_json, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(recordId, p.url, p.kind, p.annotation_json ?? null, p.sort_order ?? 0)
      const row = db.prepare('SELECT * FROM record_photos WHERE id = ?').get(
        result.lastInsertRowid
      ) as RecordPhoto
      inserted.push(row)
    }
    return inserted
  })
  return tx()
}

export function getEquipmentInRecords(name: string, page: number = 1, pageSize: number = 20): {
  list: Array<{
    id: number
    equipment_name: string
    quantity: number
    created_at: string
    photos: RecordPhoto[]
  }>
  total: number
} {
  const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)

  const eq = db
    .prepare('SELECT id, name FROM equipments WHERE name = ?')
    .get(name) as { id: number; name: string } | undefined
  if (!eq) {
    return { list: [], total: 0 }
  }

  const total = (
    db
      .prepare('SELECT COUNT(*) as c FROM records WHERE equipment_id = ? AND type = ?')
      .get(eq.id, 'in') as { c: number }
  ).c

  const records = db
    .prepare(
      `SELECT id, equipment_id, quantity, created_at
       FROM records
       WHERE equipment_id = ? AND type = 'in'
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(eq.id, safePageSize, (safePage - 1) * safePageSize) as Array<{ id: number; equipment_id: number; quantity: number; created_at: string }>

  // 批量查询照片，避免 N+1：分页 20 条原先触发 20 次 SQL
  const recordIds = records.map((r) => r.id)
  const photosByRecord = new Map<number, RecordPhoto[]>()
  if (recordIds.length > 0) {
    const placeholders = recordIds.map(() => '?').join(',')
    const allPhotos = db
      .prepare(
        `SELECT * FROM record_photos WHERE record_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`
      )
      .all(...recordIds) as RecordPhoto[]
    for (const p of allPhotos) {
      const arr = photosByRecord.get(p.record_id)
      if (arr) {
        arr.push(p)
      } else {
        photosByRecord.set(p.record_id, [p])
      }
    }
  }

  const list = records.map((r) => ({
    id: r.id,
    equipment_name: eq.name,
    quantity: r.quantity,
    created_at: r.created_at,
    photos: photosByRecord.get(r.id) ?? [],
  }))

  return { list, total }
}

export default {
  createRecord,
  listRecords,
  getRecordById,
  updateRecord,
  deleteRecord,
  getRecordStats,
  getEquipmentList,
  getEquipmentStockByName,
  getEquipmentInRecords,
  attachPhotos,
  replacePhotos,
  detachPhoto,
}
