import { useState } from 'react'
import { View, Image as TaroImage } from '@tarojs/components'
import { resolveFileUrl } from '@/services/upload'
import './index.scss'

export interface ImageProps {
  src: string
  thumbnailUrl?: string | null
  mode?: string
  lazyLoad?: boolean
  className?: string
  style?: Record<string, string>
}

export default function Image({
  src,
  thumbnailUrl,
  mode = 'aspectFill',
  lazyLoad = true,
  className = '',
  style
}: ImageProps) {
  const [currentSrc, setCurrentSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const resolvedSrc = resolveFileUrl(src)
  const resolvedThumbnailUrl = thumbnailUrl ? resolveFileUrl(thumbnailUrl) : null

  useState(() => {
    if (resolvedThumbnailUrl) {
      setCurrentSrc(resolvedThumbnailUrl)
    } else {
      setCurrentSrc(resolvedSrc)
    }
  })

  const handleLoad = () => {
    setLoading(false)
    setError(false)
  }

  const handleError = () => {
    if (currentSrc === resolvedThumbnailUrl && resolvedThumbnailUrl !== resolvedSrc) {
      setCurrentSrc(resolvedSrc)
    } else {
      setLoading(false)
      setError(true)
    }
  }

  if (error) {
    return (
      <View className={`image-placeholder ${className}`} style={style}>
        <View className='image-placeholder__icon'>📷</View>
        <View className='image-placeholder__text'>图片加载失败</View>
      </View>
    )
  }

  return (
    <View className={`image-wrapper ${loading ? 'image-wrapper--loading' : ''}`}>
      {loading && (
        <View className='image-loading'>
          <View className='image-loading__spinner' />
        </View>
      )}
      <TaroImage
        className={`image ${className}`}
        src={currentSrc || resolvedSrc}
        mode={mode}
        lazyLoad={lazyLoad}
        onLoad={handleLoad}
        onError={handleError}
        style={style}
      />
    </View>
  )
}