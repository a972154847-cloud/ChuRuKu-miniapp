import { useState } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { updateUserProfile } from '@/services/users'
import { useUserStore } from '@/store/user'
import './index.scss'

export default function ProfileSetup() {
  const setAuth = useUserStore((s) => s.setAuth)
  const user = useUserStore((s) => s.user)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      Taro.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (trimmedName.length > 50) {
      Taro.showToast({ title: '姓名不能超过50个字符', icon: 'none' })
      return
    }

    setLoading(true)
    try {
      const updatedUser = await updateUserProfile({ name: trimmedName })
      if (user) {
        setAuth(useUserStore.getState().token || '', {
          ...user,
          name: updatedUser.name
        })
      }
      Taro.showToast({ title: '信息已完善', icon: 'success' })
      setTimeout(() => {
        Taro.reLaunch({ url: '/pages/dashboard/index' })
      }, 1000)
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '保存失败',
        icon: 'none'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='profile-setup-page'>
      <View className='profile-setup-header'>
        <View className='profile-setup-logo'>🚒</View>
        <Text className='profile-setup-title'>完善个人信息</Text>
        <Text className='profile-setup-subtitle'>为了更好地管理和识别用户，请完善您的姓名</Text>
      </View>

      <View className='profile-setup-form'>
        <View className='profile-setup-field'>
          <Text className='profile-setup-label'>
            <Text className='profile-setup-required'>*</Text>姓名
          </Text>
          <Input
            className='profile-setup-input'
            type='text'
            value={name}
            placeholder='请输入您的姓名'
            placeholderStyle='color: #ccc'
            onInput={(e) => setName(e.detail.value)}
            onConfirm={handleSubmit}
            maxlength={50}
          />
        </View>

        <Button
          className='profile-setup-submit'
          loading={loading}
          onClick={handleSubmit}
        >
          保存并进入
        </Button>
      </View>

      <View className='profile-setup-tip'>
        <Text>您的姓名将用于管理员识别和操作日志记录</Text>
      </View>
    </View>
  )
}