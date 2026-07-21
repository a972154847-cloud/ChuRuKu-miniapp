export type Role = 'admin' | 'editor' | 'viewer'
export type RecordType = 'in' | 'out'

export interface User {
  id: number
  openid: string
  name: string
  role: Role
  avatar?: string
  created_at: string
}

export interface Category {
  id: number
  parent_id: number | null
  code: string
  name: string
  level: number
}

export interface Equipment {
  id: number
  name: string
  category_id: number
  spec?: string
  image_url?: string
  scrap_years?: number
  threshold?: number
}

export interface Record {
  id: number
  equipment_id: number
  type: RecordType
  quantity: number
  operator_id: number
  operator_name?: string
  produced_at?: string
  location_photo_url?: string
  ai_source?: string
  name_source?: string
  created_at: string
}
