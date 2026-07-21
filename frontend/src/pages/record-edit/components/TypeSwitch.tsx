import { View, Text } from '@tarojs/components'
import type { RecordType } from '@/types'

interface TypeSwitchProps {
  type: RecordType
  onChange: (type: RecordType) => void
}

export default function TypeSwitch({ type, onChange }: TypeSwitchProps) {
  return (
    <View className='record-edit__field'>
      <Text className='record-edit__label'>
        <Text className='record-edit__required'>*</Text>类型
      </Text>
      <View className='record-edit__type-switch'>
        <Text
          className={`record-edit__type-btn ${type === 'in' ? 'is-active is-active--in' : ''}`}
          onClick={() => onChange('in')}
        >
          入库
        </Text>
        <Text
          className={`record-edit__type-btn ${type === 'out' ? 'is-active is-active--out' : ''}`}
          onClick={() => onChange('out')}
        >
          出库
        </Text>
      </View>
    </View>
  )
}
