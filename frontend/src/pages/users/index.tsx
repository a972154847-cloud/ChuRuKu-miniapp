import { useEffect, useState } from 'react'
import { View, Text, Input, Picker, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { listUsers, updateUserRole } from '@/services/users'
import { useUserStore } from '@/store/user'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import type { Role, User } from '@/types'
import './index.scss'

const ROLE_FILTER: { label: string; value: string }[] = [
  { label: '全部角色', value: '' },
  { label: '管理员', value: 'admin' },
  { label: '录入员', value: 'editor' },
  { label: '查看员', value: 'viewer' }
]

const ROLE_EDIT_OPTIONS: { label: string; value: Role }[] = [
  { label: '管理员 (admin)', value: 'admin' },
  { label: '录入员 (editor)', value: 'editor' },
  { label: '查看员 (viewer)', value: 'viewer' }
]

const ROLE_LABEL: Record<Role, string> = {
  admin: '管理员',
  editor: '录入员',
  viewer: '查看员'
}

export default function Users() {
  const currentUser = useUserStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'

  const [roleIdx, setRoleIdx] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [list, setList] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editRoleIdx, setEditRoleIdx] = useState(0)

  const fetchList = async (overrides?: { role?: string; keyword?: string }) => {
    setLoading(true)
    try {
      const role = overrides?.role ?? ROLE_FILTER[roleIdx].value
      const kw = overrides?.keyword ?? keyword
      const res = await listUsers({
        role: role || undefined,
        keyword: kw || undefined,
        page: 1,
        pageSize: 200
      })
      setList(res.list || [])
    } catch {
      // 错误已由 request.ts toast
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) fetchList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  const handleRoleFilterChange = (idx: number) => {
    setRoleIdx(idx)
    fetchList({ role: ROLE_FILTER[idx].value })
  }

  const handleSearch = () => fetchList()

  const startEdit = (u: User) => {
    const idx = ROLE_EDIT_OPTIONS.findIndex((r) => r.value === u.role)
    setEditRoleIdx(idx >= 0 ? idx : 0)
    setEditingId(u.id)
  }

  const confirmEdit = async () => {
    if (editingId == null) return
    const newRole = ROLE_EDIT_OPTIONS[editRoleIdx].value
    setLoading(true)
    try {
      await updateUserRole(editingId, newRole)
      Taro.showToast({ title: '修改成功', icon: 'success' })
      setEditingId(null)
      await fetchList()
    } catch {
      // 错误已 toast
    } finally {
      setLoading(false)
    }
  }

  const cancelEdit = () => setEditingId(null)

  if (!isAdmin) {
    return (
      <View className='users-page'>
        <View className='users-empty'>
          <Text className='users-empty__text'>无权限</Text>
          <Text className='users-empty__sub'>仅管理员可访问用户管理</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='users-page'>
      <View className='users-filter'>
        <Picker
          mode='selector'
          range={ROLE_FILTER.map((r) => r.label)}
          value={roleIdx}
          onChange={(e) => handleRoleFilterChange(Number(e.detail.value))}
        >
          <View className='users-filter__picker'>
            <Text>{ROLE_FILTER[roleIdx].label}</Text>
          </View>
        </Picker>
        <Input
          className='users-filter__input'
          value={keyword}
          placeholder='搜索用户名'
          onInput={(e) => setKeyword(e.detail.value)}
          onConfirm={handleSearch}
        />
        <Button
          className='users-filter__btn'
          size='mini'
          onClick={handleSearch}
        >
          搜索
        </Button>
      </View>

      <View className='users-list'>
        {list.length === 0 && !loading && (
          <View className='users-empty'>
            <Text className='users-empty__text'>暂无用户</Text>
          </View>
        )}
        {list.map((u) => {
          const isSelf = currentUser?.id === u.id
          return (
            <View key={u.id} className='users-item'>
              <View className='users-item__main'>
                <View className='users-item__row'>
                  <Text className='users-item__name'>{u.name || '(未命名)'}</Text>
                  <Text className={`users-role users-role--${u.role}`}>
                    {ROLE_LABEL[u.role]}
                  </Text>
                </View>
                <View className='users-item__meta'>
                  <Text className='users-item__id'>ID: {u.id}</Text>
                  {u.created_at && (
                    <Text className='users-item__time'>
                      注册于 {u.created_at.slice(0, 10)}
                    </Text>
                  )}
                </View>
              </View>
              {isSelf ? (
                <Text className='users-item__self'>本人</Text>
              ) : (
                <Button
                  className='users-item__btn'
                  size='mini'
                  onClick={() => startEdit(u)}
                >
                  修改角色
                </Button>
              )}
            </View>
          )
        })}
      </View>

      {editingId != null && (
        <View className='users-modal-mask'>
          <View className='users-modal'>
            <Text className='users-modal__title'>修改角色</Text>
            <Picker
              mode='selector'
              range={ROLE_EDIT_OPTIONS.map((r) => r.label)}
              value={editRoleIdx}
              onChange={(e) => setEditRoleIdx(Number(e.detail.value))}
            >
              <View className='users-modal__picker'>
                <Text>{ROLE_EDIT_OPTIONS[editRoleIdx].label}</Text>
              </View>
            </Picker>
            <View className='users-modal__btns'>
              <Button
                className='users-modal__btn users-modal__btn--cancel'
                onClick={cancelEdit}
              >
                取消
              </Button>
              <Button
                className='users-modal__btn users-modal__btn--ok'
                loading={loading}
                onClick={confirmEdit}
              >
                确认
              </Button>
            </View>
          </View>
        </View>
      )}

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
