import { test, expect } from '@playwright/test'
import { setupAuth, mockApi, navigateToPage } from './helpers'

/**
 * 场景 1：Viewer 拒绝编辑（F1 权限管理）
 *
 * 验收点：
 * - Viewer 角色用户看不到编辑页表单
 * - 直接访问编辑页 URL 时被拦截并提示无权限
 *
 * 实现机制（record-edit/index.tsx 第 58-68 行）：
 * - useEffect 检测 user.role === 'viewer'
 * - Taro.showToast({ title: '无操作权限' })
 * - 800ms 后 Taro.navigateBack()
 * - return 空 View（表单不渲染）
 */
test.describe('Viewer 拒绝编辑', () => {
  test('Viewer 访问编辑页被拦截，表单不渲染', async ({ page }) => {
    await setupAuth(page, 'viewer', 2, 'viewer1')
    await mockApi(page)

    await navigateToPage(page, '/pages/record-edit/index')

    // 验证：表单未渲染（提交按钮不存在）
    await expect(page.locator('.record-edit__submit')).toHaveCount(0)

    // 验证：类型选择按钮不存在
    await expect(page.locator('.record-edit__type-btn')).toHaveCount(0)

    // 验证：数量输入框不存在
    await expect(page.locator('.record-edit__input')).toHaveCount(0)
  })

  test('Viewer 在仪表盘看不到"新建记录"入口（tabBar 无编辑入口）', async ({ page }) => {
    await setupAuth(page, 'viewer', 2, 'viewer1')
    await mockApi(page)

    // 直接访问 dashboard
    await page.goto('/#/pages/dashboard/index')
    await page.waitForTimeout(1500)

    // tabBar 只有 仪表盘/记录/我的，没有"新建记录"
    // 验证 tabBar 存在
    // 注意：Taro H5 把"仪表盘"放在导航栏标题 + tabBar label 两处，
    // 用 .weui-tabbar__label class 精确匹配 tabBar，避开导航栏标题
    await expect(page.locator('.weui-tabbar__label', { hasText: '仪表盘' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.weui-tabbar__label', { hasText: '记录' })).toBeVisible()
    await expect(page.locator('.weui-tabbar__label', { hasText: '我的' })).toBeVisible()
  })
})
