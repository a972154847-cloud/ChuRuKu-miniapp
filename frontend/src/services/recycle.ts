import request from './request'

export type EntityType = 'record' | 'category'

export interface RecycleBinItem {
  id: number
  entity_type: EntityType
  entity_id: number
  entity_data: any
  entity_summary: string | null
  deleted_by: number | null
  deleted_by_name: string | null
  deleted_at: string
  restored_at: string | null
}

export interface RecycleListResult {
  list: RecycleBinItem[]
  total: number
  page: number
  pageSize: number
}

/** 查询回收站列表 */
export function listRecycleBin(params?: {
  entity_type?: EntityType
  page?: number
  pageSize?: number
}): Promise<RecycleListResult> {
  return request<RecycleListResult>({
    url: '/recycle',
    method: 'GET',
    data: params,
  })
}

/** 恢复回收站条目 */
export function restoreRecycleItem(id: number): Promise<RecycleBinItem> {
  return request<RecycleBinItem>({
    url: `/recycle/${id}/restore`,
    method: 'POST',
  })
}

/** 永久删除回收站条目 */
export function deleteRecycleItem(id: number): Promise<void> {
  return request<void>({
    url: `/recycle/${id}`,
    method: 'DELETE',
  })
}
