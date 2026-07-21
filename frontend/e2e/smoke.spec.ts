import { test, expect } from '@playwright/test'

/**
 * 冒烟测试：验证 Taro H5 dev server 可启动且登录页可访问
 * 关键发现：
 * - Taro 4.2 H5 用 hash 路由（/#/pages/xxx/index）
 * - 前端代码用 process.env，H5 端需注入 process polyfill
 */
test.describe('冒烟测试 - dev server 可访问性', () => {
  test('登录页可加载且标题可见', async ({ page }) => {
    // 注入 process polyfill（前端 request.ts 用 process.env，H5 端无 process 对象）
    await page.addInitScript(() => {
      if (typeof (window as any).process === 'undefined') {
        ;(window as any).process = { env: {} }
      }
    })

    // mock 后端 API，避免未 mock 的请求导致页面报错
    await page.route('http://localhost:3000/api/**', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: {} }),
      })
    })

    // Taro 4.2 H5 用 hash 路由
    await page.goto('/#/pages/login/index')

    // 等待登录页标题出现
    await expect(page.getByText('器材装备管理')).toBeVisible({ timeout: 30_000 })
  })
})
