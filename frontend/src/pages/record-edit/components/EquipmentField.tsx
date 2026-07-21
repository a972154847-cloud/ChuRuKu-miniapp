import { View, Text, Input, Button } from '@tarojs/components'
import type { EquipmentItem } from '@/services/records'

interface EquipmentFieldProps {
  type: string
  equipmentName: string
  currentStock: number
  showSuggestions: boolean
  filteredList: EquipmentItem[]
  showEquipmentPicker: boolean
  equipmentList: EquipmentItem[]
  onInput: (value: string) => void
  onSelect: (item: EquipmentItem) => void
  onOpenPicker: () => void
  onClosePicker: () => void
}

export default function EquipmentField({
  type,
  equipmentName,
  currentStock,
  showSuggestions,
  filteredList,
  showEquipmentPicker,
  equipmentList,
  onInput,
  onSelect,
  onOpenPicker,
  onClosePicker,
}: EquipmentFieldProps) {
  return (
    <View className='record-edit__field'>
      <Text className='record-edit__label'>
        <Text className='record-edit__required'>*</Text>器材名称
      </Text>
      <View className='record-edit__equipment-input-wrapper'>
        <Input
          className='record-edit__input'
          value={equipmentName}
          placeholder='请输入器材名称'
          onInput={(e) => onInput(e.detail.value)}
        />
        {type === 'out' && (
          <Button
            className='record-edit__picker-btn'
            size='mini'
            onClick={onOpenPicker}
          >
            选择已有
          </Button>
        )}
      </View>
      {type === 'out' && equipmentName && currentStock > 0 && (
        <Text className='record-edit__stock-hint'>
          当前库存：{currentStock}
        </Text>
      )}
      {type === 'out' && showSuggestions && filteredList.length > 0 && (
        <View className='record-edit__suggestions'>
          {filteredList.map((item) => (
            <View
              key={item.id}
              className='record-edit__suggestion-item'
              onClick={() => onSelect(item)}
            >
              <Text className='record-edit__suggestion-name'>{item.name}</Text>
              <Text className={`record-edit__suggestion-stock ${item.stock > 0 ? '' : 'is-low'}`}>
                库存: {item.stock}
              </Text>
            </View>
          ))}
        </View>
      )}

      {showEquipmentPicker && equipmentList.length > 0 && (
        <View className='record-edit__equipment-modal' onClick={onClosePicker}>
          <View className='record-edit__equipment-list' onClick={(e) => e.stopPropagation()}>
            <View className='record-edit__equipment-list-header'>
              <Text className='record-edit__equipment-list-title'>选择已有器材</Text>
              <Text className='record-edit__equipment-list-close' onClick={onClosePicker}>×</Text>
            </View>
            <View className='record-edit__equipment-list-body'>
              {equipmentList.map((item) => (
                <View
                  key={item.id}
                  className='record-edit__equipment-list-item'
                  onClick={() => onSelect(item)}
                >
                  <Text className='record-edit__equipment-list-name'>{item.name}</Text>
                  <Text className={`record-edit__equipment-list-stock ${item.stock > 0 ? '' : 'is-low'}`}>
                    库存: {item.stock}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
