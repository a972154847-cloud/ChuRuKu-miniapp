import { useCallback, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useUserStore } from '@/store/user'
import {
  getDashboardOverview,
  type DashboardDays,
  type DashboardOverview,
  type TrendPoint
} from '@/services/dashboard'
import { listRecords, type RecordListItem } from '@/services/records'
import './index.scss'

function shortDate(date: string): string {
  const parts = date.split('-')
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date
}

function shortTime(value?: string | null): string {
  return value && value.length >= 16 ? value.slice(5, 16) : value || ''
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const maxValue = useMemo(
    () => Math.max(1, ...data.flatMap((item) => [item.in_quantity, item.out_quantity])),
    [data]
  )

  if (data.length === 0) {
    return <Text className='dashboard-empty'>暂无趋势数据</Text>
  }

  const height = (value: number) => {
    if (value <= 0) return '4rpx'
    return `${Math.max(12, Math.sqrt(value / maxValue) * 148)}rpx`
  }

  return (
    <View className='trend'>
      <View className='trend__legend'>
        <View className='trend__legend-item'><View className='trend__dot trend__dot--in' /><Text>入库</Text></View>
        <View className='trend__legend-item'><View className='trend__dot trend__dot--out' /><Text>出库</Text></View>
      </View>
      <View className='trend__plot'>
        {data.map((item) => (
          <View className='trend__column' key={item.date}>
            <View className='trend__bars'>
              <View className='trend__bar trend__bar--in' style={{ height: height(item.in_quantity) }} />
              <View className='trend__bar trend__bar--out' style={{ height: height(item.out_quantity) }} />
            </View>
            <Text className='trend__date'>{shortDate(item.date)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export default function Dashboard() {
  const user = useUserStore((state) => state.user)
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [records, setRecords] = useState<RecordListItem[]>([])
  const [days, setDays] = useState<DashboardDays>(7)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async (selectedDays: DashboardDays) => {
    if (!user) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    try {
      const [dashboard, recent] = await Promise.all([
        getDashboardOverview(selectedDays),
        listRecords({ page: 1, pageSize: 5 })
      ])
      setOverview(dashboard)
      setRecords(recent.list || [])
    } finally {
      setLoading(false)
    }
  }, [user])

  useDidShow(() => { void loadData(days) })
  usePullDownRefresh(() => {
    void loadData(days).finally(() => Taro.stopPullDownRefresh())
  })

  const switchDays = (value: DashboardDays) => {
    if (value === days) return
    setDays(value)
    void loadData(value)
  }

  if (!user) return <View className='dashboard' />

  if (loading && !overview) {
    return <View className='dashboard dashboard--center'><Text>正在加载库存数据...</Text></View>
  }

  if (!overview) {
    return (
      <View className='dashboard dashboard--center'>
        <Text>库存数据加载失败</Text>
        <Text className='dashboard-retry' onClick={() => loadData(days)}>重新加载</Text>
      </View>
    )
  }

  const { totals, trend, lowStock } = overview
  const today = trend[trend.length - 1]
  const todayIn = today?.in_quantity || 0
  const todayOut = today?.out_quantity || 0

  return (
    <View className='dashboard'>
      <View className='stock-card'>
        <Text className='stock-card__label'>当前可用库存</Text>
        <View className='stock-card__number'>
          <Text className='stock-card__value'>{totals.stock_quantity}</Text>
          <Text className='stock-card__unit'>件</Text>
        </View>
      </View>

      <View className='kpi-row'>
        <View className='kpi'><Text className='kpi__value kpi__value--in'>+{todayIn}</Text><Text className='kpi__label'>今日入库</Text></View>
        <View className='kpi'><Text className='kpi__value kpi__value--out'>-{todayOut}</Text><Text className='kpi__label'>今日出库</Text></View>
        <View className='kpi'><Text className='kpi__value kpi__value--warning'>{lowStock.length}</Text><Text className='kpi__label'>低库存预警</Text></View>
      </View>

      <View className='action-row'>
        <View className='action-button action-button--primary' onClick={() => Taro.navigateTo({ url: '/pages/record-edit/index?type=in' })}><Text>登记入库</Text></View>
        <View className='action-button' onClick={() => Taro.navigateTo({ url: '/pages/record-edit/index?type=out' })}><Text>登记出库</Text></View>
      </View>

      {lowStock.length > 0 && (
        <View className='warning-card'>
          <Text className='warning-card__title'>库存不足预警</Text>
          <Text className='warning-card__body'>
            {lowStock.slice(0, 3).map((item) => item.name).join('、')}
            {lowStock.length > 3 ? `等 ${lowStock.length} 项器材` : ''}库存低于安全阈值，请及时补充
          </Text>
        </View>
      )}

      <View className='content-card'>
        <View className='section-head'>
          <Text className='section-head__title'>出入库趋势</Text>
          <View className='range-switch'>
            <Text className={days === 7 ? 'is-active' : ''} onClick={() => switchDays(7)}>7天</Text>
            <Text className={days === 30 ? 'is-active' : ''} onClick={() => switchDays(30)}>30天</Text>
          </View>
        </View>
        <TrendChart data={trend} />
      </View>

      <View className='recent-section'>
        <View className='section-head section-head--outside'>
          <Text className='section-head__title'>最近操作记录</Text>
          <Text className='section-head__link' onClick={() => Taro.switchTab({ url: '/pages/records/index' })}>查看全部记录</Text>
        </View>
        <View className='content-card content-card--records'>
          {records.length === 0 ? (
            <Text className='dashboard-empty'>暂无出入库记录</Text>
          ) : records.map((record) => (
            <View className='recent-record' key={record.id} onClick={() => Taro.navigateTo({ url: `/pages/record-detail/index?id=${record.id}` })}>
              <View className='recent-record__main'>
                <Text className='recent-record__name'>{record.equipment_name || `器材#${record.equipment_id}`}</Text>
                <Text className='recent-record__meta'>操作人：{record.operator_name || `用户#${record.operator_id}`} · {shortTime(record.created_at)}</Text>
              </View>
              <Text className={`recent-record__qty recent-record__qty--${record.type}`}>
                {record.type === 'in' ? '+' : '-'}{record.quantity} 件
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}
