import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useState, useCallback, useMemo } from 'react'
import { useUserStore } from '@/store/user'
import { getDashboardOverview } from '@/services/dashboard'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import type {
  DashboardOverview,
  DashboardDays,
  CategoryBucket,
  TrendPoint,
  CategoryRatio,
} from '@/services/dashboard'
import './index.scss'

/** 分类色板（柱状图 / 占比图共用） */
const CATEGORY_COLORS = [
  '#D9534F',
  '#F0A04B',
  '#F4D03F',
  '#52c41a',
  '#3498db',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
]

/** 截断过长分类名（柱状图 x 轴标签） */
function shortName(name: string, max = 4): string {
  if (!name) return ''
  // 去掉"类"后缀再截断，避免重复
  const trimmed = name.endsWith('类') ? name.slice(0, -1) : name
  return trimmed.length > max ? trimmed.slice(0, max) + '…' : trimmed
}

/** 格式化日期 MM-DD */
function shortDate(date: string): string {
  if (!date) return ''
  const parts = date.split('-')
  if (parts.length < 3) return date
  return `${parts[1]}-${parts[2]}`
}

/** 顶部统计卡片 */
function StatCard({
  label,
  value,
  unit,
  tone,
  icon,
  onClick,
}: {
  label: string
  value: number | string
  unit: string
  tone: 'primary' | 'green' | 'orange' | 'blue' | 'gray'
  icon?: string
  onClick?: () => void
}) {
  return (
    <View
      className={`stat-card stat-card--${tone} ${onClick ? 'stat-card--clickable' : ''}`}
      onClick={onClick}
    >
      {icon ? <Text className='stat-card__icon'>{icon}</Text> : null}
      <Text className='stat-card__value'>
        {value}
        <Text className='stat-card__unit'>{unit}</Text>
      </Text>
      <Text className='stat-card__label'>{label}</Text>
    </View>
  )
}

/** 柱状图：按一级分类分组的当前库存量（纯 CSS 竖向柱状） */
function CategoryBarChart({ data }: { data: CategoryBucket[] }) {
  const maxQty = useMemo(
    () => Math.max(1, ...data.map((d) => d.total_quantity)),
    [data]
  )
  if (data.length === 0) {
    return <Text className='chart-empty'>暂无分类数据</Text>
  }
  return (
    <View className='bar-chart'>
      <View className='bar-chart__body'>
        {data.map((d, i) => (
          <View key={d.category_name} className='bar-chart__col'>
            <View className='bar-chart__qty'>{d.total_quantity}</View>
            <View className='bar-chart__bar-wrap'>
              <View
                className='bar-chart__bar'
                style={{
                  height: `${(d.total_quantity / maxQty) * 100}%`,
                  background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                }}
              />
            </View>
            <Text className='bar-chart__label'>{shortName(d.category_name)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/** 趋势柱状图：近 N 天出入库（每个日期入库绿/出库红并排） */
function TrendBarChart({ trend }: { trend: TrendPoint[] }) {
  const maxQty = useMemo(
    () =>
      Math.max(
        1,
        ...trend.map((t) => Math.max(t.in_quantity, t.out_quantity))
      ),
    [trend]
  )
  if (trend.length === 0) {
    return <Text className='chart-empty'>暂无趋势数据</Text>
  }
  // 30 天数据较密，每 5 天显示一个日期标签
  const step = trend.length > 10 ? 5 : 1
  return (
    <View className='trend-chart'>
      <View className='trend-chart__legend'>
        <View className='trend-chart__legend-item'>
          <View className='trend-chart__dot trend-chart__dot--in' />
          <Text className='trend-chart__legend-text'>入库</Text>
        </View>
        <View className='trend-chart__legend-item'>
          <View className='trend-chart__dot trend-chart__dot--out' />
          <Text className='trend-chart__legend-text'>出库</Text>
        </View>
      </View>
      <View className='trend-chart__body'>
        {trend.map((t, i) => (
          <View key={t.date} className='trend-chart__col'>
            <View className='trend-chart__bars'>
              <View
                className='trend-chart__bar trend-chart__bar--in'
                style={{ height: `${(t.in_quantity / maxQty) * 100}%` }}
              />
              <View
                className='trend-chart__bar trend-chart__bar--out'
                style={{ height: `${(t.out_quantity / maxQty) * 100}%` }}
              />
            </View>
            {i % step === 0 ? (
              <Text className='trend-chart__label'>{shortDate(t.date)}</Text>
            ) : (
              <Text className='trend-chart__label trend-chart__label--hidden' />
            )}
          </View>
        ))}
      </View>
    </View>
  )
}

/** 占比图：分类占比（纯 CSS 横向堆叠条 + 图例） */
function RatioChart({ ratio }: { ratio: CategoryRatio[] }) {
  const total = useMemo(
    () => ratio.reduce((s, r) => s + r.quantity, 0),
    [ratio]
  )
  if (total === 0 || ratio.length === 0) {
    return <Text className='chart-empty'>暂无占比数据</Text>
  }
  return (
    <View className='ratio-chart'>
      <View className='ratio-chart__bar'>
        {ratio.map((r, i) => (
          <View
            key={r.category_name}
            className='ratio-chart__seg'
            style={{
              width: `${r.percentage}%`,
              background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
            }}
          />
        ))}
      </View>
      <View className='ratio-chart__legend'>
        {ratio.map((r, i) => (
          <View key={r.category_name} className='ratio-chart__legend-item'>
            <View
              className='ratio-chart__dot'
              style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
            />
            <Text className='ratio-chart__name'>
              {r.category_name}
            </Text>
            <Text className='ratio-chart__pct'>{r.percentage}%</Text>
            <Text className='ratio-chart__qty'>({r.quantity})</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/** 低库存预警列表（已下线，保留以备将来恢复） */
// function LowStockList({ list }: { list: LowStockItem[] }) { ... }

/** 过期 / 即将过期列表（已下线，保留以备将来恢复） */
// function ExpiringList(...) { ... }

export default function Dashboard() {
  const user = useUserStore((s) => s.user)
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [days, setDays] = useState<DashboardDays>(7)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(
    async (selectedDays: DashboardDays) => {
      if (!user) {
        Taro.reLaunch({ url: '/pages/login/index' })
        return
      }
      setLoading(true)
      try {
        // 综合接口已包含全部 5 项指标；低库存/过期单独接口供按需刷新（见 services/dashboard.ts）
        const ov = await getDashboardOverview(selectedDays)
        setOverview(ov)
      } catch {
        // request.ts 已弹 Toast，这里只静默
      } finally {
        setLoading(false)
      }
    },
    [user]
  )

  // 首次加载 + 每次切回 tabBar 时刷新
  useDidShow(() => {
    void loadData(days)
  })

  // 下拉刷新
  usePullDownRefresh(() => {
    void loadData(days).finally(() => {
      Taro.stopPullDownRefresh()
    })
  })

  const switchDays = (d: DashboardDays) => {
    if (d === days) return
    setDays(d)
    void loadData(d)
  }

  // P0-12: 器材种类卡片跳转 —— viewer 角色无分类管理权限，仅提示不跳转
  const handleCategoriesClick = () => {
    if (user && user.role === 'viewer') {
      Taro.showToast({ title: '器材种类管理需要 admin 权限', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: '/pages/categories/index' })
  }

  if (!user) {
    return (
      <View className='dashboard'>
        <View className='dashboard__empty'>
          <Text className='dashboard__empty-text'>未登录</Text>
          <Text
            className='dashboard__empty-btn'
            onClick={() => Taro.reLaunch({ url: '/pages/login/index' })}
          >
            去登录
          </Text>
        </View>
      </View>
    )
  }

  if (loading && !overview) {
    return (
      <View className='dashboard'>
        <View className='dashboard__loading'>
          <Text>加载中…</Text>
        </View>
      </View>
    )
  }

  if (!overview) {
    return (
      <View className='dashboard'>
        <View className='dashboard__loading'>
          <Text>暂无数据</Text>
          <Text className='dashboard__retry' onClick={() => loadData(days)}>
            点击重试
          </Text>
        </View>
      </View>
    )
  }

  const { totals, byCategory, trend, categoryRatio } = overview

  return (
    <View className='dashboard'>
      {/* 顶部 4 个统计卡片 */}
      <View className='stat-grid'>
        <StatCard
          label='器材种类'
          value={totals.equipment_count}
          unit='种'
          tone='primary'
          icon='🗂️'
          onClick={handleCategoriesClick}
        />
        <StatCard
          label='当前库存'
          value={totals.stock_quantity}
          unit='件'
          tone='green'
          icon='📦'
          onClick={() => Taro.navigateTo({ url: '/pages/equipments/index' })}
        />
        <StatCard label='今日操作' value={totals.today_count} unit='次' tone='blue' icon='📅' />
        <StatCard label='本月操作' value={totals.month_count} unit='次' tone='gray' icon='🗓️' />
      </View>

      {/* 柱状图：分类库存 */}
      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>分类库存</Text>
          <Text className='section__unit'>单位：件</Text>
        </View>
        <CategoryBarChart data={byCategory} />
      </View>

      {/* 趋势柱状图：近 7/30 天出入库 */}
      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>出入库趋势</Text>
          <View className='days-switch'>
            <Text
              className={`days-switch__btn ${days === 7 ? 'days-switch__btn--active' : ''}`}
              onClick={() => switchDays(7)}
            >
              7天
            </Text>
            <Text
              className={`days-switch__btn ${days === 30 ? 'days-switch__btn--active' : ''}`}
              onClick={() => switchDays(30)}
            >
              30天
            </Text>
          </View>
        </View>
        <TrendBarChart trend={trend} />
      </View>

      {/* 占比图：分类占比 */}
      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>分类占比</Text>
        </View>
        <RatioChart ratio={categoryRatio} />
      </View>

      <View className='dashboard__footer'>
        <Text className='dashboard__footer-text'>
          出入库记录可在「记录」页查看 · 分类管理可在「我的」页进入
        </Text>
      </View>

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
