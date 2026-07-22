import { Router, Request, Response } from 'express'
import authRequired from '../middlewares/auth'
import { requireViewer, requireEditor } from '../middlewares/role'
import { searchEquipments, getEquipmentDetail } from '../services/equipment.service'
import { toInt, safePageSize } from '../utils/helpers'
import db from '../db'

const router = Router()

router.use(authRequired)

/**
 * GET / 器材列表（viewer 及以上）
 * 返回所有器材（含分类名 + 当前库存），支持分页和关键字搜索。
 * Query: page?, pageSize?, keyword?
 */
router.get('/', requireViewer, (req: Request, res: Response) => {
  const page = toInt(req.query.page, 1)
  const pageSize = safePageSize(req.query.pageSize, 20)
  const keyword = req.query.keyword ? String(req.query.keyword) : undefined

  const where: string[] = ['e.is_active = 1']
  const params: unknown[] = []
  if (keyword) {
    where.push('e.name LIKE ?')
    params.push(`%${keyword}%`)
  }
  const whereClause = 'WHERE ' + where.join(' AND ')

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM equipments e ${whereClause}`).get(...params) as {
      c: number
    }
  ).c
  // 通过子查询计算每个器材的当前库存（入库+，出库-）
  const list = db
    .prepare(
      `SELECT e.*, c.name as category_name,
       COALESCE((
         SELECT SUM(CASE WHEN r.type='in' THEN r.quantity ELSE -r.quantity END)
         FROM records r WHERE r.equipment_id = e.id
       ), 0) AS current_stock
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       ${whereClause}
       ORDER BY e.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize)

  res.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } })
})

/**
 * POST /search 器材搜索（editor 及以上）
 * Body: { keyword: string }
 * 返回候选清单（含 category_name），空关键字返回空列表
 */
router.post('/search', requireEditor, (req: Request, res: Response) => {
  const keyword = (req.body || {}).keyword
  const list = searchEquipments(keyword || '')
  res.json({ code: 0, message: 'ok', data: { list } })
})

/**
 * GET /:id 器材详情（viewer 及以上）
 * 返回器材完整信息（含当前库存 + 最近 10 条出入库记录）
 */
router.get('/:id', requireViewer, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法器材 id' })
    return
  }
  const detail = getEquipmentDetail(id)
  if (!detail) {
    res.status(404).json({ code: 404, message: '器材不存在' })
    return
  }
  res.json({ code: 0, message: 'ok', data: detail })
})

export default router
