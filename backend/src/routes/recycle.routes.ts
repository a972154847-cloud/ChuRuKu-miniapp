/**
 * 回收站路由：查看已删除数据、恢复、永久删除
 *
 * 所有接口仅 admin 可用，恢复/永久删除为高风险操作需谨慎
 */
import { Router, Request, Response } from 'express'
import authRequired from '../middlewares/auth'
import { requirePermission } from '../middlewares/permission'
import { toInt } from '../utils/helpers'
import { isAppError, NotFoundError, ValidationError } from '../utils/errors'
import {
  listRecycleBin,
  restoreItem,
  permanentlyDelete,
} from '../services/recycle.service'

const router = Router()

router.use(authRequired)

/**
 * GET / 回收站列表
 * 可选查询参数：entity_type, page, pageSize
 */
router.get('/', requirePermission('recycle:read'), (req: Request, res: Response) => {
  const entityType = req.query.entity_type as string | undefined
  const page = toInt(req.query.page, 1)
  const pageSize = toInt(req.query.pageSize || req.query.page_size, 20)

  const result = listRecycleBin({
    entity_type: entityType === 'record' || entityType === 'category' ? entityType : undefined,
    page,
    pageSize,
  })

  res.json({
    code: 0,
    message: 'ok',
    data: {
      list: result.list,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    },
  })
})

/**
 * POST /:id/restore 从回收站恢复数据
 */
router.post('/:id/restore', requirePermission('recycle:manage'), (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法回收站 id' })
    return
  }

  try {
    const item = restoreItem(id, req.user!.id)
    res.json({ code: 0, message: 'ok', data: item })
  } catch (e) {
    if (e instanceof NotFoundError) {
      res.status(404).json({ code: 404, message: e.message })
    } else if (e instanceof ValidationError) {
      res.status(400).json({ code: 400, message: e.message })
    } else {
      res.status(500).json({ code: 500, message: (e as Error).message })
    }
  }
})

/**
 * DELETE /:id 从回收站永久删除（不可恢复）
 */
router.delete('/:id', requirePermission('recycle:manage'), (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法回收站 id' })
    return
  }

  try {
    permanentlyDelete(id, req.user!.id)
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e instanceof NotFoundError) {
      res.status(404).json({ code: 404, message: e.message })
    } else {
      res.status(500).json({ code: 500, message: (e as Error).message })
    }
  }
})

export default router
