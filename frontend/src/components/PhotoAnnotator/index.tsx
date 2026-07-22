import { useEffect, useRef, useState, useCallback } from 'react'
import { View, Text, Canvas } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { uploadFile } from '@/services/upload'
import './index.scss'

export type AnnotationTool = 'arrow' | 'dot'
export type AnnotationColor = 'red' | 'yellow' | 'blue'

export interface Annotation {
  type: AnnotationTool
  color: AnnotationColor
  startX: number
  startY: number
  endX: number
  endY: number
}

export interface PhotoAnnotatorProps {
  /** 图片完整 URL（可直接用于 Image.src） */
  imageUrl: string
  /** 保存成功后回调，参数为上传后的新 URL（相对路径，如 /uploads/xxx.jpg） */
  onSave: (newUrl: string) => void
  onCancel: () => void
}

const COLOR_MAP: Record<AnnotationColor, string> = {
  red: '#ff3b30',
  yellow: '#ffcc00',
  blue: '#007aff'
}

const CANVAS_ID = 'photo-annotator-canvas'

/**
 * 位置示意图标注器
 * - 全屏 fixed 覆盖层
 * - Taro Canvas 2D（type="2d"），通过 createSelectorQuery 获取节点
 * - 工具：箭头/圆点；颜色：红/黄/蓝；撤销；保存；取消
 * - 保存：canvasToTempFilePath → uploadFile → onSave(newUrl)
 * - H5 降级：canvasToTempFilePath 失败时用 canvas.toDataURL + Blob 上传
 */
/** Taro Canvas 2D 节点类型（小程序特有，H5 降级为标准 HTMLCanvasElement） */
interface TaroCanvasNode {
  getContext: (type: string) => CanvasRenderingContext2D
  createImage?: () => HTMLImageElement
  toDataURL?: (type?: string, quality?: number) => string
  width: number
  height: number
  getBoundingClientRect?: () => { width: number; height: number; left: number; top: number }
}

function PhotoAnnotator({ imageUrl, onSave, onCancel }: PhotoAnnotatorProps) {
  const canvasRef = useRef<TaroCanvasNode | HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const annotationsRef = useRef<Annotation[]>([])
  const currentAnnotationRef = useRef<Annotation | null>(null)
  const drawingRef = useRef(false)
  const objectUrlRef = useRef<string | null>(null)

  const [tool, setTool] = useState<AnnotationTool>('arrow')
  const [color, setColor] = useState<AnnotationColor>('red')
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)
  // 用于触发重绘的计数器
  const [, setRenderTick] = useState(0)
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  toolRef.current = tool
  colorRef.current = color

  // 初始化 Canvas 2D
  useEffect(() => {
    let cancelled = false
    const initCanvas = async () => {
      try {
        const sysInfo = Taro.getSystemInfoSync()
        const dpr = sysInfo.pixelRatio || 1

        const query = Taro.createSelectorQuery()
        query
          .select(`#${CANVAS_ID}`)
          .fields({ node: true, size: true, rect: true })
          .exec((res) => {
            if (cancelled || !res || !res[0] || !res[0].node) {
              console.error('[PhotoAnnotator] canvas node 获取失败', res)
              return
            }
            const canvas = res[0].node as TaroCanvasNode
            // 用 Canvas 节点的实际显示尺寸（CSS 像素），而非手动估算
            // 这是触摸坐标与绘制坐标一致的关键
            const canvasWidth = res[0].width || sysInfo.windowWidth
            const canvasHeight = res[0].height || Math.floor(sysInfo.windowHeight * 0.6)
            canvasSizeRef.current = { width: canvasWidth, height: canvasHeight }

            const ctx = canvas.getContext('2d')
            canvas.width = canvasWidth * dpr
            canvas.height = canvasHeight * dpr
            ctx.scale(dpr, dpr)
            canvasRef.current = canvas
            ctxRef.current = ctx
            // 加载图片
            const img = canvas.createImage ? canvas.createImage() : new Image()
            img.onload = () => {
              if (cancelled) return
              imgRef.current = img
              setReady(true)
              redraw()
            }
            img.onerror = () => {
              console.error('[PhotoAnnotator] 图片加载失败')
              Taro.showToast({ title: '图片加载失败', icon: 'none' })
            }
            img.src = imageUrl
          })
      } catch (e) {
        console.error('[PhotoAnnotator] initCanvas error', e)
      }
    }
    // 延迟一帧确保 Canvas 已挂载
    setTimeout(initCanvas, 50)
    return () => {
      cancelled = true
      // 释放 Object URL 防止内存泄漏
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  // 绘制单条标注
  const drawAnnotation = useCallback(
    (ctx: CanvasRenderingContext2D, ann: Annotation) => {
      ctx.save()
      ctx.strokeStyle = COLOR_MAP[ann.color]
      ctx.fillStyle = COLOR_MAP[ann.color]
      ctx.lineWidth = 3
      ctx.lineCap = 'round'

      if (ann.type === 'arrow') {
        const { startX, startY, endX, endY } = ann
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
        ctx.stroke()
        // 画箭头头部
        const angle = Math.atan2(endY - startY, endX - startX)
        const headLen = 12
        ctx.beginPath()
        ctx.moveTo(endX, endY)
        ctx.lineTo(
          endX - headLen * Math.cos(angle - Math.PI / 6),
          endY - headLen * Math.sin(angle - Math.PI / 6)
        )
        ctx.lineTo(
          endX - headLen * Math.cos(angle + Math.PI / 6),
          endY - headLen * Math.sin(angle + Math.PI / 6)
        )
        ctx.closePath()
        ctx.fill()
      } else {
        // dot：圆点
        const radius = 8
        ctx.beginPath()
        ctx.arc(ann.startX, ann.startY, radius, 0, 2 * Math.PI)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(ann.startX, ann.startY, radius + 2, 0, 2 * Math.PI)
        ctx.strokeStyle = COLOR_MAP[ann.color]
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.restore()
    },
    []
  )

  // 重绘：图片 + 所有标注 + 当前正在画的
  const redraw = useCallback(() => {
    const ctx = ctxRef.current
    const img = imgRef.current
    const { width, height } = canvasSizeRef.current
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    // 绘制图片（contain 模式，居中）
    if (img) {
      const imgRatio = img.width / img.height
      const boxRatio = width / height
      let drawW = width
      let drawH = height
      let dx = 0
      let dy = 0
      if (imgRatio > boxRatio) {
        drawH = width / imgRatio
        dy = (height - drawH) / 2
      } else {
        drawW = height * imgRatio
        dx = (width - drawW) / 2
      }
      ctx.drawImage(img, dx, dy, drawW, drawH)
    }
    // 绘制已有标注
    for (const ann of annotationsRef.current) {
      drawAnnotation(ctx, ann)
    }
    // 绘制当前正在画的
    if (currentAnnotationRef.current) {
      drawAnnotation(ctx, currentAnnotationRef.current)
    }
  }, [drawAnnotation])

  // 获取触摸点相对 canvas 的坐标（CSS 像素，与绘制坐标系一致）
  const getTouchPos = (e: any): { x: number; y: number } | null => {
    const touch = e.touches?.[0] || e.changedTouches?.[0]
    if (!touch) return null
    // 微信小程序 Canvas 2D：touch.x/y 是相对 Canvas 节点左上角的 CSS 像素坐标
    // 这与 ctx.scale(dpr,dpr) 后的绘制坐标系一致
    if (typeof touch.x === 'number' && typeof touch.y === 'number') {
      return { x: touch.x, y: touch.y }
    }
    // H5 降级：用 clientX/Y - canvas bounding rect
    if (typeof touch.clientX === 'number' && typeof touch.clientY === 'number') {
      const canvas = canvasRef.current
      if (canvas && typeof canvas.getBoundingClientRect === 'function') {
        const rect = canvas.getBoundingClientRect()
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
      }
      // 再降级：用 pageX/Y 减去 canvas 节点偏移（通过 createSelectorQuery 缓存）
      const { width, height } = canvasSizeRef.current
      if (width && height && typeof touch.pageX === 'number') {
        // 无法精确计算，返回 null 避免错误定位
        return null
      }
    }
    return null
  }

  const handleTouchStart = (e: any) => {
    if (!ready) return
    const pos = getTouchPos(e)
    if (!pos) return
    drawingRef.current = true
    currentAnnotationRef.current = {
      type: toolRef.current,
      color: colorRef.current,
      startX: pos.x,
      startY: pos.y,
      endX: pos.x,
      endY: pos.y
    }
    redraw()
  }

  const handleTouchMove = (e: any) => {
    if (!drawingRef.current) return
    const pos = getTouchPos(e)
    if (!pos || !currentAnnotationRef.current) return
    currentAnnotationRef.current.endX = pos.x
    currentAnnotationRef.current.endY = pos.y
    redraw()
  }

  const handleTouchEnd = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (currentAnnotationRef.current) {
      annotationsRef.current.push(currentAnnotationRef.current)
      currentAnnotationRef.current = null
    }
    redraw()
  }

  // 撤销
  const handleUndo = () => {
    if (annotationsRef.current.length === 0) {
      Taro.showToast({ title: '没有可撤销的标注', icon: 'none' })
      return
    }
    annotationsRef.current.pop()
    redraw()
    setRenderTick((t) => t + 1)
  }

  // 保存：canvasToTempFilePath → uploadFile → onSave
  const handleSave = async () => {
    if (saving) return
    const canvas = canvasRef.current
    if (!canvas) {
      Taro.showToast({ title: 'Canvas 未就绪', icon: 'none' })
      return
    }
    setSaving(true)
    Taro.showLoading({ title: '保存中...' })
    try {
      let tempFilePath: string | null = null
      // 路径1：Taro.canvasToTempFilePath（小程序 + H5 通用）
      // Taro 的 canvas 参数类型定义较宽松，这里传入实际 canvas 节点
      try {
        const res = await Taro.canvasToTempFilePath({
          canvas: canvas as unknown as Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas'],
          fileType: 'jpg',
          quality: 0.9,
          destWidth: canvas.width,
          destHeight: canvas.height
        })
        tempFilePath = res.tempFilePath
      } catch (e1) {
        console.warn('[PhotoAnnotator] canvasToTempFilePath 失败，尝试 H5 降级', e1)
      }
      // 路径2：H5 降级，用 toDataURL 转 Blob
      if (!tempFilePath && typeof canvas.toDataURL === 'function') {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        const blob = dataURLToBlob(dataUrl)
        if (blob) {
          // 释放旧的 Object URL（如果有）
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current)
          }
          const url = URL.createObjectURL(blob)
          objectUrlRef.current = url
          tempFilePath = url
        }
      }
      if (!tempFilePath) {
        throw new Error('生成图片失败')
      }
      // 上传
      const uploadRes = await uploadFile(tempFilePath)
      Taro.hideLoading()
      Taro.showToast({ title: '标注已保存', icon: 'success' })
      onSave(uploadRes.url)
    } catch (err) {
      Taro.hideLoading()
      const msg = err instanceof Error ? err.message : '保存失败'
      Taro.showToast({ title: msg, icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    if (saving) return
    onCancel()
  }

  // 工具切换时强制刷新（保证 ref 同步）
  const switchTool = (t: AnnotationTool) => {
    setTool(t)
    toolRef.current = t
  }
  const switchColor = (c: AnnotationColor) => {
    setColor(c)
    colorRef.current = c
  }

  return (
    <View className='photo-annotator'>
      <View className='photo-annotator__header'>
        <Text className='photo-annotator__title'>位置示意图标注</Text>
        <View className='photo-annotator__header-btns'>
          <Text
            className='photo-annotator__header-btn photo-annotator__header-btn--cancel'
            onClick={handleCancel}
          >
            取消
          </Text>
          <Text
            className={`photo-annotator__header-btn photo-annotator__header-btn--save ${saving ? 'is-disabled' : ''}`}
            onClick={handleSave}
          >
            {saving ? '保存中' : '保存'}
          </Text>
        </View>
      </View>

      <View className='photo-annotator__canvas-wrap'>
        <Canvas
          type='2d'
          id={CANVAS_ID}
          className='photo-annotator__canvas'
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ width: '100%', height: '100%' }}
        />
        {!ready && (
          <View className='photo-annotator__loading'>
            <Text>图片加载中...</Text>
          </View>
        )}
      </View>

      <View className='photo-annotator__toolbar'>
        <View className='photo-annotator__tool-group'>
          <Text className='photo-annotator__tool-label'>工具</Text>
          <View className='photo-annotator__tool-btns'>
            <Text
              className={`photo-annotator__tool-btn ${tool === 'arrow' ? 'is-active' : ''}`}
              onClick={() => switchTool('arrow')}
            >
              箭头
            </Text>
            <Text
              className={`photo-annotator__tool-btn ${tool === 'dot' ? 'is-active' : ''}`}
              onClick={() => switchTool('dot')}
            >
              圆点
            </Text>
          </View>
        </View>

        <View className='photo-annotator__tool-group'>
          <Text className='photo-annotator__tool-label'>颜色</Text>
          <View className='photo-annotator__tool-btns'>
            <Text
              className={`photo-annotator__color-btn photo-annotator__color-btn--red ${color === 'red' ? 'is-active' : ''}`}
              onClick={() => switchColor('red')}
            >
              红
            </Text>
            <Text
              className={`photo-annotator__color-btn photo-annotator__color-btn--yellow ${color === 'yellow' ? 'is-active' : ''}`}
              onClick={() => switchColor('yellow')}
            >
              黄
            </Text>
            <Text
              className={`photo-annotator__color-btn photo-annotator__color-btn--blue ${color === 'blue' ? 'is-active' : ''}`}
              onClick={() => switchColor('blue')}
            >
              蓝
            </Text>
          </View>
        </View>

        <View className='photo-annotator__tool-group'>
          <Text className='photo-annotator__tool-label'>操作</Text>
          <View className='photo-annotator__tool-btns'>
            <Text
              className='photo-annotator__tool-btn photo-annotator__tool-btn--undo'
              onClick={handleUndo}
            >
              撤销
            </Text>
          </View>
        </View>
      </View>

      <View className='photo-annotator__hint'>
        <Text>提示：在图片上滑动绘制箭头，点按放置圆点。最多可叠加多笔标注。</Text>
      </View>
    </View>
  )
}

/** dataURL 转 Blob（H5 降级用） */
function dataURLToBlob(dataUrl: string): Blob | null {
  try {
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  } catch {
    return null
  }
}

export default PhotoAnnotator
