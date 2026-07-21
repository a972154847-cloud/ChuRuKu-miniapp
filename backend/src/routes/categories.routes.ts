import { Router, Request, Response } from 'express'
import authRequired from '../middlewares/auth'
import { requireAdmin, requireViewer } from '../middlewares/role'
import { isAppError, NotFoundError, ConflictError } from '../utils/errors'
import {
  listCategoriesTree,
  listCategoriesFlat,
  autoSuggestCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../services/category.service'

const router = Router()

// 全局鉴权：所有分类端点都需要登录
router.use(authRequired)

function toInt(v: unknown, def: number): number {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : def
}

/**
 * GET / 完整分类树（带 children 嵌套）
 * viewer 及以上可访问
 */
router.get('/', requireViewer, (_req: Request, res: Response) => {
  const tree = listCategoriesTree()
  res.json({ code: 0, message: 'ok', data: tree })
})

/**
 * GET /flat 扁平列表
 * viewer 及以上可访问
 * 注意：必须在 /:id 之前注册（当前无 GET /:id，仍保持顺序清晰）
 */
router.get('/flat', requireViewer, (_req: Request, res: Response) => {
  const list = listCategoriesFlat()
  res.json({ code: 0, message: 'ok', data: list })
})

/**
 * POST /auto-suggest 自动分类建议
 * viewer 及以上可访问
 * Body: { description: string, equipment_name?: string }
 * 注意：必须在 /:id 之前注册，避免被 /:id 误匹配
 */
router.post('/auto-suggest', requireViewer, (req: Request, res: Response) => {
  const b = req.body || {}
  const description = typeof b.description === 'string' ? b.description : ''
  const equipmentName =
    typeof b.equipment_name === 'string' ? b.equipment_name : undefined
  const result = autoSuggestCategories(description, equipmentName)
  res.json({ code: 0, message: 'ok', data: result })
})

/**
 * POST / 创建分类（仅 admin）
 * Body: { name, code, parent_id?, level?, sort_order? }
 */
router.post('/', requireAdmin, (req: Request, res: Response) => {
  const b = req.body || {}
  try {
    const created = createCategory(
      {
        name: b.name,
        code: b.code,
        parent_id: b.parent_id ?? null,
        level: b.level,
        sort_order: b.sort_order,
      },
      req.user!.id
    )
    res.status(201).json({ code: 0, message: 'ok', data: created })
  } catch (e) {
    res.status(400).json({ code: 400, message: (e as Error).message })
  }
})

/**
 * PATCH /:id 修改分类（仅 admin）
 * Body: { name?, code?, parent_id?, level?, sort_order? }
 */
router.patch('/:id', requireAdmin, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法分类 id' })
    return
  }
  const b = req.body || {}
  try {
    const updated = updateCategory(
      id,
      {
        name: b.name,
        code: b.code,
        parent_id: b.parent_id,
        level: b.level,
        sort_order: b.sort_order,
      },
      req.user!.id
    )
    res.json({ code: 0, message: 'ok', data: updated })
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('不存在')) {
      res.status(404).json({ code: 404, message: msg })
    } else {
      res.status(400).json({ code: 400, message: msg })
    }
  }
})

/**
 * DELETE /:id 删除分类（仅 admin）
 * - 有子分类 → 400（必须先删除子分类）
 * - 有关联器材：
 *   - 默认 → 400（提示先解除关联），返回 { code: 400, message, has_equipments: true, equip_count }
 *   - ?force=true → 解除关联器材（category_id 设为 NULL），然后删除分类
 */
router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const id = toInt(req.params.id, NaN)
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: 400, message: '非法分类 id' })
    return
  }
  const force = String(req.query.force || '').toLowerCase() === 'true'
  try {
    deleteCategory(id, req.user!.id, force)
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    // P2-10: 用 AppError instanceof 判定替代 msg.includes('不存在') 字符串匹配
    if (e instanceof NotFoundError) {
      res.status(404).json({ code: 404, message: e.message })
    } else if (e instanceof ConflictError) {
      // 关联器材场景（has_equipments 透传）：保持 400 状态码以兼容前端两步确认流程
      // （前端 checkHasEquipments 只看 res.body.has_equipments，不依赖状态码）
      if (e.meta && e.meta.has_equipments) {
        res.status(400).json({ code: 400, message: e.message, ...(e.meta || {}) })
      } else {
        res.status(409).json({ code: 409, message: e.message, ...(e.meta || {}) })
      }
    } else {
      res.status(400).json({ code: 400, message: (e as Error).message })
    }
  }
})

export default router
