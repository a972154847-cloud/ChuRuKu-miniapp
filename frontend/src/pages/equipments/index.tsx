import { View, Text, Input } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState, useCallback } from 'react'
import {
  listEquipments,
  type EquipmentStockItem,
  type ListEquipmentsParams,
} from '@/services/equipments'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import './index.scss'

const PAGE_SIZE = 20

export default function EquipmentsPage() {
  const [list, setList] = useState<EquipmentStockItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [keyword, setKeyword] = useState('')

  const buildParams = useCallback(
    (overridePage?: number): ListEquipmentsParams => {
      const params: ListEquipmentsParams = {
        page: overridePage ?? 1,
        pageSize: PAGE_SIZE,
      }
      const kw = keyword.trim()
      if (kw) params.keyword = kw
      return params
    },
    [keyword]
  )

  const fetchListReset = useCallback(
    async (params?: ListEquipmentsParams) => {
      setLoading(true)
      try {
        const p = params ?? buildParams(1)
        const res = await listEquipments(p)
        setList(res.list || [])
        setTotal(res.total || 0)
        setPage(res.page || 1)
        setHasMore(Boolean((res.page || 1) * PAGE_SIZE < (res.total || 0)))
      } catch {
        // 错误已由 request.ts toast
      } finally {
        setLoading(false)
      }
    },
    [buildParams]
  )

  const fetchListMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const res = await listEquipments(buildParams(nextPage))
      setList((prev) => [...prev, ...(res.list || [])])
      setTotal(res.total || 0)
      setPage(res.page || nextPage)
      setHasMore(Boolean((res.page || nextPage) * PAGE_SIZE < (res.total || 0)))
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }, [buildParams, page, loadingMore, loading, hasMore])

  useDidShow(() => {
    const storedToken = Taro.getStorageSync('token')
    if (!storedToken) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    fetchListReset()
  })

  usePullDownRefresh(() => {
    fetchListReset().finally(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    fetchListMore()
  })

  const onKeywordChange = (e: any) => {
    setKeyword(e.detail.value)
  }

  const onSearch = () => {
    fetchListReset()
  }

  const onClearKeyword = () => {
    setKeyword('')
    fetchListReset(buildParamsWithKeyword(1, ''))
  }

  const buildParamsWithKeyword = (p: number, kw: string): ListEquipmentsParams => {
    const params: ListEquipmentsParams = { page: p, pageSize: PAGE_SIZE }
    const trimmed = kw.trim()
    if (trimmed) params.keyword = trimmed
    return params
  }

  // 跳转到该器材的出入库记录
  // 注意：records 是 tabBar 页，navigateTo 跳 tabBar 在小程序中非法，
  // 且 switchTab 不支持 query 参数。改用 storage 传递 keyword。
  const goToRecords = (item: EquipmentStockItem) => {
    Taro.setStorageSync('records_filter', { keyword: item.name })
    Taro.switchTab({ url: '/pages/records/index' })
  }

  return (
    <View className='equipments-page'>
      <View className='equipments-header'>
        <Text className='equipments-header__title'>器材库存</Text>
        <Text className='equipments-header__count'>共 {total} 种</Text>
      </View>

      <View className='equipments-search'>
        <Input
          className='equipments-search__input'
          type='text'
          placeholder='搜索器材名称'
          value={keyword}
          onInput={onKeywordChange}
          onConfirm={onSearch}
        />
        <Text className='equipments-search__btn' onClick={onSearch}>
          搜索
        </Text>
        {keyword && (
          <Text className='equipments-search__clear' onClick={onClearKeyword}>
            ✕
          </Text>
        )}
      </View>

      <View className='equipments-list'>
        {list.length === 0 && !loading && (
          <View className='equipments-empty'>
            <Text className='equipments-empty__text'>暂无器材数据</Text>
          </View>
        )}

        {list.map((item) => (
          <View
            key={item.id}
            className='equipments-item'
            onClick={() => goToRecords(item)}
          >
            <View className='equipments-item__main'>
              <Text className='equipments-item__name'>{item.name}</Text>
              <Text className='equipments-item__sub'>
                {item.category_name || '未分类'}
                {item.spec ? ` · ${item.spec}` : ''}
              </Text>
            </View>
            <View className='equipments-item__stock'>
              <Text
                className={`equipments-item__qty ${
                  item.current_stock <= (item.threshold || 0)
                    ? 'equipments-item__qty--low'
                    : ''
                }`}
              >
                {item.current_stock}
              </Text>
              <Text className='equipments-item__unit'>件</Text>
            </View>
          </View>
        ))}

        {loadingMore && (
          <View className='equipments-loading-more'>
            <Text>加载中...</Text>
          </View>
        )}
        {!hasMore && list.length > 0 && (
          <View className='equipments-loading-more'>
            <Text>没有更多了</Text>
          </View>
        )}
      </View>

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
