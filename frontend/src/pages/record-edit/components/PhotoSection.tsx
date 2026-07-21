import { View, Text, Button, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { uploadFile, resolveFileUrl } from '@/services/upload'
import type { PhotoItem, AnnotatorState } from '../hooks/useRecordForm'

const MAX_PHOTOS = 3

interface PhotoSectionProps {
  photos: PhotoItem[]
  setPhotos: React.Dispatch<React.SetStateAction<PhotoItem[]>>
  setAnnotator: (v: AnnotatorState) => void
}

export default function PhotoSection({ photos, setPhotos, setAnnotator }: PhotoSectionProps) {
  const handleAddProductPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Taro.showToast({ title: `最多 ${MAX_PHOTOS} 张照片`, icon: 'none' })
      return
    }
    try {
      const chooseRes = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const tempFile = chooseRes.tempFiles?.[0]
      if (!tempFile) return
      Taro.showLoading({ title: '上传中...' })
      const upRes = await uploadFile(tempFile.tempFilePath)
      Taro.hideLoading()
      setPhotos((prev) => [...prev, { url: upRes.url, kind: 'product' }])
    } catch (e) {
      Taro.hideLoading()
      if (e instanceof Error && e.message && !e.message.includes('cancel')) {
        Taro.showToast({ title: e.message, icon: 'none' })
      }
    }
  }

  const handleAddLocationPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Taro.showToast({ title: `最多 ${MAX_PHOTOS} 张照片`, icon: 'none' })
      return
    }
    try {
      const chooseRes = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const tempFile = chooseRes.tempFiles?.[0]
      if (!tempFile) return
      Taro.showLoading({ title: '上传原图...' })
      const upRes = await uploadFile(tempFile.tempFilePath)
      Taro.hideLoading()
      setAnnotator({
        imageUrl: resolveFileUrl(upRes.url),
        originalUrl: upRes.url
      })
    } catch (e) {
      Taro.hideLoading()
      if (e instanceof Error && e.message && !e.message.includes('cancel')) {
        Taro.showToast({ title: e.message, icon: 'none' })
      }
    }
  }

  const handleRemovePhoto = (idx: number) => {
    Taro.showModal({
      title: '提示',
      content: '确定删除这张照片？',
      success: (r) => {
        if (r.confirm) {
          setPhotos((prev) => prev.filter((_, i) => i !== idx))
        }
      }
    })
  }

  return (
    <View className='record-edit__field'>
      <Text className='record-edit__label'>
        照片（最多 {MAX_PHOTOS} 张，可选）
      </Text>
      <View className='record-edit__photo-actions'>
        <Button
          className='record-edit__photo-btn'
          onClick={handleAddProductPhoto}
          disabled={photos.length >= MAX_PHOTOS}
          size='mini'
        >
          添加器材照片
        </Button>
        <Button
          className='record-edit__photo-btn record-edit__photo-btn--annotate'
          onClick={handleAddLocationPhoto}
          disabled={photos.length >= MAX_PHOTOS}
          size='mini'
        >
          添加摆放位置图
        </Button>
      </View>
      {photos.length > 0 && (
        <View className='record-edit__photo-list'>
          {photos.map((p, idx) => (
            <View key={idx} className='record-edit__photo-item'>
              <Image
                className='record-edit__photo-img'
                src={resolveFileUrl(p.url)}
                mode='aspectFill'
              />
              <View className='record-edit__photo-mask'>
                <Text className='record-edit__photo-tag'>
                  {p.isAnnotated ? '位置图(已标注)' : p.kind === 'annotated' ? '位置图' : '器材照'}
                </Text>
                <Text
                  className='record-edit__photo-del'
                  onClick={() => handleRemovePhoto(idx)}
                >
                  删除
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      <Text className='record-edit__photo-count'>
        已选 {photos.length}/{MAX_PHOTOS}
      </Text>
    </View>
  )
}
