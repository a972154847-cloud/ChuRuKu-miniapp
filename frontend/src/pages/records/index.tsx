import { useState, useCallback, useRef, useEffect } from 'react'
import { View, Text, Picker, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  listRecords,
  type RecordListItem,
  type ListRecordsParams
} from '@/services/records'
import type { RecordType } from '@/types'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import './index.scss'

const PAGE_SIZE = 20

/** 类型筛选选项 */
const TYPE_OPTIONS: { label: string; value: '' | RecordType }[] = [
  { label: '全部类型', value: '' },
  { label: '入库', value: 'in' },
  { label: '出库', value: 'out' }
]

/** 时间范围筛选选项 */
const RANGE_OPTIONS: { label: string; value: 'all' | 'today' | '7d' | '30d' }[] = [
  { label: '全部时间', value: 'all' },
  { label: '今天', value: 'today' },
  { label: '近7天', value: '7d' },
  { label: '近30天', value: '30d' }
]

/** 格式化日期为 YYYY-MM-DD（本地时区） */
function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 根据范围选项计算 start_date / end_date */
function resolveDateRange(
  range: 'all' | 'today' | '7d' | '30d'
): { start_date?: string; end_date?: string } {
  if (range === 'all') return {}
  const now = new Date()
  const end = formatDate(now)
  let start = end
  if (range === 'today') {
    start = end
  } else if (range === '7d') {
    const s = new Date(now)
    s.setDate(s.getDate() - 6)
    start = formatDate(s)
  } else if (range === '30d') {
    const s = new Date(now)
    s.setDate(s.getDate() - 29)
    start = formatDate(s)
  }
  return { start_date: start, end_date: end }
}

/** 格式化展示时间：'YYYY-MM-DD HH:MM:SS' → 'MM-DD HH:MM' */
function formatTime(t?: string | null): string {
  if (!t) return ''
  return t.length >= 16 ? t.slice(5, 16) : t
}

export default function RecordsPage() {
  const [list, setList] = useState<RecordListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  // 筛选状态
  const [typeIdx, setTypeIdx] = useState(0)
  const [rangeIdx, setRangeIdx] = useState(0)
  const [keyword, setKeyword] = useState('')

  // P1-23: ref to track last filter, avoid resetting list on every tab show
  const lastFilterRef = useRef({ typeIdx: 0, rangeIdx: 0, keyword: '' })
  // ref to track list length, avoid useDidShow closure reading stale state
  const listLenRef = useRef(0)

  // P2-9: render 内不再 sync 读 storage；启动时异步加载 token 状态，
  // 避免 mount 时同步 IO 阻塞 React 渲染管线（H5 / 真机均受益）
  const [hasToken, setHasToken] = useState(false)
  useEffect(() => {
    let cancelled = false
    // Taro.getStorage 是 Promise API，底层 wx.getStorageInfo / wx.getStorage
    // 在主线程外调度，不阻塞 JS 线程
    Taro.getStorage({ key: 'token' })
      .then((res) => {
        if (!cancelled) setHasToken(Boolean(res.data))
      })
      .catch(() => {
        // storage 中无此 key（getStorage fail 分支）→ 视为未登录
        if (!cancelled) setHasToken(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** 构造当前筛选参数（过滤 undefined，避免 Taro 把 undefined 序列化为字符串 "undefined"） */
  const buildParams = useCallback(
    (overridePage?: number): ListRecordsParams => {
      const type = TYPE_OPTIONS[typeIdx].value
      const range = RANGE_OPTIONS[rangeIdx].value
      const { start_date, end_date } = resolveDateRange(range)
      const params: ListRecordsParams = {
        page: overridePage ?? 1,
        pageSize: PAGE_SIZE
      }
      // 仅当有值时才加入参数，避免发送 undefined 被序列化为字符串
      if (type) params.type = type as RecordType
      const kw = keyword.trim()
      if (kw) params.keyword = kw
      if (start_date) params.start_date = start_date
      if (end_date) params.end_date = end_date
      return params
    },
    [typeIdx, rangeIdx, keyword]
  )

  /** 重置加载（筛选变化或下拉刷新时调用） */
  const fetchListReset = useCallback(
    async (params?: ListRecordsParams) => {
      setLoading(true)
      try {
        const p = params ?? buildParams(1)
        const res = await listRecords(p)
        setList(res.list || [])
        listLenRef.current = (res.list || []).length
        setTotal(res.total || 0)
        setPage(res.page || 1)
        setHasMore(Boolean(res.has_more))
      } catch {
        // 错误已由 request.ts toast
      } finally {
        setLoading(false)
      }
    },
    [buildParams]
  )

  /** 加载更多 */
  const fetchListMore = useCallback(async () => {
    if (loadingMore || loading) return
    if (!hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const res = await listRecords(buildParams(nextPage))
      setList((prev) => {
        const next = [...prev, ...(res.list || [])]
        listLenRef.current = next.length
        return next
      })
      setTotal(res.total || 0)
      setPage(res.page || nextPage)
      setHasMore(Boolean(res.has_more))
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }, [buildParams, page, loadingMore, loading, hasMore])

  // 首次加载 / 登录后加载
  // 直接从 storage 读取 token，不依赖 zustand store（避免闭包陷阱）
  useDidShow(() => {
    const storedToken = Taro.getStorageSync('token')
    if (!storedToken) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    // P0-10: read filter from equipments page (switchTab cannot pass query)
    const filter = Taro.getStorageSync('records_filter')
    if (filter && filter.keyword !== undefined) {
      setKeyword(filter.keyword)
      Taro.removeStorageSync('records_filter')
      lastFilterRef.current = { typeIdx, rangeIdx, keyword: filter.keyword }
      fetchListReset(buildParamsWith(1, typeIdx, rangeIdx, filter.keyword))
      return
    }
    // P1-23: no new filter, keep current list and page state, do not reset.
    // Only load on first entry (empty list); pull-to-refresh for latest data.
    if (listLenRef.current === 0) {
      lastFilterRef.current = { typeIdx, rangeIdx, keyword }
      fetchListReset()
    }
  })

  // 下拉刷新
  Taro.usePullDownRefresh(async () => {
    await fetchListReset()
    Taro.stopPullDownRefresh()
  })

  // 上拉加载更多
  Taro.useReachBottom(() => {
    fetchListMore()
  })

  /** 类型切换 */
  const handleTypeChange = (idx: number) => {
    setTypeIdx(idx)
    lastFilterRef.current = { typeIdx: idx, rangeIdx, keyword }
    fetchListReset(buildParamsWith(1, idx, rangeIdx, keyword))
  }

  /** 时间范围切换 */
  const handleRangeChange = (idx: number) => {
    setRangeIdx(idx)
    lastFilterRef.current = { typeIdx, rangeIdx: idx, keyword }
    fetchListReset(buildParamsWith(1, typeIdx, idx, keyword))
  }

  /** 搜索触发（点击搜索按钮或键盘 confirm） */
  const handleSearch = () => {
    lastFilterRef.current = { typeIdx, rangeIdx, keyword }
    fetchListReset(buildParamsWith(1, typeIdx, rangeIdx, keyword))
  }

  /** 重置所有筛选 */
  const handleReset = () => {
    setTypeIdx(0)
    setRangeIdx(0)
    setKeyword('')
    lastFilterRef.current = { typeIdx: 0, rangeIdx: 0, keyword: '' }
    fetchListReset(buildParamsWith(1, 0, 0, ''))
  }

  /** 用显式参数构造请求（避免 setState 异步导致闭包旧值） */
  const buildParamsWith = (
    p: number,
    tIdx: number,
    rIdx: number,
    kw: string
  ): ListRecordsParams => {
    const type = TYPE_OPTIONS[tIdx].value
    const range = RANGE_OPTIONS[rIdx].value
    const { start_date, end_date } = resolveDateRange(range)
    const params: ListRecordsParams = {
      page: p,
      pageSize: PAGE_SIZE
    }
    if (type) params.type = type as RecordType
    const trimmedKw = kw.trim()
    if (trimmedKw) params.keyword = trimmedKw
    if (start_date) params.start_date = start_date
    if (end_date) params.end_date = end_date
    return params
  }

  /** 跳转详情 */
  const goDetail = (id: number) => {
    Taro.navigateTo({ url: `/pages/record-detail/index?id=${id}` })
  }

  /** 跳转新建 */
  const goEdit = () => {
    Taro.navigateTo({ url: '/pages/record-edit/index' })
  }

  // 渲染前使用 state 变量判断 token，避免 render 阶段同步 IO
  if (!hasToken) {
    return <View className='records-page'><Text> </Text></View>
  }

  return (
    <View className='records-page'>
      {/* 顶部筛选条 */}
      <View className='records-filter'>
        <View className='records-filter__row'>
          <Picker
            mode='selector'
            range={TYPE_OPTIONS.map((t) => t.label)}
            value={typeIdx}
            onChange={(e) => handleTypeChange(Number(e.detail.value))}
          >
            <View className='records-filter__picker'>
              <Text className='records-filter__picker-text'>
                {TYPE_OPTIONS[typeIdx].label}
              </Text>
              <Text className='records-filter__arrow'>▾</Text>
            </View>
          </Picker>
          <Picker
            mode='selector'
            range={RANGE_OPTIONS.map((r) => r.label)}
            value={rangeIdx}
            onChange={(e) => handleRangeChange(Number(e.detail.value))}
          >
            <View className='records-filter__picker'>
              <Text className='records-filter__picker-text'>
                {RANGE_OPTIONS[rangeIdx].label}
              </Text>
              <Text className='records-filter__arrow'>▾</Text>
            </View>
          </Picker>
        </View>
        <View className='records-filter__row records-filter__row--search'>
          <Input
            className='records-filter__input'
            type='text'
            value={keyword}
            placeholder='搜索器材名称'
            confirmType='search'
            onInput={(e) => setKeyword(e.detail.value)}
            onConfirm={handleSearch}
          />
          <Text className='records-filter__search-btn' onClick={handleSearch}>
            搜索
          </Text>
          <Text className='records-filter__reset-btn' onClick={handleReset}>
            重置
          </Text>
        </View>
      </View>

      {/* 记录列表 */}
      <View className='records-list'>
        {list.length === 0 && !loading && (
          <View className='records-empty'>
            <Text className='records-empty__text'>暂无记录</Text>
            <Text className='records-empty__sub'>点击右下角按钮新建记录</Text>
          </View>
        )}
        {list.map((r) => (
          <View
            key={r.id}
            className='records-card'
            onClick={() => goDetail(r.id)}
          >
            <View className='records-card__head'>
              <Text
                className={`records-card__tag records-card__tag--${r.type}`}
              >
                {r.type === 'in' ? '入库' : '出库'}
              </Text>
              <Text className='records-card__time'>
                {formatTime(r.created_at)}
              </Text>
            </View>
            <View className='records-card__body'>
              <Text className='records-card__name'>
                {r.equipment_name || `器材#${r.equipment_id}`}
              </Text>
            </View>
            <View className='records-card__foot'>
              <Text className='records-card__qty'>
                数量：<Text className='records-card__qty-num'>{r.quantity}</Text>
              </Text>
              <Text className='records-card__operator'>
                {r.operator_name || `用户#${r.operator_id}`}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* 底部加载状态 */}
      <View className='records-footer'>
        {loading && list.length === 0 && (
          <Text className='records-footer__text'>加载中...</Text>
        )}
        {loadingMore && <Text className='records-footer__text'>加载更多...</Text>}
        {!loadingMore && !hasMore && list.length > 0 && (
          <Text className='records-footer__text'>
            没有更多了（共 {total} 条）
          </Text>
        )}
      </View>

      {/* 新建记录悬浮按钮 */}
      <View className='records-fab' onClick={goEdit}>
        <Text className='records-fab__plus'>+</Text>
      </View>

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
