import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useUserStore } from '@/store/user'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import type { Role } from '@/types'
import './index.scss'

const ROLE_LABEL: Record<Role, string> = {
  admin: '管理员',
  editor: '录入员',
  viewer: '查看员'
}

const ADMIN_ENTRIES: { key: string; label: string; url: string; desc: string }[] = [
  {
    key: 'users',
    label: '用户管理',
    url: '/pages/users/index',
    desc: '管理用户角色与权限'
  },
  {
    key: 'categories',
    label: '器材分类管理',
    url: '/pages/categories/index',
    desc: '维护器材分类树'
  },
  {
    key: 'recycle',
    label: '回收站',
    url: '/pages/recycle/index',
    desc: '恢复被删除的数据'
  },
  {
    key: 'logs',
    label: '操作日志',
    url: '/pages/logs/index',
    desc: '查看系统操作记录'
  }
]

export default function Profile() {
  const user = useUserStore((s) => s.user)
  const logout = useUserStore((s) => s.logout)
  const isAdmin = user?.role === 'admin'
  // P0-11: AI assistant requires editor/admin; viewer must not see the entry
  // (backend ai.routes.ts applies requireEditor globally)
  const canUseAi = user?.role === 'admin' || user?.role === 'editor'

  const handleLogout = () => {
    Taro.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          logout()
          Taro.reLaunch({ url: '/pages/login/index' })
        }
      }
    })
  }

  const goPage = (url: string) => {
    Taro.navigateTo({ url })
  }

  if (!user) {
    return (
      <View className='profile-page'>
        <View className='profile-empty'>
          <Text className='profile-empty__text'>未登录</Text>
          <Button
            className='profile-empty__btn'
            onClick={() => Taro.reLaunch({ url: '/pages/login/index' })}
          >
            去登录
          </Button>
        </View>
      </View>
    )
  }

  return (
    <View className='profile-page'>
      <View className='profile-card'>
        <View className='profile-card__avatar'>
          <Text className='profile-card__avatar-text'>
            {user.name?.charAt(0) || '?'}
          </Text>
        </View>
        <View className='profile-card__info'>
          <View className='profile-card__row'>
            <Text className='profile-card__name'>{user.name || '(未命名)'}</Text>
            <Text className={`profile-role profile-role--${user.role}`}>
              {ROLE_LABEL[user.role]}
            </Text>
          </View>
          <Text className='profile-card__id'>用户 ID: {user.id}</Text>
          {user.created_at && (
            <Text className='profile-card__time'>
              注册于 {user.created_at.slice(0, 10)}
            </Text>
          )}
        </View>
      </View>

      {canUseAi && (
        <View className='profile-section'>
          <Text className='profile-section__title'>智能助手</Text>
          <View className='profile-section__list'>
            <View
              className='profile-entry'
              onClick={() => goPage('/pages/ai-chat/index')}
            >
              <View className='profile-entry__main'>
                <Text className='profile-entry__label'>AI 助手</Text>
                <Text className='profile-entry__desc'>自然语言进出库 · 查询器材</Text>
              </View>
              <Text className='profile-entry__arrow'>›</Text>
            </View>
          </View>
        </View>
      )}

      {isAdmin && (
        <View className='profile-section'>
          <Text className='profile-section__title'>管理功能</Text>
          <View className='profile-section__list'>
            {ADMIN_ENTRIES.map((e) => (
              <View
                key={e.key}
                className='profile-entry'
                onClick={() => goPage(e.url)}
              >
                <View className='profile-entry__main'>
                  <Text className='profile-entry__label'>{e.label}</Text>
                  <Text className='profile-entry__desc'>{e.desc}</Text>
                </View>
                <Text className='profile-entry__arrow'>›</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className='profile-section'>
        <Button className='profile-logout' onClick={handleLogout}>
          退出登录
        </Button>
      </View>

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
