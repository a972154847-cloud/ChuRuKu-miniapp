import request from './request'

/** 分类节点 */
export interface Category {
  id: number
  parent_id: number | null
  code: string
  name: string
  level: number
  sort_order?: number
  created_at?: string
}

/** 分类树节点（一级带 children） */
export interface CategoryTreeNode extends Category {
  children?: Category[]
}

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

/** 创建分类入参 */
export interface CreateCategoryInput {
  name: string
  code: string
  parent_id?: number | null
  level?: number
  sort_order?: number
}

/** 修改分类入参 */
export interface UpdateCategoryInput {
  name?: string
  code?: string
  parent_id?: number | null
  level?: number
  sort_order?: number
}

/**
 * 分类树（GET /categories，viewer 及以上）
 * 一级节点带 children 嵌套
 */
export function listCategoriesTree() {
  return request<CategoryTreeNode[]>({
    url: '/categories',
    method: 'GET'
  })
}

/**
 * 扁平分类列表（GET /categories/flat，viewer 及以上）
 */
export function listCategoriesFlat() {
  return request<Category[]>({
    url: '/categories/flat',
    method: 'GET'
  })
}

/**
 * 自动分类建议（POST /categories/auto-suggest，viewer 及以上）
 * - 命中关键词返回 suggestions
 * - 无命中返回 { suggestions: [], fallback: 'manual' }
 */
export function autoSuggestCategories(description: string, equipmentName?: string) {
  return request<AutoSuggestResult>({
    url: '/categories/auto-suggest',
    method: 'POST',
    data: { description, equipment_name: equipmentName }
  })
}

/**
 * 创建分类（POST /categories，admin）
 */
export function createCategory(data: CreateCategoryInput) {
  return request<Category>({
    url: '/categories',
    method: 'POST',
    data
  })
}

/**
 * 修改分类（PATCH /categories/:id，admin）
 */
export function updateCategory(id: number, data: UpdateCategoryInput) {
  return request<Category>({
    url: `/categories/${id}`,
    method: 'PATCH',
    data
  })
}

/**
 * 删除分类（DELETE /categories/:id，admin）
 * - 有子分类 → 始终 400（必须先删除子分类）
 * - 有关联器材：
 *   - force=false（默认）→ 400，response.has_equipments=true
 *   - force=true → 解除关联器材（category_id 设为 NULL），然后删除分类
 */
export function deleteCategory(id: number, force: boolean = false) {
  return request<void>({
    url: `/categories/${id}${force ? '?force=true' : ''}`,
    method: 'DELETE'
  })
}
