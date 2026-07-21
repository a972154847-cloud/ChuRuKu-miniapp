import { test, expect } from '@playwright/test'
import { setupAuth, mockApi, navigateToPage } from './helpers'

/**
 * 场景 3：Admin 用户管理（F1 权限管理）
 *
 * 验收点：
 * - Admin 可访问用户管理页，看到用户列表
 * - Admin 可修改其他用户角色
 * - 不能修改自己（显示"本人"）
 *
 * 实现机制（users/index.tsx）：
 * - 非 admin 显示"无权限"
 * - admin 渲染用户列表 + 角色 Picker 筛选 + 关键字搜索
 * - 每用户卡片有"修改角色"按钮（自己显示"本人"）
 * - 修改角色 modal：Picker + 取消/确认
 */
test.describe('Admin 用户管理', () => {
  const mockUsers = [
    { id: 1, name: 'admin1', role: 'admin', created_at: '2026-07-16 10:00:00' },
    { id: 2, name: 'viewer1', role: 'viewer', created_at: '2026-07-16 11:00:00' },
    { id: 3, name: 'editor1', role: 'editor', created_at: '2026-07-16 12:00:00' },
  ]

  test('Admin 访问用户管理页，看到用户列表', async ({ page }) => {
    await setupAuth(page, 'admin', 1, 'admin1')
    await mockApi(page, [
      {
        match: (url, method) => url.includes('/users') && method === 'GET',
        response: () => ({ list: mockUsers, total: mockUsers.length }),
      },
    ])

    await navigateToPage(page, '/pages/users/index')

    // 验证用户列表渲染
    await expect(page.getByText('viewer1')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('editor1')).toBeVisible()
    await expect(page.getByText('admin1')).toBeVisible()

    // 验证角色标签
    // 注意：Taro H5 Picker 下拉也会展示"查看员/录入员/管理员"项，
    // 用 .users-role--* class 精确匹配用户卡片中的角色标签，避开 Picker 同名项
    await expect(page.locator('.users-role--viewer').first()).toBeVisible()
    await expect(page.locator('.users-role--editor').first()).toBeVisible()
    await expect(page.locator('.users-role--admin').first()).toBeVisible()
  })

  test('Admin 自己显示"本人"，不能修改自己角色', async ({ page }) => {
    await setupAuth(page, 'admin', 1, 'admin1')
    await mockApi(page, [
      {
        match: (url, method) => url.includes('/users') && method === 'GET',
        response: () => ({ list: mockUsers, total: mockUsers.length }),
      },
    ])

    await navigateToPage(page, '/pages/users/index')
    await expect(page.getByText('viewer1')).toBeVisible({ timeout: 10000 })

    // admin1（id=1）是自己，应显示"本人"
    await expect(page.getByText('本人')).toBeVisible()
  })

  test('Admin 点击"修改角色"弹出 modal，确认后显示成功', async ({ page }) => {
    await setupAuth(page, 'admin', 1, 'admin1')
    await mockApi(page, [
      {
        match: (url, method) => url.includes('/users') && method === 'GET',
        response: () => ({ list: mockUsers, total: mockUsers.length }),
      },
      {
        match: (url, method) => url.match(/\/users\/\d+\/role/) && method === 'PATCH',
        response: () => ({ id: 2, role: 'editor' }),
      },
    ])

    await navigateToPage(page, '/pages/users/index')
    await expect(page.getByText('viewer1')).toBeVisible({ timeout: 10000 })

    // 点击第一个"修改角色"按钮（viewer1 的，因为 admin1 显示"本人"）
    await page.getByText('修改角色').first().click()

    // 验证 modal 出现（modal 标题"修改角色" + 确认按钮）
    await expect(page.locator('.users-modal')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.users-modal__title')).toBeVisible()

    // 点击确认
    await page.locator('.users-modal__btn--ok').click()

    // 验证成功 toast
    await expect(page.getByText('修改成功')).toBeVisible({ timeout: 5000 })
  })
})
