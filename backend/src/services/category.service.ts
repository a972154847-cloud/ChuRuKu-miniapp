import db from '../db'
import { writeLog } from './log.service'
import { Category } from '../types'
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors'

/** 分类树节点（一级带 children） */
export interface CategoryTreeNode extends Omit<Category, 'parent_id'> {
  parent_id: number | null
  children?: CategoryTreeNode[]
}

/** 扁平列表行 */
export type CategoryFlat = Category

/** 自动分类建议项 */
export interface CategorySuggestion {
  category_id: number
  category_name: string
  category_code: string
  confidence: number
  reason: string
}

/** 自动分类返回结构 */
export interface AutoSuggestResult {
  suggestions: CategorySuggestion[]
  fallback?: 'manual'
}

/**
 * 关键词字典：key 是 category code（二级子类），value 是该分类的匹配关键词列表。
 * 基于 002_categories.sql 真实 code 设计，覆盖 5 大类的所有子类。
 * 运行时通过查表把 code 转成 id / name。
 */
const KEYWORD_DICT: Record<string, string[]> = {
  // 灭火器类
  PORTABLE_POWDER: ['干粉', 'ABC', 'BC', '磷酸铵盐', '碳酸氢钠'],
  PORTABLE_CO2: ['二氧化碳', 'CO2'],
  PORTABLE_WATER: ['水基', '水雾', '清水', '阻燃'],
  PORTABLE_CLEAN_GAS: ['洁净气体', '六氟丙烷', 'HFC'],
  CART_EXTINGUISHER: ['推车', '推车式'],
  // 建筑消防设施类
  FIRE_ALARM: ['报警', '火灾报警', '感烟', '感温', '探测器', '报警按钮'],
  HYDRANT_SYSTEM: ['消火栓', '消防栓', '水带', '栓'],
  SMOKE_CONTROL: ['防排烟', '排烟', '风机', '送风'],
  FIRE_SEPARATION: ['防火门', '防火卷帘', '防火分隔'],
  // 消防装备类
  FIRE_SUIT: ['消防服', '隔热服', '防护服'],
  FIRE_HELMET: ['头盔'],
  FIRE_GLOVES: ['手套'],
  FIRE_BOOTS: ['消防靴', '靴子'],
  AIR_BREATHING_APPARATUS: ['空气呼吸器', '正压式', '气瓶'],
  // 避险逃生类
  SELF_RESCUE_MASK: ['自救呼吸器', '过滤式', '自救'],
  DESCENDER: ['缓降器', '逃生缓降'],
  ESCAPE_MASK: ['逃生面罩', '防毒面具'],
  EMERGENCY_LAMP: ['应急灯', '应急照明灯'],
  // 应急照明与疏散类
  EXIT_SIGN: ['疏散指示', '安全出口', '标志灯'],
  EMERGENCY_LUMINAIRE: ['应急照明灯具', '照明灯'],
}

/** 置信度阈值：低于此值视为不可信，触发手动降级 */
const CONFIDENCE_THRESHOLD = 0.5

/** 最多返回的候选数 */
const MAX_SUGGESTIONS = 5

/**
 * 返回完整分类树（一级带 children 嵌套）。
 * - 按 sort_order 升序、id 升序排序
 * - 一级节点挂载 children（二级），二级不挂载 children（叶子）
 */
export function listCategoriesTree(): CategoryTreeNode[] {
  const all = db
    .prepare(
      `SELECT * FROM categories ORDER BY level ASC, sort_order ASC, id ASC`
    )
    .all() as Category[]

  const roots = all.filter((c) => c.parent_id === null)
  return roots.map((root) => {
    const children = all
      .filter((c) => c.parent_id === root.id)
      .map((child) => ({ ...child }))
    return { ...root, children }
  })
}

/**
 * 返回扁平列表（含一级和二级，按 level + sort_order + id 排序）。
 */
export function listCategoriesFlat(): CategoryFlat[] {
  return db
    .prepare(
      `SELECT * FROM categories ORDER BY level ASC, sort_order ASC, id ASC`
    )
    .all() as CategoryFlat[]
}

/**
 * 基于 AI 描述 + 器材名做关键词匹配，返回分类建议。
 * - 拼接 description + equipmentName 作为待匹配文本
 * - 遍历关键词字典，对每个分类计算命中关键词数
 * - 置信度 = 命中关键词数 / 该分类关键词总数
 * - 最高置信度 < 阈值（0.5）或无命中 → 返回 fallback: 'manual'
 * - 否则按置信度降序返回 Top N（含 reason 说明命中了哪些词）
 */
export function autoSuggestCategories(
  description: string,
  equipmentName?: string
): AutoSuggestResult {
  const text = `${description || ''} ${equipmentName || ''}`.trim()
  if (!text) {
    return { suggestions: [], fallback: 'manual' }
  }

  // 查表：把 code → { id, name }
  const codeMap = new Map<string, { id: number; name: string }>()
  const rows = db.prepare('SELECT id, code, name FROM categories').all() as {
    id: number
    code: string
    name: string
  }[]
  for (const r of rows) {
    codeMap.set(r.code, { id: r.id, name: r.name })
  }

  const candidates: CategorySuggestion[] = []
  for (const [code, keywords] of Object.entries(KEYWORD_DICT)) {
    const meta = codeMap.get(code)
    if (!meta) continue
    const hit: string[] = []
    for (const kw of keywords) {
      if (text.includes(kw)) {
        hit.push(kw)
      }
    }
    if (hit.length === 0) continue
    const confidence = hit.length / keywords.length
    candidates.push({
      category_id: meta.id,
      category_name: meta.name,
      category_code: code,
      confidence: Math.round(confidence * 100) / 100,
      reason: `命中关键词：${hit.join('、')}`,
    })
  }

  if (candidates.length === 0) {
    return { suggestions: [], fallback: 'manual' }
  }

  // 按置信度降序，取 Top N
  candidates.sort((a, b) => b.confidence - a.confidence)
  const top = candidates.slice(0, MAX_SUGGESTIONS)

  // 最高置信度低于阈值 → 降级手动
  if (top[0].confidence < CONFIDENCE_THRESHOLD) {
    return { suggestions: [], fallback: 'manual' }
  }

  return { suggestions: top }
}

/** 创建分类入参 */
export interface CreateCategoryInput {
  name: string
  code: string
  parent_id?: number | null
  level?: number
  sort_order?: number
}

/**
 * 创建分类。
 * - code 唯一，重复抛错
 * - parent_id 提供时校验父分类存在且 level=1（仅支持两级）
 * - level 未提供时按 parent_id 推断（无父=1，有父=2）
 * - 写日志 category.create
 */
export function createCategory(
  input: CreateCategoryInput,
  operatorId: number
): Category {
  const name = (input.name || '').trim()
  const code = (input.code || '').trim()
  if (!name) throw new Error('分类名称不能为空')
  if (!code) throw new Error('分类 code 不能为空')

  // code 唯一性
  const exists = db
    .prepare('SELECT id FROM categories WHERE code = ?')
    .get(code) as { id: number } | undefined
  if (exists) {
    throw new Error(`分类 code "${code}" 已存在`)
  }

  let parentId: number | null = null
  let level = input.level
  if (input.parent_id) {
    const parent = db
      .prepare('SELECT id, level FROM categories WHERE id = ?')
      .get(input.parent_id) as { id: number; level: number } | undefined
    if (!parent) {
      throw new NotFoundError('父分类不存在')
    }
    if (parent.level >= 2) {
      throw new ValidationError('仅支持两级分类树，不能在子分类下再创建子分类')
    }
    parentId = parent.id
    if (level === undefined) level = 2
  } else {
    if (level === undefined) level = 1
  }

  const sortOrder = input.sort_order ?? 0
  const result = db
    .prepare(
      `INSERT INTO categories (parent_id, code, name, level, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(parentId, code, name, level, sortOrder)
  const created = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(result.lastInsertRowid) as Category

  writeLog({
    actorId: operatorId,
    action: 'category.create',
    entity: 'category',
    entityId: created.id,
    after: { name: created.name, code: created.code, parent_id: parentId, level },
  })

  return created
}

/** 修改分类入参（均为可选） */
export interface UpdateCategoryInput {
  name?: string
  code?: string
  parent_id?: number | null
  level?: number
  sort_order?: number
}

/**
 * 修改分类。
 * - 不存在抛错
 * - code 修改时校验唯一
 * - parent_id 修改时校验父分类存在且不能形成环（不能把自己设为自己的父级）
 * - 写日志 category.update（含 before/after）
 */
export function updateCategory(
  id: number,
  input: UpdateCategoryInput,
  operatorId: number
): Category {
  const before = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(id) as Category | undefined
  if (!before) {
    throw new NotFoundError('分类不存在')
  }

  const updates: string[] = []
  const args: unknown[] = []

  if (input.name !== undefined) {
    const name = (input.name || '').trim()
    if (!name) throw new ValidationError('分类名称不能为空')
    updates.push('name = ?')
    args.push(name)
  }

  if (input.code !== undefined) {
    const code = (input.code || '').trim()
    if (!code) throw new Error('分类 code 不能为空')
    // 唯一性校验（排除自身）
    const dup = db
      .prepare('SELECT id FROM categories WHERE code = ? AND id != ?')
      .get(code, id) as { id: number } | undefined
    if (dup) {
      throw new Error(`分类 code "${code}" 已存在`)
    }
    updates.push('code = ?')
    args.push(code)
  }

  if (input.parent_id !== undefined) {
    if (input.parent_id === null) {
      updates.push('parent_id = ?')
      args.push(null)
    } else {
      // 不能把自己设为自己的父级
      if (input.parent_id === id) {
        throw new ValidationError('不能将分类的父级设为自身')
      }
      const parent = db
        .prepare('SELECT id, level FROM categories WHERE id = ?')
        .get(input.parent_id) as { id: number; level: number } | undefined
      if (!parent) {
        throw new NotFoundError('父分类不存在')
      }
      if (parent.level >= 2) {
        throw new ValidationError('仅支持两级分类树，父级必须是一级分类')
      }
      updates.push('parent_id = ?')
      args.push(input.parent_id)
    }
  }

  if (input.level !== undefined) {
    updates.push('level = ?')
    args.push(input.level)
  }

  if (input.sort_order !== undefined) {
    updates.push('sort_order = ?')
    args.push(input.sort_order)
  }

  if (updates.length > 0) {
    args.push(id)
    db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).run(
      ...args
    )
  }

  const after = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(id) as Category

  writeLog({
    actorId: operatorId,
    action: 'category.update',
    entity: 'category',
    entityId: id,
    before: {
      name: before.name,
      code: before.code,
      parent_id: before.parent_id,
      level: before.level,
    },
    after: {
      name: after.name,
      code: after.code,
      parent_id: after.parent_id,
      level: after.level,
    },
  })

  return after
}

/**
 * 删除分类。
 * - 不存在抛错
 * - 有子分类 → 400 错误（提示先删除子分类，即使 force=true 也不允许）
 * - 有关联器材：
 *   - force=false（默认）→ 400 错误（提示先解除器材关联）
 *   - force=true → 把关联器材的 category_id 设为 NULL，然后删除分类
 * - 写日志 category.delete
 */
export function deleteCategory(id: number, operatorId: number, force: boolean = false): void {
  const cat = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(id) as Category | undefined
  if (!cat) {
    throw new NotFoundError('分类不存在')
  }

  // 子分类检查（即使 force=true 也必须先删除子分类）
  const childCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM categories WHERE parent_id = ?')
      .get(id) as { c: number }
  ).c
  if (childCount > 0) {
    throw new ValidationError(`存在 ${childCount} 个子分类，请先删除子分类`)
  }

  // 事务包裹：器材关联解除 + DELETE category + writeLog 原子化，
  // 避免 force=true 时并发请求在解除关联与删除分类之间读到中间态
  db.transaction(() => {
    // 器材关联检查
    const equipCount = (
      db
        .prepare('SELECT COUNT(*) as c FROM equipments WHERE category_id = ?')
        .get(id) as { c: number }
    ).c
    if (equipCount > 0) {
      if (!force) {
        throw new ConflictError(
          `存在 ${equipCount} 个关联器材，请先解除器材关联`,
          { has_equipments: true, equip_count: equipCount }
        )
      }
      // force=true：解除关联，把器材的 category_id 设为 NULL
      db.prepare(
        'UPDATE equipments SET category_id = NULL, updated_at = datetime(\'now\', \'+8 hours\') WHERE category_id = ?'
      ).run(id)
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(id)

    writeLog({
      actorId: operatorId,
      action: 'category.delete',
      entity: 'category',
      entityId: id,
      before: {
        name: cat.name,
        code: cat.code,
        parent_id: cat.parent_id,
        level: cat.level,
      },
      after:
        force && equipCount > 0
          ? { force: true, unlinked_equipments: equipCount }
          : undefined,
    })
  })()
}

export default {
  listCategoriesTree,
  listCategoriesFlat,
  autoSuggestCategories,
  createCategory,
  updateCategory,
  deleteCategory,
}
