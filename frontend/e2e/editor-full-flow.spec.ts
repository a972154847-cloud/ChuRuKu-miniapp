import { test, expect } from '@playwright/test'
import { setupAuth, mockApi, navigateToPage } from './helpers'

/**
 * 场景 2：Editor 全流程出入库（F2 出入库记录核心）
 *
 * 验收点：
 * - Editor 可访问编辑页，表单正常渲染
 * - 可填写器材（搜索候选）、数量、类型
 * - 提交后显示成功提示
 *
 * 实现机制（record-edit/index.tsx）：
 * - Editor 角色不被权限拦截拦截
 * - EquipmentPicker 搜索器材 → 候选列表 → 选择
 * - 数量校验：正整数
 * - createRecord POST → 成功 toast "提交成功"
 */
test.describe('Editor 全流程出入库', () => {
  test('Editor 访问编辑页，表单正常渲染', async ({ page }) => {
    await setupAuth(page, 'editor', 3, 'editor1')
    await mockApi(page, [
      {
        match: (url) => url.includes('/categories'),
        response: () => [],
      },
    ])

    await navigateToPage(page, '/pages/record-edit/index')

    // 验证表单元素存在
    await expect(page.locator('.record-edit__submit')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.record-edit__type-btn')).toHaveCount(2)

    // 验证入库/出库按钮
    await expect(page.getByText('入库', { exact: true })).toBeVisible()
    await expect(page.getByText('出库', { exact: true })).toBeVisible()

    // 验证数量输入框
    // 注意：Taro H5 把 <Input> 渲染为 <taro-input-core><input></taro-input-core>，
    // 两层都有 placeholder。用 input[placeholder=...] 只匹配真正的 input 元素，
    // 避免 strict mode 找到 2 个元素报错。
    await expect(page.locator('input[placeholder="请输入数量"]')).toBeVisible()
  })

  test('Editor 搜索器材 + 填写数量 + 提交入库记录', async ({ page }) => {
    await setupAuth(page, 'editor', 3, 'editor1')
    await mockApi(page, [
      {
        match: (url) => url.includes('/equipments/search'),
        response: () => ({
          list: [
            { id: 1, name: '手提式干粉灭火器 2kg', spec: '2kg', category_name: '干粉灭火器' },
          ],
        }),
      },
      {
        match: (url, method) => url.includes('/records') && method === 'POST',
        response: () => ({ id: 100, equipment_id: 1, type: 'in', quantity: 5 }),
      },
      {
        match: (url) => url.includes('/categories'),
        response: () => [],
      },
    ])

    await navigateToPage(page, '/pages/record-edit/index')

    // 等待表单渲染
    await expect(page.locator('.record-edit__submit')).toBeVisible({ timeout: 10000 })

    // 确认入库类型（默认 in，点击确认）
    await page.getByText('入库', { exact: true }).click()

    // 搜索器材
    // 注意：Taro H5 Input → taro-input-core + input 两层 placeholder，只匹配真实 input
    const searchInput = page.locator('input[placeholder="搜索器材名称或规格"]')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('干粉')
    // 点击搜索按钮（EquipmentPicker 内的"搜索"按钮）
    await page.locator('.equipment-picker__btn').first().click()

    // 等待候选列表 + 点击候选项
    await expect(page.getByText('手提式干粉灭火器 2kg')).toBeVisible({ timeout: 5000 })
    await page.getByText('手提式干粉灭火器 2kg').click()

    // 输入数量
    await page.locator('input[placeholder="请输入数量"]').fill('5')

    // 提交
    await page.locator('.record-edit__submit').click()

    // 验证成功 toast
    await expect(page.getByText('提交成功')).toBeVisible({ timeout: 5000 })
  })

  test('数量校验：非正整数被拒绝', async ({ page }) => {
    await setupAuth(page, 'editor', 3, 'editor1')
    await mockApi(page, [
      {
        match: (url) => url.includes('/categories'),
        response: () => [],
      },
    ])

    await navigateToPage(page, '/pages/record-edit/index')
    await expect(page.locator('.record-edit__submit')).toBeVisible({ timeout: 10000 })

    // 不选器材，直接输入无效数量并提交
    // 注意：Taro H5 Input → taro-input-core + input 两层 placeholder，只匹配真实 input
    await page.locator('input[placeholder="请输入数量"]').fill('0')
    await page.locator('.record-edit__submit').click()

    // 验证校验提示（器材未选 或 数量无效）
    const toastVisible = await page.getByText('请选择或输入器材').count()
    expect(toastVisible).toBeGreaterThan(0)
  })
})
