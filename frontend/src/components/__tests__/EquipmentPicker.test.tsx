import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EquipmentPicker, {
  type EquipmentPickerRef
} from '../EquipmentPicker'
import * as equipmentsService from '@/services/equipments'

/**
 * EquipmentPicker 组件测试
 * - 渲染搜索输入框
 * - 输入关键字触发搜索，候选列表显示
 * - 搜索无结果降级为手动输入
 * - 搜索失败降级为手动输入
 * - 点击候选项触发 onChange（name_source='search'）
 * - 手动输入触发 onChange（name_source='manual'）
 */
describe('EquipmentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染搜索输入框和搜索按钮', () => {
    render(
      <EquipmentPicker
        onChange={vi.fn()}
        placeholder='搜索器材名称或规格'
      />
    )
    expect(screen.getByPlaceholderText('搜索器材名称或规格')).toBeInTheDocument()
    expect(screen.getByText('搜索')).toBeInTheDocument()
    expect(screen.getByText('手动输入')).toBeInTheDocument()
  })

  it('输入关键字点击搜索 → 调用 searchEquipments → 显示候选列表', async () => {
    const mockList = [
      { id: 1, name: '手提式干粉灭火器 2kg', spec: '2kg', category_name: '干粉灭火器' },
      { id: 2, name: '手提式干粉灭火器 4kg', spec: '4kg', category_name: '干粉灭火器' }
    ]
    const spy = vi
      .spyOn(equipmentsService, 'searchEquipments')
      .mockResolvedValue({ list: mockList, total: mockList.length })

    const handleChange = vi.fn()
    render(<EquipmentPicker onChange={handleChange} />)

    const input = screen.getByPlaceholderText('搜索器材名称或规格')
    fireEvent.input(input, { target: { value: '干粉' } })
    fireEvent.click(screen.getByText('搜索'))

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('干粉')
    })
    await waitFor(() => {
      expect(screen.getByText('手提式干粉灭火器 2kg')).toBeInTheDocument()
      expect(screen.getByText('手提式干粉灭火器 4kg')).toBeInTheDocument()
    })
  })

  it('点击候选项触发 onChange（name_source=search）', async () => {
    const mockList = [
      { id: 10, name: '二氧化碳灭火器', spec: '3kg', category_name: '二氧化碳灭火器' }
    ]
    vi.spyOn(equipmentsService, 'searchEquipments').mockResolvedValue({ list: mockList, total: mockList.length })

    const handleChange = vi.fn()
    render(<EquipmentPicker onChange={handleChange} />)

    const input = screen.getByPlaceholderText('搜索器材名称或规格')
    fireEvent.input(input, { target: { value: '二氧化碳' } })
    fireEvent.click(screen.getByText('搜索'))

    await waitFor(() => {
      // mock 数据 name 与 category_name 相同，item-name 和 item-cat 两个 span 文本重复，
      // 用 selector 限定到 item-name span 精确匹配
      expect(
        screen.getByText('二氧化碳灭火器', { selector: '.equipment-picker__item-name' })
      ).toBeInTheDocument()
    })
    fireEvent.click(
      screen.getByText('二氧化碳灭火器', { selector: '.equipment-picker__item-name' })
    )

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 10,
        name: '二氧化碳灭火器',
        name_source: 'search'
      })
    )
  })

  it('搜索无结果自动降级为手动输入（name_source=manual）', async () => {
    vi.spyOn(equipmentsService, 'searchEquipments').mockResolvedValue({ list: [], total: 0 })

    const handleChange = vi.fn()
    render(<EquipmentPicker onChange={handleChange} />)

    const input = screen.getByPlaceholderText('搜索器材名称或规格')
    fireEvent.input(input, { target: { value: '特殊器材' } })
    fireEvent.click(screen.getByText('搜索'))

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 0,
          name: '特殊器材',
          name_source: 'manual'
        })
      )
    })
    // 搜索无结果降级：组件立即切到手动输入区（list 提示不再展示），
    // 这里验证手动输入框已出现，确认降级成功
    expect(screen.getByPlaceholderText('请输入器材名称（手动）')).toBeInTheDocument()
  })

  it('搜索失败也降级为手动输入', async () => {
    vi.spyOn(equipmentsService, 'searchEquipments').mockRejectedValue(
      new Error('网络错误')
    )

    const handleChange = vi.fn()
    const handleError = vi.fn()
    render(<EquipmentPicker onChange={handleChange} onError={handleError} />)

    const input = screen.getByPlaceholderText('搜索器材名称或规格')
    fireEvent.input(input, { target: { value: '测试' } })
    fireEvent.click(screen.getByText('搜索'))

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 0,
          name: '测试',
          name_source: 'manual'
        })
      )
    })
    expect(handleError).toHaveBeenCalledWith('网络错误')
  })

  it('点击"手动输入"切换到手动模式，输入触发 onChange', () => {
    const handleChange = vi.fn()
    render(<EquipmentPicker onChange={handleChange} />)

    fireEvent.click(screen.getByText('手动输入'))
    // 手动模式应展示"改用搜索"
    expect(screen.getByText('改用搜索')).toBeInTheDocument()

    const manualInput = screen.getByPlaceholderText('请输入器材名称（手动）')
    fireEvent.input(manualInput, { target: { value: '自定义器材' } })

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 0,
        name: '自定义器材',
        name_source: 'manual'
      })
    )
  })

  it('ref.getNameSource() 返回最近一次选择来源', async () => {
    const mockList = [
      { id: 5, name: '水基型灭火器', spec: '6L', category_name: '水基型灭火器' }
    ]
    vi.spyOn(equipmentsService, 'searchEquipments').mockResolvedValue({ list: mockList, total: mockList.length })

    const ref = { current: null as EquipmentPickerRef | null }
    const handleChange = vi.fn()
    render(
      <EquipmentPicker
        ref={ref as any}
        onChange={handleChange}
      />
    )

    // 初始为 search
    expect(ref.current?.getNameSource()).toBe('search')

    // 点击手动输入切换
    fireEvent.click(screen.getByText('手动输入'))
    expect(ref.current?.getNameSource()).toBe('manual')
  })

  it('已选中状态展示器材名 + "更换"按钮', () => {
    // EquipmentPicker 是受控组件：已选中展示依赖外部 value prop。
    // 直接传 value 模拟已选中状态，验证 selected 区渲染（器材名/更换/已匹配标签）
    render(
      <EquipmentPicker
        value={{ id: 7, name: '推车式灭火器', category_name: '推车式灭火器' }}
        onChange={vi.fn()}
      />
    )
    // 已选中展示器材名（selected-name span 唯一）
    expect(
      screen.getByText('推车式灭火器', { selector: '.equipment-picker__selected-name' })
    ).toBeInTheDocument()
    // 更换按钮
    expect(screen.getByText('更换')).toBeInTheDocument()
    // 已匹配标签（id > 0 时显示）
    expect(screen.getByText('已匹配')).toBeInTheDocument()
  })
})
