import { Page } from '@playwright/test'

/**
 * E2E 测试共享 helper
 *
 * 关键设计：
 * 1. Taro 4.2 H5 用 hash 路由（/#/pages/xxx/index）
 * 2. 前端代码用 process.env，H5 端需注入 process polyfill
 * 3. page.addInitScript 只支持一个 arg 参数，用对象包装
 * 4. Taro H5 端 setStorageSync 直接用 localStorage，key 不加前缀
 */

export type Role = 'admin' | 'editor' | 'viewer'

interface AuthData {
  role: Role
  userId: number
  userName: string
}

/**
 * 注入 process polyfill + 设置登录态（localStorage）
 */
export async function setupAuth(page: Page, role: Role, userId = 1, userName = 'testuser') {
  const authData: AuthData = { role, userId, userName }
  await page.addInitScript((data) => {
    if (typeof (window as any).process === 'undefined') {
      ;(window as any).process = { env: {} }
    }
    localStorage.setItem('token', `fake-${data.role}-token`)
    localStorage.setItem('user', JSON.stringify({
      id: data.userId,
      name: data.userName,
      role: data.role
    }))
  }, authData)
}

/**
 * mock 后端 API（通用兜底 + 可选特定端点覆盖）
 */
export async function mockApi(
  page: Page,
  handlers: Array<{ match: (url: string, method: string) => boolean; response: () => any }> = []
) {
  await page.route('http://localhost:3000/api/**', (route) => {
    const url = route.request().url()
    const method = route.request().method()
    for (const h of handlers) {
      if (h.match(url, method)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, message: 'ok', data: h.response() }),
        })
      }
    }
    // 默认兜底
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: {} }),
    })
  })
}

/**
 * 导航到目标页。
 *
 * 策略：直接用 page.goto 访问目标页的 hash 路由 URL。
 *
 * 工作原理：
 * 1. setupAuth() 通过 page.addInitScript 在页面加载前设置 localStorage
 *    （token + user），addInitScript 在每次页面导航/刷新前都会执行
 * 2. frontend/src/store/user.ts 在模块加载时立即调用 loadFromStorage()，
 *    store 创建即从 localStorage 读取 token，使初始 state 已含登录态
 * 3. 因此子组件 mount 时 useUserStore 读取的就是有效 token，
 *    record-edit 的权限拦截 useEffect 不会触发 reLaunch 到 login
 *
 * 修复背景：原方案用"先访问 dashboard 等 useEffect + 改 hash"是因为
 * store 模块加载时不自动恢复登录态。store 修复后此变通不再需要。
 *
 * 参考：frontend/src/store/user.ts 末尾的模块级 loadFromStorage 调用
 */
export async function navigateToPage(page: Page, path: string) {
  await page.goto('/#' + path)
  // 等待 Taro 路由响应 + 目标页面渲染（首次加载较慢，dev server 编译需时间）
  await page.waitForTimeout(1500)
}
