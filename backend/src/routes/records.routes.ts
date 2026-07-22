import { Router, Request, Response } from 'express'
import authRequired from '../middlewares/auth'
import { requireAdmin, requireEditor, requireViewer } from '../middlewares/role'
import { toInt, toStr } from '../utils/helpers'
import {
  createRecord,
  listRecords,
  getRecordById,
  updateRecord,
  deleteRecord,
  getRecordStats,
  getEquipmentList,
  getEquipmentInRecords,
  attachPhotos,
  replacePhotos,
  detachPhoto,
} from '../services/record.service'
import { writeLog } from '../services/log.service'
import { RecordType } from '../types'

const router = Router()

router.use(authRequired)

router.get('/stats', requireViewer, (_req: Request, res: Response) => {
  const stats = getRecordStats()
  res.json({ code: 0, message: 'ok', data: stats })
})

router.get('/equipments', requireViewer, (_req: Request, res: Response) => {
  const list = getEquipmentList()
  res.json({ code: 0, message: 'ok', data: { list } })
})

router.get('/equipment-in', requireViewer, (req: Request, res: Response) => {
  const name = toStr(req.query.name)
  if (!name) {
    res.status(400).json({ code: 400, message: '器材名称不能为空' })
    return
  }
  const page = toInt(req.query.page, 1)
  const pageSize = toInt(req.query.pageSize, 20)
  const result = getEquipmentInRecords(name, page, pageSize)
  res.json({ code: 0, message: 'ok', data: result })
})

router.post('/', requireViewer, (req: Request, res: Response) => {
  const b = req.body || {}
  const record = createRecord(
    {
      equipment_name: String(b.equipment_name || ''),
      type: b.type as RecordType,
      quantity: b.quantity,
      location_photo_url: b.location_photo_url,
      ai_source: b.ai_source,
      name_source: b.name_source,
      recipient: b.recipient,
      purpose: b.purpose,
      expected_return_at: b.expected_return_at,
      remark: b.remark,
    },
    req.user!.id
  )
  res.status(201).json({ code: 0, message: 'ok', data: record })
})

router.get('/', requireViewer, (req: Request, res: Response) => {
  const {
    type,
    equipment_id,
    operator_id,
    equipment_name,
    keyword,
    start_date,
    end_date,
    page,
    page_size,
    pageSize,
  } = req.query
  const pageSizeParam = page_size ?? pageSize
  const result = listRecords({
    type: (type as RecordType | undefined) || undefined,
    equipment_id: equipment_id ? toInt(equipment_id, 0) : undefined,
    operator_id: operator_id ? toInt(operator_id, 0) : undefined,
    equipment_name: toStr(equipment_name),
    keyword: toStr(keyword),
    start_date: toStr(start_date),
    end_date: toStr(end_date),
    page: toInt(page, 1),
    pageSize: toInt(pageSizeParam, 20),
  })
  res.json({
    code: 0,
    message: 'ok',
    data: {
      list: result.list,
      items: result.list,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      page_size: result.pageSize,
      has_more: result.has_more,
    },
  })
})

router.get('/:id', requireViewer, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法记录 id' })
    return
  }
  const record = getRecordById(id)
  if (!record) {
    res.status(404).json({ code: 404, message: '记录不存在' })
    return
  }
  // V-1/V-5 BOLA 修复：related_logs 含 IP/UA/审计历史，仅 admin/editor 可见
  // viewer 角色在装备管理场景下需读记录详情（运维透明度），但不应看到审计日志
  if (req.user!.role === 'viewer') {
    record.related_logs = []
  }
  res.json({ code: 0, message: 'ok', data: record })
})

router.put('/:id', requireViewer, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法记录 id' })
    return
  }
  const b = req.body || {}
  const updated = updateRecord(
    id,
    {
      equipment_name: b.equipment_name !== undefined ? String(b.equipment_name) : undefined,
      quantity: b.quantity,
      location_photo_url: b.location_photo_url,
      ai_source: b.ai_source,
      name_source: b.name_source,
      recipient: b.recipient,
      purpose: b.purpose,
      expected_return_at: b.expected_return_at,
      remark: b.remark,
    },
    req.user!.id
  )
  res.json({ code: 0, message: 'ok', data: updated })
})

router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法记录 id' })
    return
  }
  deleteRecord(id, req.user!.id)
  res.json({ code: 0, message: 'ok' })
})

router.post('/:id/photos', requireViewer, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法记录 id' })
    return
  }
  const photos = (req.body || {}).photos
  if (!Array.isArray(photos) || photos.length === 0) {
    res.status(400).json({ code: 400, message: 'photos 不能为空' })
    return
  }
  const inserted = attachPhotos(id, photos)
  writeLog({
    actorId: req.user!.id,
    action: 'record.attach_photos',
    entity: 'record',
    entityId: id,
    after: { count: inserted.length },
  })
  res.status(201).json({ code: 0, message: 'ok', data: { list: inserted } })
})

/**
 * PUT /:id/photos 替换记录的所有照片（编辑场景用）
 * Body: { photos: AttachPhotoInput[] }
 * - photos 为空数组时，等同于清空所有照片
 */
router.put('/:id/photos', requireViewer, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法记录 id' })
    return
  }
  const photos = (req.body || {}).photos
  if (!Array.isArray(photos)) {
    res.status(400).json({ code: 400, message: 'photos 必须是数组' })
    return
  }
  const inserted = replacePhotos(id, photos)
  writeLog({
    actorId: req.user!.id,
    action: 'record.replace_photos',
    entity: 'record',
    entityId: id,
    after: { count: inserted.length },
  })
  res.json({ code: 0, message: 'ok', data: { list: inserted } })
})

router.delete('/:id/photos/:photoId', requireViewer, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  const photoId = toInt(req.params.photoId, NaN)
  if (!Number.isFinite(id) || !Number.isFinite(photoId)) {
    res.status(400).json({ code: 400, message: '非法 id' })
    return
  }
  detachPhoto(id, photoId)
  writeLog({
    actorId: req.user!.id,
    action: 'record.detach_photo',
    entity: 'record_photo',
    entityId: photoId,
  })
  res.json({ code: 0, message: 'ok' })
})

export default router