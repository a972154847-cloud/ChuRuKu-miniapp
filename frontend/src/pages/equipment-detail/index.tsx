import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'
import {
  getEquipmentDetail,
  type EquipmentDetail,
} from '@/services/equipments'
import './index.scss'

export default function EquipmentDetailPage() {
  const router = useRouter()
  const [detail, setDetail] = useState<EquipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchDetail = async (id: number) => {
    setLoading(true)
    try {
      const data = await getEquipmentDetail(id)
      setDetail(data)
    } catch {
      Taro.showToast({ title: '获取器材详情失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    const id = Number(router.params.id)
    if (!id) {
      Taro.showToast({ title: '参数错误', icon: 'none' })
      Taro.navigateBack()
      return
    }
    fetchDetail(id)
  })

  const isLowStock = detail != null && detail.current_stock <= detail.threshold

  return (
    <View className='equipment-detail'>
      {loading ? (
        <View className='section' style={{ padding: '40px 0', textAlign: 'center' }}>
          <Text style={{ color: '#ccc' }}>加载中...</Text>
        </View>
      ) : detail ? (
        <>
          {/* 头部信息 */}
          <View className='detail-header'>
            <View className='detail-header__name'>{detail.name}</View>
            <View className='detail-header__meta'>
              <Text className='detail-header__tag'>
                {detail.category_name || '未分类'}
              </Text>
              {detail.spec && (
                <Text className='detail-header__tag'>{detail.spec}</Text>
              )}
              {detail.scrap_years && (
                <Text className='detail-header__tag'>
                  报废年限: {detail.scrap_years}年
                </Text>
              )}
            </View>
          </View>

          {/* 库存状态 */}
          <View className='stock-card'>
            <View className='stock-card__info'>
              <View className='stock-card__label'>当前库存</View>
              <View>
                <Text
                  className={`stock-card__value ${
                    isLowStock
                      ? 'stock-card__value--low'
                      : 'stock-card__value--normal'
                  }`}
                >
                  {detail.current_stock}
                </Text>
                <Text className='stock-card__unit'>件</Text>
              </View>
              <View className='stock-card__threshold'>
                低库存预警阈值: {detail.threshold}件
              </View>
            </View>
            <View className='stock-card__extra'>
              <View className='stock-card__extra-item'>
                {isLowStock ? '⚠️ 库存不足' : '✅ 库存正常'}
              </View>
            </View>
          </View>

          {/* 最近出入库记录 */}
          <View className='section'>
            <View className='section__header'>最近出入库记录</View>
            {detail.recent_records.length === 0 ? (
              <View className='section__empty'>暂无出入库记录</View>
            ) : (
              detail.recent_records.map((r) => (
                <View key={r.id} className='record-item'>
                  <View
                    className={`record-item__type ${
                      r.type === 'in'
                        ? 'record-item__type--in'
                        : 'record-item__type--out'
                    }`}
                  >
                    {r.type === 'in' ? '入库' : '出库'}
                  </View>
                  <View className='record-item__info'>
                    <View className='record-item__qty'>
                      {r.type === 'in' ? '+' : '-'}
                      {r.quantity} 件
                    </View>
                    <View className='record-item__operator'>
                      {r.operator_name || '系统'}
                    </View>
                  </View>
                  <View className='record-item__time'>{r.created_at}</View>
                </View>
              ))
            )}
          </View>
        </>
      ) : (
        <View
          className='section'
          style={{ padding: '40px 0', textAlign: 'center' }}
        >
          <Text style={{ color: '#ccc' }}>器材不存在</Text>
        </View>
      )}
    </View>
  )
}
