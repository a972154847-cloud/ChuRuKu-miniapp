import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Vitest 配置（前端组件测试）
 * - environment: jsdom（在浏览器-like 环境运行 React 组件）
 * - alias: @ -> src（对齐 tsconfig.paths）
 * - setupFiles: 全局 mock Taro API + jest-dom matchers
 *
 * 注意：Taro 组件通过 setup.ts 的 vi.mock 映射到原生 DOM 元素，
 * 因此测试中渲染的是 div/span/input 等真实 DOM 节点。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    css: false
  }
})
