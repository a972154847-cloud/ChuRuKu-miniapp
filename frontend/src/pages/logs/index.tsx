import { useEffect, useState, useCallback, useRef } from 'react'
import { View, Text, Picker, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { listLogs, getLogStats, type LogEntry, type LogStats } from '@/services/logs'
import { useUserStore } from '@/store/user'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import './index.scss'

const ACTION_OPTIONS: { label: string; value: string }[] = [
  { label: '全部操作', value: '' },
  { label: '创建记录', value: 'record.create' },
  { label: '更新记录', value: 'record.update' },
  { label: '删除记录', value: 'record.delete' },
  { label: '关联照片', value: 'record.attach_photos' },
  { label: '删除照片', value: 'record.detach_photo' },
  { label: '角色变更', value: 'role.change' },
  { label: '用户登录', value: 'user.login' },
  { label: '用户注册', value: 'user.register' }
]

const PAGE_SIZE = 20

function formatTime(t: string): string {
  if (!t) return ''
  // 'YYYY-MM-DD HH:MM:SS' → 'MM-DD HH:MM'
  return t.length >= 16 ? t.slice(5, 16) : t
}

function safeParse(json: string | null | undefined): unknown {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}

export default function LogsPage() {
  const currentUser = useUserStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'

  const [list, setList] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 筛选
  const [actionIdx, setActionIdx] = useState(0)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // 统计
  const [stats, setStats] = useState<LogStats | null>(null)

  // 用 ref 跟踪当前页码，避免闭包过期问题
  const pageRef = useRef(1)

  /**
   * 统一的数据获取函数，参数全部显式传入，不依赖闭包中的 state。
   * @param reset  true=从第1页重置加载；false=加载下一页
   * @param aIdx   筛选的操作类型索引
   * @param sDate  开始日期
   * @param eDate  结束日期
   */
  const doFetch = useCallback(
    async (reset: boolean, aIdx: number, sDate: string, eDate: string) => {
      const nextPage = reset ? 1 : pageRef.current + 1
      if (reset) {
        setLoading(true)
      } else {
        setLoadingMore(true)
      }
      try {
        const action = ACTION_OPTIONS[aIdx].value
        const res = await listLogs({
          action: action || undefined,
          start_date: sDate || undefined,
          end_date: eDate || undefined,
          page: nextPage,
          page_size: PAGE_SIZE
        })
        if (reset) {
          setList(res.list || [])
        } else {
          setList((prev) => [...prev, ...(res.list || [])])
        }
        setTotal(res.total || 0)
        const newPage = res.page || nextPage
        pageRef.current = newPage
      } catch {
        // 错误已由 request.ts toast
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    []
  )

  const fetchStats = useCallback(async () => {
    try {
      const s = await getLogStats()
      setStats(s)
    } catch {
      // 忽略统计加载错误
    }
  }, [])

  useEffect(() => {
    if (isAdmin) {
      doFetch(true, actionIdx, startDate, endDate)
      fetchStats()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // 下拉刷新
  Taro.usePullDownRefresh(async () => {
    await Promise.all([doFetch(true, actionIdx, startDate, endDate), fetchStats()])
    Taro.stopPullDownRefresh()
  })

  // 上拉加载更多
  Taro.useReachBottom(() => {
    if (loadingMore || loading) return
    if (list.length >= total) return
    doFetch(false, actionIdx, startDate, endDate)
  })

  const handleActionChange = (idx: number) => {
    setActionIdx(idx)
    // 重置分页状态
    setList([])
    pageRef.current = 0
    doFetch(true, idx, startDate, endDate)
  }

  const handleStartDateChange = (v: string) => {
    setStartDate(v)
    setList([])
    pageRef.current = 0
    doFetch(true, actionIdx, v, endDate)
  }

  const handleEndDateChange = (v: string) => {
    setEndDate(v)
    setList([])
    pageRef.current = 0
    doFetch(true, actionIdx, startDate, v)
  }

  const handleReset = () => {
    setActionIdx(0)
    setStartDate('')
    setEndDate('')
    setList([])
    pageRef.current = 0
    doFetch(true, 0, '', '')
  }

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  if (!isAdmin) {
    return (
      <View className='logs-page'>
        <View className='logs-empty'>
          <Text className='logs-empty__text'>无权限</Text>
          <Text className='logs-empty__sub'>仅管理员可查看操作日志</Text>
        </View>
      </View>
    )
  }

  const hasMore = list.length < total

  return (
    <View className='logs-page'>
      {/* 统计概览 */}
      {stats && (
        <View className='logs-stats'>
          <View className='logs-stats__item'>
            <Text className='logs-stats__num'>{stats.total}</Text>
            <Text className='logs-stats__label'>总日志</Text>
          </View>
          <View className='logs-stats__item'>
            <Text className='logs-stats__num'>{stats.today}</Text>
            <Text className='logs-stats__label'>今日</Text>
          </View>
          <View className='logs-stats__item'>
            <Text className='logs-stats__num'>{stats.by_action.length}</Text>
            <Text className='logs-stats__label'>操作类型</Text>
          </View>
        </View>
      )}

      {/* 筛选条 */}
      <View className='logs-filter'>
        <Picker
          mode='selector'
          range={ACTION_OPTIONS.map((a) => a.label)}
          value={actionIdx}
          onChange={(e) => handleActionChange(Number(e.detail.value))}
        >
          <View className='logs-filter__picker'>
            <Text>{ACTION_OPTIONS[actionIdx].label}</Text>
          </View>
        </Picker>
        <Picker
          mode='date'
          value={startDate || ''}
          onChange={(e) => handleStartDateChange(String(e.detail.value))}
        >
          <View className={`logs-filter__date ${!startDate ? 'is-placeholder' : ''}`}>
            <Text>{startDate || '开始日期'}</Text>
          </View>
        </Picker>
        <Picker
          mode='date'
          value={endDate || ''}
          onChange={(e) => handleEndDateChange(String(e.detail.value))}
        >
          <View className={`logs-filter__date ${!endDate ? 'is-placeholder' : ''}`}>
            <Text>{endDate || '结束日期'}</Text>
          </View>
        </Picker>
        <Button
          className='logs-filter__btn'
          size='mini'
          onClick={handleReset}
        >
          重置
        </Button>
      </View>

      {/* 日志列表 */}
      <View className='logs-list'>
        {list.length === 0 && !loading && (
          <View className='logs-empty'>
            <Text className='logs-empty__text'>暂无日志</Text>
          </View>
        )}
        {list.map((log) => {
          const expanded = expandedId === log.id
          const before = safeParse(log.before_json)
          const after = safeParse(log.after_json)
          return (
            <View
              key={log.id}
              className={`logs-item ${expanded ? 'is-expanded' : ''}`}
              onClick={() => toggleExpand(log.id)}
            >
              <View className='logs-item__head'>
                <View className='logs-item__main'>
                  <Text className='logs-item__action'>{log.action}</Text>
                  <Text className='logs-item__entity'>
                    {log.entity}
                    {log.entity_id ? `#${log.entity_id}` : ''}
                  </Text>
                </View>
                <Text className='logs-item__time'>
                  {formatTime(log.created_at)}
                </Text>
              </View>
              <View className='logs-item__meta'>
                <Text className='logs-item__actor'>
                  {log.actor_name || (log.actor_id ? `用户#${log.actor_id}` : '系统')}
                </Text>
                {expanded && (before || after) ? (
                  <Text className='logs-item__hint'>点击收起</Text>
                ) : (
                  <Text className='logs-item__hint'>点击查看详情</Text>
                )}
              </View>
              {expanded && !!(before || after) && (
                <View className='logs-item__detail'>
                  {before != null && (
                    <View className='logs-item__json'>
                      <Text className='logs-item__json-label'>变更前</Text>
                      <Text className='logs-item__json-text'>
                        {typeof before === 'string'
                          ? before
                          : JSON.stringify(before, null, 2)}
                      </Text>
                    </View>
                  )}
                  {after != null && (
                    <View className='logs-item__json'>
                      <Text className='logs-item__json-label'>变更后</Text>
                      <Text className='logs-item__json-text'>
                        {typeof after === 'string'
                          ? after
                          : JSON.stringify(after, null, 2)}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )
        })}
      </View>

      {/* 加载更多 / 到底提示 */}
      <View className='logs-footer'>
        {loadingMore && <Text className='logs-footer__text'>加载中...</Text>}
        {!loadingMore && !hasMore && list.length > 0 && (
          <Text className='logs-footer__text'>没有更多了</Text>
        )}
        {loading && list.length === 0 && (
          <Text className='logs-footer__text'>加载中...</Text>
        )}
      </View>

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
