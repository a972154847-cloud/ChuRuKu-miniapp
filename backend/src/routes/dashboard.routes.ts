import { Router, Request, Response } from 'express'
import authRequired from '../middlewares/auth'
import {
  getDashboardOverview,
  getLowStock,
  getExpiry,
  getDashboardActivities,
} from '../services/dashboard.service'

const router = Router()

// 仪表盘所有接口都需要登录
router.use(authRequired)

/**
 * GET / 综合仪表盘数据（viewer 及以上均可查看）
 * Query: days=7|30，切换 trend 字段指向的趋势时间范围（默认 7）
 * 返回：totals / byCategory / trend7d / trend30d / trend / categoryRatio / lowStock / expiringSoon / expired
 */
router.get('/', (req: Request, res: Response) => {
  const raw = parseInt(String(req.query.days), 10)
  const days = raw === 30 ? 30 : 7
  const data = getDashboardOverview(days)
  res.json({ code: 0, message: 'ok', data })
})

/**
 * GET /low-stock 低库存预警列表（quantity < threshold）
 * 单独接口便于前端刷新
 */
router.get('/low-stock', (_req: Request, res: Response) => {
  const list = getLowStock()
  res.json({ code: 0, message: 'ok', data: { list } })
})

/**
 * GET /expiring 过期 / 即将过期器材清单
 * 返回：{ list, expired, expiringSoon }
 */
router.get('/expiring', (_req: Request, res: Response) => {
  const { list, expired, expiringSoon } = getExpiry()
  res.json({ code: 0, message: 'ok', data: { list, expired, expiringSoon } })
})

/**
 * GET /activities 最近系统活动动态
 * 返回最近 20 条系统操作记录（含操作人、操作类型、时间）
 */
router.get('/activities', (_req: Request, res: Response) => {
  const list = getDashboardActivities()
  res.json({ code: 0, message: 'ok', data: { list } })
})

export default router
