import request from './request'
import type { RecordType } from '@/types'

export type NameSource = 'search' | 'manual'
export type AiSource = 'ai' | 'semantic' | 'fallback_text'
export type PhotoKind = 'product' | 'location' | 'annotated' | 'video'

export interface CreateRecordInput {
  equipment_name: string
  type: RecordType
  quantity: number
  location_photo_url?: string | null
  ai_source?: AiSource | null
  name_source?: NameSource
  recipient?: string | null
  purpose?: string | null
  expected_return_at?: string | null
  remark?: string | null
}

export interface UpdateRecordInput {
  equipment_name?: string
  quantity?: number
  location_photo_url?: string | null
  ai_source?: AiSource | null
  name_source?: NameSource
  recipient?: string | null
  purpose?: string | null
  expected_return_at?: string | null
  remark?: string | null
}

export interface AttachPhotoInput {
  url: string
  thumbnail_url?: string | null
  kind: PhotoKind
  annotation_json?: string | null
  sort_order?: number
}

export interface RecordPhoto {
  id: number
  record_id: number
  url: string
  kind: PhotoKind
  annotation_json?: string | null
  sort_order: number
  created_at: string
}

export interface RecordRelatedLog {
  id: number
  actor_id?: number | null
  action: string
  entity: string
  entity_id?: number | null
  before_json?: string | null
  after_json?: string | null
  ip?: string | null
  user_agent?: string | null
  created_at: string
  actor_name?: string | null
}

export interface RecordListItem {
  id: number
  equipment_id: number
  type: RecordType
  quantity: number
  operator_id: number
  operator_name?: string
  equipment_name?: string
  created_at: string
  [key: string]: any
}

export interface RecordDetail {
  id: number
  equipment_id: number
  type: RecordType
  quantity: number
  operator_id: number
  equipment?: {
    id: number
    name: string
  } | null
  operator?: { id: number; name: string; role: string } | null
  photos?: RecordPhoto[]
  related_logs?: RecordRelatedLog[]
  current_stock?: number
  recipient?: string | null
  purpose?: string | null
  expected_return_at?: string | null
  remark?: string | null
  created_at: string
  updated_at?: string
  [key: string]: any
}

export interface RecordStats {
  total_in: number
  total_out: number
  current_stock: number
}

export interface EquipmentItem {
  id: number
  name: string
  stock: number
}

export interface EquipmentListResult {
  list: EquipmentItem[]
}

export interface EquipmentInRecord {
  id: number
  equipment_name: string
  quantity: number
  created_at: string
  photos: RecordPhoto[]
}

export interface EquipmentInRecordsResult {
  list: EquipmentInRecord[]
  total: number
}

export interface ListRecordsParams {
  type?: RecordType
  equipment_id?: number
  operator_id?: number
  equipment_name?: string
  keyword?: string
  start_date?: string
  end_date?: string
  page?: number
  pageSize?: number
}

export interface ListRecordsResult {
  list: RecordListItem[]
  items?: RecordListItem[]
  total: number
  page: number
  pageSize: number
  page_size?: number
  has_more?: boolean
}

export function createRecord(data: CreateRecordInput) {
  return request<RecordDetail>({ url: '/records', method: 'POST', data })
}

export function listRecords(params: ListRecordsParams = {}) {
  return request<ListRecordsResult>({ url: '/records', method: 'GET', data: params })
}

export function getRecordById(id: number) {
  return request<RecordDetail>({ url: `/records/${id}`, method: 'GET' })
}

export function updateRecord(id: number, data: UpdateRecordInput) {
  return request<RecordDetail>({ url: `/records/${id}`, method: 'PUT', data })
}

export function deleteRecord(id: number) {
  return request<void>({ url: `/records/${id}`, method: 'DELETE' })
}

export function attachPhotos(recordId: number, photos: AttachPhotoInput[]) {
  return request<{ list: RecordPhoto[] }>({
    url: `/records/${recordId}/photos`,
    method: 'POST',
    data: { photos }
  })
}

/**
 * 替换记录的所有照片（编辑场景用）
 * - 后端会先删除所有旧照片，再插入新照片
 * - 传入空数组等同于清空所有照片
 */
export function replacePhotos(recordId: number, photos: AttachPhotoInput[]) {
  return request<{ list: RecordPhoto[] }>({
    url: `/records/${recordId}/photos`,
    method: 'PUT',
    data: { photos }
  })
}

export function getRecordStats() {
  return request<RecordStats>({ url: '/records/stats', method: 'GET' })
}

export function getEquipmentList() {
  return request<EquipmentListResult>({ url: '/records/equipments', method: 'GET' })
}

export function getEquipmentInRecords(name: string) {
  return request<EquipmentInRecordsResult>({ url: '/records/equipment-in', method: 'GET', data: { name } })
}
