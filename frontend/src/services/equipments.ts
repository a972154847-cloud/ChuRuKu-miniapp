import request from './request'

/** 器材库存列表项 */
export interface EquipmentStockItem {
  id: number
  name: string
  spec: string | null
  category_id: number | null
  category_name: string | null
  image_url: string | null
  scrap_years: number | null
  threshold: number | null
  is_active: number
  current_stock: number
  created_at: string
  updated_at: string
}

/** 列表查询参数 */
export interface ListEquipmentsParams {
  keyword?: string
  page?: number
  pageSize?: number
}

/** 列表查询返回 */
export interface ListEquipmentsResult {
  list: EquipmentStockItem[]
  total: number
  page: number
  pageSize: number
}

/** 器材库存列表 */
export function listEquipments(params: ListEquipmentsParams = {}) {
  return request<ListEquipmentsResult>({
    url: '/equipments',
    method: 'GET',
    data: params,
  })
}
/**
 * 器材（带分类信息）——供 EquipmentPicker 搜索使用
 * 与 EquipmentStockItem 区别：这里只关心选择器需要的字段
 */
export interface EquipmentWithCategory {
  id: number
  name: string
  spec?: string | null
  category_id?: number | null
  category_name?: string | null
}

/** 搜索结果返回 */
export interface SearchEquipmentsResult {
  list: EquipmentWithCategory[]
  total: number
}

/**
 * 按关键字搜索器材（供 EquipmentPicker 使用）
 * 复用 /equipments 列表接口的 keyword 参数，提取选择器需要的字段
 */
export function searchEquipments(keyword: string): Promise<SearchEquipmentsResult> {
  return listEquipments({ keyword, page: 1, pageSize: 50 }).then((res) => {
    const list: EquipmentWithCategory[] = (res.list || []).map((item) => ({
      id: item.id,
      name: item.name,
      spec: item.spec,
      category_id: item.category_id,
      category_name: item.category_name,
    }))
    return { list, total: res.total || list.length }
  })
}
