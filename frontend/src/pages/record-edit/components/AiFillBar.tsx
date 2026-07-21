import { View, Text } from '@tarojs/components'

interface AiFillBarProps {
  onTrigger: () => void
}

export default function AiFillBar({ onTrigger }: AiFillBarProps) {
  return (
    <View className='record-edit__ai-bar' onClick={onTrigger}>
      <Text className='record-edit__ai-icon'>✨</Text>
      <Text className='record-edit__ai-text'>AI 填表助手</Text>
      <Text className='record-edit__ai-hint'>说一句话自动填表</Text>
    </View>
  )
}
