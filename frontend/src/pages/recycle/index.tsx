import { useEffect, useState, useCallback, useRef } from 'react'
import { View, Text, Picker, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import {
  listRecycleBin,
  restoreRecycleItem,
  deleteRecycleItem,
  type RecycleBinItem,
  type EntityType,
} from '@/services/recycle'
import { useUserStore } from '@/store/user'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import './index.scss'

const TYPE_OPTIONS: { label: string; value: EntityType | '' }[] = [
  { label: '全部类型', value: '' },
  { label: '出入库记录', value: 'record' },
  { label: '器材分类', value: 'category' },
]

const TYPE_LABEL: Record<string, string> = {
  record: '记录',
  category: '分类',
}

const PAGE_SIZE = 20

function formatTime(t: string): string {
  if (!t) return ''
  return t.length >= 16 ? t.slice(5, 16) : t
}

export default function RecyclePage() {
  const currentUser = useUserStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'

  const [list, setList] = useState<RecycleBinItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [typeIdx, setTypeIdx] = useState(0)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // 用 ref 跟踪当前页码，避免闭包过期问题
  const pageRef = useRef(1)

  /**
   * 统一的数据获取函数，参数全部显式传入，不依赖闭包中的 state。
   */
  const doFetch = useCallback(
    async (reset: boolean, tIdx: number) => {
      const nextPage = reset ? 1 : pageRef.current + 1
      if (reset) {
        setLoading(true)
      } else {
        setLoadingMore(true)
      }
      try {
        const entityType = TYPE_OPTIONS[tIdx].value || undefined
        const res = await listRecycleBin({
          entity_type: entityType as EntityType | undefined,
          page: nextPage,
          pageSize: PAGE_SIZE,
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

  useEffect(() => {
    if (isAdmin) {
      doFetch(true, typeIdx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // 下拉刷新
  Taro.usePullDownRefresh(async () => {
    await doFetch(true, typeIdx)
    Taro.stopPullDownRefresh()
  })

  // 上拉加载更多
  Taro.useReachBottom(() => {
    if (loadingMore || loading) return
    if (list.length >= total) return
    doFetch(false, typeIdx)
  })

  const handleTypeChange = (idx: number) => {
    setTypeIdx(idx)
    setList([])
    pageRef.current = 0
    doFetch(true, idx)
  }

  const handleRestore = async (item: RecycleBinItem) => {
    const confirm = await Taro.showModal({
      title: '确认恢复',
      content: `确定要恢复「${item.entity_summary || item.entity_type + '#' + item.entity_id}」吗？`,
    })
    if (!confirm.confirm) return

    setRestoringId(item.id)
    try {
      await restoreRecycleItem(item.id)
      Taro.showToast({ title: '恢复成功', icon: 'success' })
      // 从列表中移除
      setList((prev) => prev.filter((i) => i.id !== item.id))
      setTotal((prev) => Math.max(0, prev - 1))
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '恢复失败', icon: 'none' })
    } finally {
      setRestoringId(null)
    }
  }

  const handlePermanentDelete = async (item: RecycleBinItem) => {
    const confirm = await Taro.showModal({
      title: '确认永久删除',
      content: `确定要永久删除「${item.entity_summary || item.entity_type + '#' + item.entity_id}」吗？此操作不可恢复！`,
      cancelText: '取消',
      confirmText: '永久删除',
      confirmColor: '#ff4d4f',
    })
    if (!confirm.confirm) return

    const confirm2 = await Taro.showModal({
      title: '再次确认',
      content: '此操作不可逆，数据将永久丢失！',
      cancelText: '我再想想',
      confirmText: '确认删除',
      confirmColor: '#ff4d4f',
    })
    if (!confirm2.confirm) return

    setDeletingId(item.id)
    try {
      await deleteRecycleItem(item.id)
      Taro.showToast({ title: '已永久删除', icon: 'success' })
      // 从列表中移除
      setList((prev) => prev.filter((i) => i.id !== item.id))
      setTotal((prev) => Math.max(0, prev - 1))
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '删除失败', icon: 'none' })
    } finally {
      setDeletingId(null)
    }
  }

  if (!isAdmin) {
    return (
      <View className='recycle-page'>
        <View className='recycle-empty'>
          <Text className='recycle-empty__text'>无权限</Text>
        </View>
      </View>
    )
  }

  const hasMore = list.length < total

  return (
    <View className='recycle-page'>
      {/* 筛选条 */}
      <View className='recycle-filter'>
        <Picker
          mode='selector'
          range={TYPE_OPTIONS.map((a) => a.label)}
          value={typeIdx}
          onChange={(e) => handleTypeChange(Number(e.detail.value))}
        >
          <View className='recycle-filter__picker'>
            <Text>{TYPE_OPTIONS[typeIdx].label}</Text>
          </View>
        </Picker>
      </View>

      {/* 提示条 */}
      {list.length > 0 && (
        <View
          style={{
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '24px',
            color: '#ad8b00',
          }}
        >
          回收站中的数据可恢复或永久删除。恢复后数据将回到原位置。
        </View>
      )}

      {/* 列表 */}
      <View className='recycle-list'>
        {list.length === 0 && !loading && (
          <View className='recycle-empty'>
            <Text className='recycle-empty__text'>回收站为空</Text>
          </View>
        )}
        {list.map((item) => {
          const isRestoring = restoringId === item.id
          const isDeleting = deletingId === item.id
          const isProcessing = isRestoring || isDeleting

          return (
            <View key={item.id} className='recycle-item'>
              <View className='recycle-item__head'>
                <View style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <Text
                    className={`recycle-item__type-tag type-${item.entity_type}`}
                  >
                    {TYPE_LABEL[item.entity_type] || item.entity_type}
                  </Text>
                  <Text className='recycle-item__summary'>
                    {item.entity_summary || `${item.entity_type}#${item.entity_id}`}
                  </Text>
                </View>
                <Text className='recycle-item__time'>
                  {formatTime(item.deleted_at)}
                </Text>
              </View>
              <View className='recycle-item__meta'>
                <Text className='recycle-item__deleter'>
                  删除者：{item.deleted_by_name || `用户#${item.deleted_by}`}
                </Text>
              </View>
              <View className='recycle-item__actions'>
                <Button
                  className='recycle-item__restore-btn'
                  size='mini'
                  loading={isRestoring}
                  disabled={isProcessing}
                  onClick={() => handleRestore(item)}
                >
                  {isRestoring ? '恢复中...' : '恢复'}
                </Button>
                <Button
                  className='recycle-item__delete-btn'
                  size='mini'
                  loading={isDeleting}
                  disabled={isProcessing}
                  onClick={() => handlePermanentDelete(item)}
                >
                  {isDeleting ? '删除中...' : '永久删除'}
                </Button>
              </View>
            </View>
          )
        })}
      </View>

      {/* 加载更多 / 到底提示 */}
      <View className='recycle-footer'>
        {loadingMore && <Text className='recycle-footer__text'>加载中...</Text>}
        {!loadingMore && !hasMore && list.length > 0 && (
          <Text className='recycle-footer__text'>没有更多了</Text>
        )}
        {loading && list.length === 0 && (
          <Text className='recycle-footer__text'>加载中...</Text>
        )}
      </View>

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
