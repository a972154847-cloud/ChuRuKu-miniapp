import Taro from '@tarojs/taro'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request, { ApiError } from '@/services/request'
import { useUserStore } from '@/store/user'

describe('request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUserStore.getState().logout()
  })

  it('clears both persisted and in-memory auth after a 401 response', async () => {
    useUserStore.getState().setAuth('expired-token', {
      id: 1,
      name: 'Tester',
      role: 'viewer',
    })
    vi.mocked(Taro.request).mockResolvedValueOnce({
      statusCode: 401,
      data: { code: 401, message: '登录已过期' },
    } as any)

    await expect(request({ url: '/dashboard' })).rejects.toBeInstanceOf(ApiError)

    expect(useUserStore.getState().token).toBeNull()
    expect(useUserStore.getState().user).toBeNull()
    expect((Taro as any).__storage.token).toBeUndefined()
    expect((Taro as any).__storage.user).toBeUndefined()
  })
})
