import { useEffect, useState } from 'react'
import { View, Text, Button, Input, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { wxLogin, devLogin } from '@/services/auth'
import { useUserStore } from '@/store/user'
import type { Role } from '@/types'
import './index.scss'

const ROLE_OPTIONS: { label: string; value: Role }[] = [
  { label: '管理员 (admin)', value: 'admin' },
  { label: '录入员 (editor)', value: 'editor' },
  { label: '查看员 (viewer)', value: 'viewer' }
]

export default function Login() {
  const setAuth = useUserStore((s) => s.setAuth)
  const token = useUserStore((s) => s.token)
  const [loading, setLoading] = useState(false)
  const [devName, setDevName] = useState('')
  const [roleIdx, setRoleIdx] = useState(0)

  // 已登录则自动跳转首页
  useEffect(() => {
    if (token) {
      Taro.reLaunch({ url: '/pages/dashboard/index' })
    }
  }, [token])

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
      setTimeout(goHome, 500)
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '微信登录失败，可使用开发登录',
        icon: 'none'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDevLogin = async () => {
    if (loading) return
    setLoading(true)
    try {
      const role = ROLE_OPTIONS[roleIdx].value
      const res = await devLogin(undefined, devName || undefined, role)
      setAuth(res.token, res.user)
      Taro.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(goHome, 500)
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '开发登录失败',
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

      <View className='login-divider'>
        <View className='login-divider__line' />
        <Text className='login-divider__text'>开发登录（测试用）</Text>
        <View className='login-divider__line' />
      </View>

      <View className='login-section login-section--dev'>
        <Input
          className='login-input'
          value={devName}
          placeholder='用户名（可选）'
          onInput={(e) => setDevName(e.detail.value)}
        />
        <Picker
          mode='selector'
          range={ROLE_OPTIONS.map((r) => r.label)}
          value={roleIdx}
          onChange={(e) => setRoleIdx(Number(e.detail.value))}
        >
          <View className='login-picker'>
            <Text>{ROLE_OPTIONS[roleIdx].label}</Text>
          </View>
        </Picker>
        <Button
          className='login-btn login-btn--dev'
          loading={loading}
          onClick={handleDevLogin}
        >
          开发登录
        </Button>
      </View>
    </View>
  )
}
