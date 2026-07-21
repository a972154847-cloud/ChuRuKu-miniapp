import { View, Text, Button, Image } from '@tarojs/components'
import { resolveFileUrl } from '@/services/upload'
import type { EquipmentInRecord } from '@/services/records'

interface ConfirmModalProps {
  equipmentName: string
  currentStock: number
  equipmentInRecords: EquipmentInRecord[]
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  equipmentName,
  currentStock,
  equipmentInRecords,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <View className='record-edit__confirm-modal' onClick={onCancel}>
      <View className='record-edit__confirm-content' onClick={(e) => e.stopPropagation()}>
        <View className='record-edit__confirm-header'>
          <Text className='record-edit__confirm-title'>确认器材信息</Text>
          <Text className='record-edit__confirm-close' onClick={onCancel}>×</Text>
        </View>
        <View className='record-edit__confirm-body'>
          <Text className='record-edit__confirm-equipment-name'>{equipmentName}</Text>
          <Text className='record-edit__confirm-stock'>当前库存：{currentStock}</Text>
          <View className='record-edit__confirm-section'>
            <Text className='record-edit__confirm-section-title'>入库记录</Text>
            {equipmentInRecords.length > 0 ? (
              <View className='record-edit__confirm-records'>
                {equipmentInRecords.map((record) => (
                  <View key={record.id} className='record-edit__confirm-record-item'>
                    <View className='record-edit__confirm-record-info'>
                      <Text className='record-edit__confirm-record-time'>{record.created_at}</Text>
                      <Text className='record-edit__confirm-record-qty'>入库数量：{record.quantity}</Text>
                    </View>
                    {record.photos && record.photos.length > 0 && (
                      <View className='record-edit__confirm-record-photos'>
                        {record.photos.slice(0, 3).map((photo, idx) => (
                          <Image
                            key={idx}
                            className='record-edit__confirm-record-photo'
                            src={resolveFileUrl(photo.url)}
                            mode='aspectFill'
                          />
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <Text className='record-edit__confirm-empty'>暂无入库记录</Text>
            )}
          </View>
        </View>
        <View className='record-edit__confirm-footer'>
          <Button className='record-edit__confirm-btn record-edit__confirm-btn--cancel' onClick={onCancel}>
            取消
          </Button>
          <Button className='record-edit__confirm-btn record-edit__confirm-btn--confirm' onClick={onConfirm}>
            确认选择
          </Button>
        </View>
      </View>
    </View>
  )
}
