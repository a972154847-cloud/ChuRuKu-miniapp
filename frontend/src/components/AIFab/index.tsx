import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useUserStore } from '@/store/user'
import { useAiChatStore } from '@/store/ai-chat'
import './index.scss'

/** 当前路由白名单：这些页面不显示 FAB */
const HIDE_ROUTES = ['/pages/login/index']

/** 点击与拖动的判定阈值（px） */
const DRAG_THRESHOLD = 5

interface TouchState {
  startX: number
  startY: number
  fabX: number
  fabY: number
  moved: boolean
}

/**
 * 全局 AI 助手浮动入口
 * - 登录态下显示，未登录点击 reLaunch login
 * - 不在白名单页面显示
 * - 可拖动到屏幕任意位置，松手自动贴边
 * - 点击（未拖动）调 openFloatingPanel() 打开浮窗
 */
export default function AIFab() {
  const panelMode = useAiChatStore((s) => s.panelMode)
  const openFloatingPanel = useAiChatStore((s) => s.openFloatingPanel)
  const token = useUserStore((s) => s.token)
  const [currentPath, setCurrentPath] = useState<string>('')

  // FAB 位置（默认右下角）
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const touchRef = useRef<TouchState | null>(null)
  const [dragging, setDragging] = useState(false)

  // 屏幕尺寸缓存
  const screenRef = useRef<{ w: number; h: number }>({ w: 375, h: 667 })
  const FAB_SIZE = 50 // 100rpx ≈ 50px
  const MARGIN = 16 // 边距

  const initScreenAndRoute = useCallback(() => {
    try {
      const router = Taro.getCurrentInstance().router
      setCurrentPath(router?.path || '')
      // 获取屏幕尺寸（仅一次）
      if (screenRef.current.w === 375) {
        const info = Taro.getWindowInfo()
        if (info && info.windowWidth) {
          screenRef.current = { w: info.windowWidth, h: info.windowHeight }
        }
      }
    } catch {
      setCurrentPath('')
    }
  }, [])

  // 初始化屏幕信息和当前路由（仅挂载时执行一次）
  useEffect(() => {
    initScreenAndRoute()
  }, [initScreenAndRoute])

  // FAB 打开浮窗后，自己隐藏
  const isOpen = panelMode === 'floating'
  const shouldShow = Boolean(token) && !HIDE_ROUTES.includes(currentPath) && !isOpen

  /** 打开 AI 面板（点击或 touch 后调用） */
  const handleOpen = useCallback(() => {
    if (!token) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    openFloatingPanel()
  }, [token, openFloatingPanel])

  const handleTouchStart = (e: any) => {
    const touch = e.touches?.[0] || e.changedTouches?.[0]
    if (!touch) return
    const { w, h } = screenRef.current
    // 默认位置：右下角
    const defaultX = w - FAB_SIZE - MARGIN
    const defaultY = h - FAB_SIZE - 120
    touchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      fabX: pos?.x ?? defaultX,
      fabY: pos?.y ?? defaultY,
      moved: false,
    }
  }

  const handleTouchMove = (e: any) => {
    const touch = e.touches?.[0] || e.changedTouches?.[0]
    if (!touch || !touchRef.current) return
    const dx = touch.clientX - touchRef.current.startX
    const dy = touch.clientY - touchRef.current.startY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      touchRef.current.moved = true
      setDragging(true)
      const { w, h } = screenRef.current
      const newX = Math.max(MARGIN, Math.min(touchRef.current.fabX + dx, w - FAB_SIZE - MARGIN))
      const newY = Math.max(MARGIN, Math.min(touchRef.current.fabY + dy, h - FAB_SIZE - MARGIN))
      setPos({ x: newX, y: newY })
    }
  }

  const handleTouchEnd = (e: any) => {
    const t = touchRef.current
    touchRef.current = null
    setDragging(false)
    if (t?.moved) {
      // 拖动结束 → 自动贴边
      if (pos) {
        const { w } = screenRef.current
        const centerX = pos.x + FAB_SIZE / 2
        const snapX = centerX < w / 2 ? MARGIN : w - FAB_SIZE - MARGIN
        setPos({ x: snapX, y: pos.y })
      }
      return
    }
    // 未拖动 → 点击行为
    handleOpen()
    e.stopPropagation?.()
  }

  /** 纯点击兜底：H5 / 部分模拟器下 touch 事件可能不触发 */
  const handleClick = useCallback((e: any) => {
    // 若 touchStart 已记录（说明走的 touch 通道），交由 handleTouchEnd 处理
    if (touchRef.current) return
    handleOpen()
    e.stopPropagation?.()
  }, [handleOpen])

  if (!shouldShow) return null

  const fabStyle: Record<string, string | number> = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }
    : {}

  return (
    <View
      className={`ai-fab ${dragging ? 'ai-fab--dragging' : ''}`}
      style={fabStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
      catchMove
      hoverClass='ai-fab--hover'
    >
      <Text className='ai-fab__icon'>🤖</Text>
    </View>
  )
}
