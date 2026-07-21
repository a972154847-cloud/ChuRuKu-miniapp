import request from './request'
import type { Role, User } from '@/types'

export interface LoginResult {
  token: string
  user: User
}

export type LoginRole = Role

/**
 * 微信登录：用 Taro.login 拿到 code，提交后端换 token
 */
export function wxLogin(code: string, nickname?: string, avatar?: string) {
  return request<LoginResult>({
    url: '/auth/login',
    method: 'POST',
    data: { code, nickname, avatar }
  })
}

/**
 * 开发登录：H5/测试环境用，免 wx code，可直接指定角色
 */
export function devLogin(
  openid?: string,
  name?: string,
  role?: LoginRole
) {
  return request<LoginResult>({
    url: '/auth/dev-login',
    method: 'POST',
    data: { openid, name, role }
  })
}

/**
 * 获取当前登录用户（依据 token）
 */
export function getCurrentUser() {
  return request<User>({ url: '/users/me', method: 'GET' })
}
