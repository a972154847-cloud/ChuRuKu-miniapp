import { useEffect, useState } from 'react'
import { View, Text, Checkbox, Button, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useUserStore } from '@/store/user'
import { getAllPermissions, getRolesWithPermissions, updateRolePermissions } from '@/services/permissions'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import type { Role } from '@/types'
import './index.scss'

const ROLE_LABEL: Record<Role, string> = {
  admin: '管理员',
  editor: '录入员',
  viewer: '查看员'
}

const ROLE_COLOR: Record<Role, string> = {
  admin: '#ef4444',
  editor: '#f59e0b',
  viewer: '#10b981'
}

interface Permission {
  id: number
  code: string
  name: string
  type: string
  resource: string | null
  description: string | null
}

interface RolePermission {
  role: string
  permissions: string[]
}

export default function Permissions() {
  const currentUser = useUserStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'

  const [roles, setRoles] = useState<RolePermission[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [selectedRole, setSelectedRole] = useState<Role>('admin')
  const [checkedPermissions, setCheckedPermissions] = useState<number[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [perms, rs] = await Promise.all([
        getAllPermissions(),
        getRolesWithPermissions()
      ])
      setPermissions(perms)
      setRoles(rs)
      const role = rs.find((r) => r.role === selectedRole)
      if (role) {
        const permIds = perms.filter((p) => role.permissions.includes(p.code)).map((p) => p.id)
        setCheckedPermissions(permIds)
      }
    } catch {
      // 错误已由 request.ts toast
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  useEffect(() => {
    const role = roles.find((r) => r.role === selectedRole)
    if (role) {
      const permIds = permissions.filter((p) => role.permissions.includes(p.code)).map((p) => p.id)
      setCheckedPermissions(permIds)
    }
  }, [selectedRole, roles, permissions])

  const handleRoleChange = (idx: number) => {
    const roleKeys: Role[] = ['admin', 'editor', 'viewer']
    setSelectedRole(roleKeys[idx])
  }

  const handlePermissionToggle = (id: number) => {
    setCheckedPermissions((prev) => {
      if (prev.includes(id)) {
        return prev.filter((p) => p !== id)
      }
      return [...prev, id]
    })
  }

  const handleSelectAll = () => {
    if (checkedPermissions.length === permissions.length) {
      setCheckedPermissions([])
    } else {
      setCheckedPermissions(permissions.map((p) => p.id))
    }
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      await updateRolePermissions(selectedRole, checkedPermissions)
      Taro.showToast({ title: '保存成功', icon: 'success' })
      await fetchData()
    } catch {
      // 错误已 toast
    } finally {
      setLoading(false)
    }
  }

  const groupedPermissions = permissions.reduce((acc, p) => {
    const prefix = p.code.split(':')[0]
    if (!acc[prefix]) {
      acc[prefix] = []
    }
    acc[prefix].push(p)
    return acc
  }, {} as Record<string, Permission[]>)

  const groupLabels: Record<string, string> = {
    record: '记录管理',
    equipment: '器材管理',
    category: '分类管理',
    user: '用户管理',
    recycle: '回收站',
    log: '日志管理',
    ai: 'AI助手',
    upload: '文件上传'
  }

  if (!isAdmin) {
    return (
      <View className='permissions-page'>
        <View className='permissions-empty'>
          <Text className='permissions-empty__text'>无权限</Text>
          <Text className='permissions-empty__sub'>仅管理员可访问权限管理</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='permissions-page'>
      <View className='permissions-header'>
        <Picker
          mode='selector'
          range={['管理员', '录入员', '查看员']}
          value={['admin', 'editor', 'viewer'].indexOf(selectedRole)}
          onChange={(e) => handleRoleChange(Number(e.detail.value))}
        >
          <View className='permissions-header__role'>
            <View className='permissions-header__role-dot' style={{ backgroundColor: ROLE_COLOR[selectedRole] }} />
            <Text className='permissions-header__role-text'>{ROLE_LABEL[selectedRole]}</Text>
          </View>
        </Picker>
        <Button
          className='permissions-header__save'
          loading={loading}
          onClick={handleSave}
        >
          保存
        </Button>
      </View>

      <View className='permissions-toolbar'>
        <Button
          className='permissions-toolbar__btn'
          size='mini'
          onClick={handleSelectAll}
        >
          {checkedPermissions.length === permissions.length ? '取消全选' : '全选'}
        </Button>
        <Text className='permissions-toolbar__count'>
          已选择 {checkedPermissions.length} / {permissions.length} 项权限
        </Text>
      </View>

      <View className='permissions-list'>
        {Object.entries(groupedPermissions).map(([group, perms]) => (
          <View key={group} className='permissions-group'>
            <View className='permissions-group__header'>
              <Text className='permissions-group__title'>{groupLabels[group] || group}</Text>
              <Text className='permissions-group__count'>{perms.length}</Text>
            </View>
            <View className='permissions-group__items'>
              {perms.map((p) => (
                <View
                  key={p.id}
                  className='permissions-item'
                  onClick={() => handlePermissionToggle(p.id)}
                >
                  <Checkbox
                    checked={checkedPermissions.includes(p.id)}
                    onChange={() => {}}
                  />
                  <View className='permissions-item__info'>
                    <Text className='permissions-item__name'>{p.name}</Text>
                    <Text className='permissions-item__code'>{p.code}</Text>
                  </View>
                  {p.description && (
                    <Text className='permissions-item__desc'>{p.description}</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
