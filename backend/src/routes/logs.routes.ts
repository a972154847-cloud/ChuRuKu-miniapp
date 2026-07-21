import { Router, Request, Response } from 'express'
import authRequired from '../middlewares/auth'
import { requireAdmin } from '../middlewares/role'
import { listLogs, getLogById, getLogStats } from '../services/log-query.service'

const router = Router()

// 所有日志查询均需登录，且仅 Admin 可访问（操作日志含敏感审计信息）
router.use(authRequired)

function toInt(v: unknown, def: number): number {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : def
}

function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s || undefined
}

/**
 * GET /stats 日志统计（必须在 /:id 之前注册，否则 stats 会被当作 :id）
 */
router.get('/stats', requireAdmin, (_req: Request, res: Response) => {
  const stats = getLogStats()
  res.json({ code: 0, message: 'ok', data: stats })
})

/**
 * GET / 分页查询日志
 * Query: actor_id?, action?, entity?, start_date?, end_date?, page?, page_size?
 */
router.get('/', requireAdmin, (req: Request, res: Response) => {
  const { actor_id, action, entity, start_date, end_date, page, page_size } =
    req.query
  const result = listLogs({
    actor_id: actor_id ? toInt(actor_id, 0) : undefined,
    action: toStr(action),
    entity: toStr(entity),
    start_date: toStr(start_date),
    end_date: toStr(end_date),
    page: toInt(page, 1),
    page_size: toInt(page_size, 20),
  })
  res.json({ code: 0, message: 'ok', data: result })
})

/**
 * GET /:id 单条日志详情
 */
router.get('/:id', requireAdmin, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法日志 id' })
    return
  }
  const log = getLogById(id)
  if (!log) {
    res.status(404).json({ code: 404, message: '日志不存在' })
    return
  }
  res.json({ code: 0, message: 'ok', data: log })
})

export default router
