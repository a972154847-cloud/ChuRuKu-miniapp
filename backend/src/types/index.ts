import { Request } from 'express'

/** 统一 API 响应结构 */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data?: T
}

/** 分页结果 */
export interface PaginatedResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 角色枚举 */
export type Role = 'admin' | 'editor' | 'viewer'

/** 鉴权后挂载到 req.user 的用户信息 */
export interface AuthUser {
  id: number
  openid: string
  name: string
  role: Role
}

/** 扩展 Request 携带用户信息（鉴权中间件填充） */
export interface AuthedRequest extends Request {
  user?: AuthUser
}

/**
 * Module augmentation：让 express 的 Request 直接携带 user 字段，
 * 避免在每个路由 handler 中手动转换为 AuthedRequest。
 * 与 AuthedRequest 并存，向后兼容。
 */
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser
  }
}

/** 用户 */
export interface User {
  id: number
  openid: string
  name: string
  role: Role
  avatar?: string | null
  created_at: string
  updated_at: string
}

/** 器材分类（两级树形） */
export interface Category {
  id: number
  parent_id: number | null
  code: string
  name: string
  level: number
  sort_order: number
  created_at: string
}

/** 器材库项 */
export interface Equipment {
  id: number
  name: string
  // P2-4: category_id 可空（007 迁移已支持），前端选择"未分类"时存 NULL
  category_id: number | null
  spec?: string | null
  image_url?: string | null
  scrap_years?: number | null
  threshold: number
  is_active: number
  created_at: string
  updated_at: string
}

export type RecordType = 'in' | 'out'
export type AiSource = 'ai' | 'semantic' | 'fallback_text' | null
export type NameSource = 'search' | 'manual'

/** 出入库记录 */
export interface Record {
  id: number
  equipment_id: number
  type: RecordType
  quantity: number
  operator_id: number
  produced_at?: string | null
  location_photo_url?: string | null
  ai_source?: AiSource
  name_source?: NameSource
  recipient?: string | null
  purpose?: string | null
  expected_return_at?: string | null
  remark?: string | null
  created_at: string
  updated_at: string
}

export type PhotoKind = 'product' | 'location' | 'annotated' | 'video'

/** 记录关联照片 */
export interface RecordPhoto {
  id: number
  record_id: number
  url: string
  thumbnail_url?: string | null
  kind: PhotoKind
  annotation_json?: string | null
  sort_order: number
  created_at: string
}

/** 操作日志（append-only） */
export interface LogEntry {
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
}
