/**
 * Vitest 全局 setup
 * - 注册 @testing-library/jest-dom matchers
 * - mock @tarojs/components（映射到原生 DOM）
 * - mock @tarojs/taro（覆盖所有用到的 Taro API）
 *
 * 测试中 import '@tarojs/components' 的 View/Text/Input/Button/Picker/Image/Canvas
 * 会渲染为 div/span/input/button/select/img/canvas，可被 testing-library 查询。
 */
import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// 每个测试后自动清理 DOM
afterEach(() => {
  cleanup()
})

/* ---------------------------------------------------------------------------
 * Mock @tarojs/components
 * 把 Taro 组件映射到原生 DOM 元素，保留 className/style/onClick 等通用 props
 * ------------------------------------------------------------------------- */
const React = require('react')

function makeDom(tag: string, displayName?: string) {
  const Comp = React.forwardRef((props: any, ref: any) => {
    const { children, ...rest } = props || {}
    return React.createElement(tag, { ...rest, ref }, children)
  })
  if (displayName) Comp.displayName = displayName
  return Comp
}

vi.mock('@tarojs/components', () => {
  const View = makeDom('div', 'View')
  const Text = makeDom('span', 'Text')
  const Input = makeDom('input', 'Input')
  const Textarea = makeDom('textarea', 'Textarea')
  const Button = makeDom('button', 'Button')
  const Image = makeDom('img', 'Image')
  const Canvas = makeDom('canvas', 'Canvas')
  const ScrollView = makeDom('div', 'ScrollView')
  // Picker 在 H5 端行为复杂，这里简化为 div + 触发 onChange
  // multiSelector / date / selector 等模式统一用 div 容器
  const Picker = React.forwardRef((props: any, ref: any) => {
    const { children, onChange, onColumnChange, ...rest } = props || {}
    return React.createElement(
      'div',
      {
        ...rest,
        ref,
        'data-mode': props.mode || 'selector',
        onClick: () => {
          // 模拟确认选择：触发 onChange
          if (onChange && props.mode === 'date') {
            onChange({ detail: { value: '2026-07-16' } })
          } else if (onChange && props.mode === 'multiSelector') {
            onChange({ detail: { value: [0, 0] } })
          } else if (onChange) {
            onChange({ detail: { value: '0' } })
          }
        }
      },
      children
    )
  })
  Picker.displayName = 'Picker'
  return {
    View,
    Text,
    Input,
    Textarea,
    Button,
    Image,
    Canvas,
    ScrollView,
    Picker
  }
})

/* ---------------------------------------------------------------------------
 * Mock @tarojs/taro
 * 覆盖项目中用到的所有 Taro API，避免运行时未定义
 * ------------------------------------------------------------------------- */
const storage: Record<string, any> = {}

vi.mock('@tarojs/taro', () => {
  const Taro = {
    // 存储
    getStorageSync: (key: string) => storage[key] ?? '',
    setStorageSync: (key: string, value: any) => {
      storage[key] = value
    },
    removeStorageSync: (key: string) => {
      delete storage[key]
    },
    clearStorageSync: () => {
      for (const k of Object.keys(storage)) delete storage[k]
    },
    // Toast / Loading
    showToast: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    showModal: vi.fn().mockResolvedValue({ confirm: false, cancel: true }),
    // 导航
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    redirectTo: vi.fn(),
    reLaunch: vi.fn(),
    switchTab: vi.fn(),
    getCurrentPages: vi.fn().mockReturnValue([{ route: 'pages/record-edit/index' }]),
    // 媒体
    chooseMedia: vi.fn().mockResolvedValue({
      tempFiles: [{ tempFilePath: '/tmp/test.jpg', size: 1024 }]
    }),
    chooseImage: vi.fn().mockResolvedValue({
      tempFilePaths: ['/tmp/test.jpg']
    }),
    uploadFile: vi.fn().mockImplementation((_opts: any) => {
      return Promise.resolve({
        statusCode: 200,
        data: JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            url: '/uploads/test-' + Date.now() + '.jpg',
            filename: 'test.jpg',
            size: 1024,
            mimeType: 'image/jpeg'
          }
        })
      })
    }),
    previewImage: vi.fn(),
    // 网络
    request: vi.fn(),
    // Canvas / 系统
    createSelectorQuery: vi.fn().mockReturnValue({
      select: () => ({
        fields: () => ({
          exec: (cb: any) => cb([{ node: null, width: 300, height: 200 }])
        })
      }),
      selectViewport: () => ({
        fields: () => ({
          exec: (cb: any) => cb([{ width: 375, height: 667 }])
        })
      }),
      exec: (cb: any) => cb([])
    }),
    getSystemInfoSync: vi.fn().mockReturnValue({
      windowWidth: 375,
      windowHeight: 667,
      pixelRatio: 2,
      platform: 'devtools'
    }),
    canvasToTempFilePath: vi.fn().mockResolvedValue({
      tempFilePath: '/tmp/canvas-output.jpg'
    }),
    // 生命周期 hooks（在 jsdom 下直接 no-op）
    useDidShow: vi.fn(),
    useDidHide: vi.fn(),
    usePullDownRefresh: vi.fn(),
    useReachBottom: vi.fn(),
    useLaunch: vi.fn(),
    useReady: vi.fn(),
    // 订阅消息
    requestSubscribeMessage: vi.fn().mockResolvedValue({}),
    stopPullDownRefresh: vi.fn(),
    // 路由
    useRouter: vi.fn().mockReturnValue({
      params: {},
      onReady: vi.fn(),
      onShow: vi.fn(),
      onHide: vi.fn(),
      onUnload: vi.fn()
    }),
    // 暴露 storage 供测试断言
    __storage: storage
  }
  // request 默认实现：返回 200 + 空 data（测试用 vi.mocked 可覆盖）
  Taro.request = vi.fn().mockResolvedValue({
    statusCode: 200,
    data: { code: 0, message: 'ok', data: {} }
  })
  return {
    default: Taro,
    ...Taro
  }
})

// 清理 storage helper（每个测试前重置）
beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k]
})
