import { useEffect, useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { wxLogin } from '@/services/auth'
import { useUserStore } from '@/store/user'
import './index.scss'

function isNameValid(name?: string): boolean {
  return Boolean(name && name.trim() && name.trim().length > 0 && name.trim().length <= 50)
}

export default function Login() {
  const setAuth = useUserStore((s) => s.setAuth)
  const token = useUserStore((s) => s.token)
  const user = useUserStore((s) => s.user)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (token && user) {
      if (isNameValid(user.name)) {
        Taro.reLaunch({ url: '/pages/dashboard/index' })
      } else {
        Taro.reLaunch({ url: '/pages/profile-setup/index' })
      }
    }
  }, [token, user])

  const goHome = () => {
    Taro.reLaunch({ url: '/pages/dashboard/index' })
  }

  const handleWxLogin = async () => {
    if (loading) return
    setLoading(true)
    try {
      const { code } = await Taro.login()
      if (!code) {
        throw new Error('获取微信 code 失败')
      }
      const res = await wxLogin(code)
      setAuth(res.token, res.user)
      Taro.showToast({ title: '登录成功', icon: 'success' })
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '微信登录失败，请稍后重试',
        icon: 'none'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='login-page'>
      <View className='login-header'>
        <View className='login-logo'>🚒</View>
        <Text className='login-title'>器材装备管理</Text>
        <Text className='login-subtitle'>出入库管理系统</Text>
      </View>

      <View className='login-section'>
        <Button
          className='login-btn login-btn--primary'
          loading={loading}
          onClick={handleWxLogin}
        >
          微信一键登录
        </Button>
      </View>
    </View>
  )
}