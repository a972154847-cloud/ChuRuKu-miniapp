import request from './request'
import type { Role, User } from '@/types'

export interface UserListParams {
  role?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export interface UserListResult {
  list: User[]
  total: number
  page: number
  pageSize: number
}

export function listUsers(params: UserListParams) {
  return request<UserListResult>({ url: '/users', method: 'GET', data: params })
}

export function getUserById(id: number) {
  return request<User>({ url: `/users/${id}`, method: 'GET' })
}

export function updateUserRole(id: number, role: Role) {
  return request<User>({
    url: `/users/${id}/role`,
    method: 'PATCH',
    data: { role }
  })
}

export function updateUserProfile(id: number, data: { name?: string; avatar?: string }) {
  return request<User>({
    url: `/users/${id}/profile`,
    method: 'PATCH',
    data
  })
}
