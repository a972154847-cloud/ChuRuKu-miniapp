import { View, Text, Input, Picker } from '@tarojs/components'

interface OutFieldsProps {
  recipient: string
  expectedReturnAt: string
  onRecipientChange: (v: string) => void
  onExpectedReturnChange: (v: string) => void
}

export default function OutFields({
  recipient,
  expectedReturnAt,
  onRecipientChange,
  onExpectedReturnChange,
}: OutFieldsProps) {
  return (
    <>
      <View className='record-edit__field'>
        <Text className='record-edit__label'>领用人（可选）</Text>
        <Input
          className='record-edit__input'
          value={recipient}
          placeholder='请输入领用人'
          onInput={(e) => onRecipientChange(e.detail.value)}
        />
      </View>
      <View className='record-edit__field'>
        <Text className='record-edit__label'>预计归还时间（可选）</Text>
        <Picker
          mode='date'
          value={expectedReturnAt}
          onChange={(e) => onExpectedReturnChange(e.detail.value)}
        >
          <View className='record-edit__input record-edit__input--picker'>
            <Text className={expectedReturnAt ? '' : 'record-edit__placeholder'}>
              {expectedReturnAt || '请选择日期'}
            </Text>
          </View>
        </Picker>
      </View>
    </>
  )
}
