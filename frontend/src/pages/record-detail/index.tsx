import { useState } from 'react'
import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro, { useLoad } from '@tarojs/taro'
import {
  getRecordById,
  deleteRecord,
  type RecordDetail,
  type RecordPhoto,
  type RecordRelatedLog
} from '@/services/records'
import { resolveFileUrl } from '@/services/upload'
import { useUserStore } from '@/store/user'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import './index.scss'

/** 日志动作中文映射 */
const ACTION_LABELS: Record<string, string> = {
  'record.create': '创建记录',
  'record.update': '更新记录',
  'record.delete': '删除记录',
  'record.attach_photos': '关联照片',
  'record.detach_photo': '删除照片'
}

/** 照片类型中文映射 */
const PHOTO_KIND_LABELS: Record<string, string> = {
  product: '器材照片',
  location: '位置照片',
  annotated: '标注照片',
  video: '视频'
}

/** 格式化完整时间：后端返回 'YYYY-MM-DD HH:MM:SS'，原样展示 */
function formatFullTime(t?: string | null): string {
  if (!t) return ''
  return t
}

export default function RecordDetailPage() {
  const token = useUserStore((s) => s.token)
  const user = useUserStore((s) => s.user)

  const [record, setRecord] = useState<RecordDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useLoad((options) => {
    if (!token) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    const id = Number(options?.id)
    if (!Number.isFinite(id) || id <= 0) {
      Taro.showToast({ title: '非法记录 id', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    fetchDetail(id)
  })

  const fetchDetail = async (id: number) => {
    setLoading(true)
    try {
      const data = await getRecordById(id)
      setRecord(data)
    } catch {
      // 错误已由 request.ts toast
    } finally {
      setLoading(false)
    }
  }

  /** 照片预览（仅图片，视频单独处理） */
  const handlePreviewImage = (photos: RecordPhoto[], current: RecordPhoto) => {
    const imagePhotos = photos.filter((p) => p.kind !== 'video')
    const urls = imagePhotos.map((p) => resolveFileUrl(p.url))
    const currentUrl = resolveFileUrl(current.url)
    Taro.previewImage({ urls, current: currentUrl })
  }

  /** 视频预览 */
  const handlePreviewVideo = (photo: RecordPhoto) => {
    const url = resolveFileUrl(photo.url)
    // H5 直接打开链接；小程序用 previewMedia（需基础库 2.13.0+）
    // 兜底：复制链接到剪贴板
    // #ifdef H5
    window.open(url, '_blank')
    // #endif
    // #ifndef H5
    // 注意：不能用 Taro.previewMedia?.(...).catch(...) 链式写法，
    // 因为 ?.() 短路返回 undefined 时 .catch 会抛 TypeError。
    if (typeof Taro.previewMedia === 'function') {
      Taro.previewMedia({
        sources: [{ url, type: 'video' }]
      }).catch((err: any) => {
        console.error('previewMedia failed', err)
        Taro.setClipboardData({ data: url })
        Taro.showToast({ title: '视频链接已复制', icon: 'none' })
      })
    } else {
      // 基础库不支持 previewMedia，退回复制链接
      Taro.setClipboardData({ data: url })
      Taro.showToast({ title: '视频链接已复制', icon: 'none' })
    }
    // #endif
  }

  /** 删除记录 */
  const handleDelete = () => {
    if (!record) return
    if (deleting) return
    Taro.showModal({
      title: '确认删除',
      content: `确定删除该${record.type === 'in' ? '入库' : '出库'}记录？此操作不可恢复。`,
      confirmText: '删除',
      confirmColor: '#d9534f',
      success: (r) => {
        if (!r.confirm) return
        doDelete()
      }
    })
  }

  const doDelete = async () => {
    if (!record) return
    setDeleting(true)
    Taro.showLoading({ title: '删除中...' })
    try {
      await deleteRecord(record.id)
      Taro.hideLoading()
      Taro.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 800)
    } catch (e) {
      Taro.hideLoading()
      const msg = e instanceof Error ? e.message : '删除失败'
      Taro.showToast({ title: msg, icon: 'none' })
    } finally {
      setDeleting(false)
    }
  }

  const handleMore = () => {
    if (!canDelete) return
    Taro.showActionSheet({
      itemList: ['删除记录'],
      itemColor: '#bd4d40',
      success: (result) => {
        if (result.tapIndex === 0) handleDelete()
      }
    })
  }

  if (!token) {
    return <View className='record-detail'><Text> </Text></View>
  }

  if (loading) {
    return (
      <View className='record-detail'>
        <View className='record-detail__loading'>
          <Text className='record-detail__loading-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  if (!record) {
    return (
      <View className='record-detail'>
        <View className='record-detail__empty'>
          <Text className='record-detail__empty-text'>记录不存在</Text>
        </View>
      </View>
    )
  }

  const photos = record.photos || []
  const logs = record.related_logs || []
  const canDelete = user?.role === 'admin'
  const canEdit = user && (user.role === 'admin' || user.role === 'editor')

  return (
    <View className='record-detail'>
      {/* 顶部基本信息卡片 */}
      <View className='record-detail__card record-detail__hero'>
        <View className='record-detail__hero-head'>
          <Text
            className={`record-detail__tag record-detail__tag--${record.type}`}
          >
            {record.type === 'in' ? '入库' : '出库'}
          </Text>
          {canDelete && <Text className='record-detail__more' onClick={handleMore}>更多</Text>}
        </View>
        <Text className='record-detail__name'>
          {record.equipment?.name || `器材#${record.equipment_id}`}
        </Text>
        <View className='record-detail__qty-box'>
          <Text className='record-detail__qty-label'>数量</Text>
          <Text
            className={`record-detail__qty-num record-detail__qty-num--${record.type}`}
          >
            {record.type === 'in' ? '+' : '-'}{record.quantity}
          </Text>
        </View>
        <View className='record-detail__meta'>
          <View className='record-detail__meta-item'>
            <Text className='record-detail__meta-label'>操作人</Text>
            <Text className='record-detail__meta-value'>
              {record.operator?.name || `用户#${record.operator_id}`}
            </Text>
          </View>
          <View className='record-detail__meta-item'>
            <Text className='record-detail__meta-label'>操作时间</Text>
            <Text className='record-detail__meta-value'>
              {formatFullTime(record.created_at)}
            </Text>
          </View>
        </View>
      </View>

      {/* 扩展字段卡片 */}
      {(record.remark || record.recipient || record.purpose || record.expected_return_at) && (
        <View className='record-detail__card record-detail__fields'>
          {record.recipient && (
            <View className='record-detail__field-row'>
              <Text className='record-detail__field-label'>领用人</Text>
              <Text className='record-detail__field-value'>{record.recipient}</Text>
            </View>
          )}
          {record.purpose && (
            <View className='record-detail__field-row'>
              <Text className='record-detail__field-label'>用途</Text>
              <Text className='record-detail__field-value'>{record.purpose}</Text>
            </View>
          )}
          {record.expected_return_at && (
            <View className='record-detail__field-row'>
              <Text className='record-detail__field-label'>预计归还</Text>
              <Text className='record-detail__field-value'>
                {record.expected_return_at}
              </Text>
            </View>
          )}
          {record.remark && (
            <View className='record-detail__field-row'>
              <Text className='record-detail__field-label'>备注</Text>
              <Text className='record-detail__field-value'>{record.remark}</Text>
            </View>
          )}
        </View>
      )}

      {/* 照片画廊 */}
      {photos.length > 0 && (
        <View className='record-detail__card record-detail__gallery'>
          <Text className='record-detail__section-title'>照片 ({photos.length})</Text>
          <ScrollView scrollX className='record-detail__gallery-scroll'>
            <View className='record-detail__gallery-list'>
              {photos.map((p) => (
                <View
                  key={p.id}
                  className='record-detail__photo-item'
                  onClick={() =>
                    p.kind === 'video'
                      ? handlePreviewVideo(p)
                      : handlePreviewImage(photos, p)
                  }
                >
                  {p.kind === 'video' ? (
                    <View className='record-detail__photo-video'>
                      <Text className='record-detail__photo-video-icon'>▶</Text>
                      <Text className='record-detail__photo-video-text'>视频</Text>
                    </View>
                  ) : (
                    <Image
                      className='record-detail__photo-img'
                      src={resolveFileUrl(p.thumbnail_url || p.url)}
                      mode='aspectFill'
                      lazyLoad
                    />
                  )}
                  <Text className='record-detail__photo-kind'>
                    {PHOTO_KIND_LABELS[p.kind] || p.kind}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {/* 操作日志时间线 */}
      <View className='record-detail__card record-detail__timeline'>
        <Text className='record-detail__section-title'>
          操作日志 ({logs.length})
        </Text>
        {logs.length === 0 ? (
          <Text className='record-detail__timeline-empty'>暂无操作日志</Text>
        ) : (
          <View className='record-detail__timeline-list'>
            {logs.map((log: RecordRelatedLog, idx: number) => (
              <View
                key={log.id}
                className={`record-detail__timeline-item ${
                  idx === logs.length - 1 ? 'is-last' : ''
                }`}
              >
                <View className='record-detail__timeline-dot' />
                {idx < logs.length - 1 && (
                  <View className='record-detail__timeline-line' />
                )}
                <View className='record-detail__timeline-content'>
                  <View className='record-detail__timeline-head'>
                    <Text className='record-detail__timeline-action'>
                      {ACTION_LABELS[log.action] || log.action}
                    </Text>
                    <Text className='record-detail__timeline-time'>
                      {formatFullTime(log.created_at)}
                    </Text>
                  </View>
                  <Text className='record-detail__timeline-actor'>
                    {log.actor_name || (log.actor_id ? `用户#${log.actor_id}` : '系统')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 操作按钮（仅 Admin/Editor 可见） */}
      {canEdit && (
        <View className='record-detail__actions'>
          {canEdit && (
            <Text
              className='record-detail__edit-btn'
              onClick={() => Taro.navigateTo({ url: `/pages/record-edit/index?id=${record.id}` })}
            >
              编辑记录
            </Text>
          )}
        </View>
      )}

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
