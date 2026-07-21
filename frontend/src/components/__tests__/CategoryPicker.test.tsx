import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CategoryPicker, {
  type CategoryPickerValue
} from '../CategoryPicker'
import * as categoriesService from '@/services/categories'

/**
 * CategoryPicker 组件测试
 * - 渲染级联选择器
 * - 加载分类树（listCategoriesTree）
 * - autoSuggestFromDescription 变化时调 autoSuggestCategories
 * - 自动建议命中显示"建议分类" + 置信度 + 采纳/手动选择
 * - 降级（fallback='manual'）显示"自动分类不可用，请手动选择"
 * - 采纳建议触发 onChange
 * - 搜索模式：输入关键字过滤分类
 */
const MOCK_TREE: categoriesService.CategoryTreeNode[] = [
  {
    id: 1,
    parent_id: null,
    code: 'EXTINGUISHER',
    name: '灭火器',
    level: 1,
    children: [
      { id: 11, parent_id: 1, code: 'PORTABLE_POWDER', name: '手提式干粉灭火器', level: 2 },
      { id: 12, parent_id: 1, code: 'PORTABLE_CO2', name: '手提式二氧化碳灭火器', level: 2 }
    ]
  },
  {
    id: 2,
    parent_id: null,
    code: 'FIRE_EQUIPMENT',
    name: '消防装备',
    level: 1,
    children: [
      { id: 21, parent_id: 2, code: 'HOSE', name: '消防水带', level: 2 }
    ]
  }
]

describe('CategoryPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(categoriesService, 'listCategoriesTree').mockResolvedValue(MOCK_TREE)
  })

  it('渲染级联选择器并加载分类树', async () => {
    render(<CategoryPicker onChange={vi.fn()} />)
    expect(categoriesService.listCategoriesTree).toHaveBeenCalled()
    // 加载完成后应显示 placeholder
    await waitFor(() => {
      expect(screen.getByText('请选择器材分类')).toBeInTheDocument()
    })
  })

  it('autoSuggestFromDescription 变化时调用 autoSuggestCategories', async () => {
    const suggestSpy = vi
      .spyOn(categoriesService, 'autoSuggestCategories')
      .mockResolvedValue({
        suggestions: [
          {
            category_id: 11,
            category_name: '手提式干粉灭火器',
            category_code: 'PORTABLE_POWDER',
            confidence: 0.85,
            reason: '描述含"干粉"关键词'
          }
        ]
      })

    const { rerender } = render(
      <CategoryPicker
        onChange={vi.fn()}
        autoSuggestFromDescription=''
        equipmentName=''
      />
    )

    // 变化描述触发自动建议
    rerender(
      <CategoryPicker
        onChange={vi.fn()}
        autoSuggestFromDescription='手提式干粉灭火器 ABC 磷酸铵盐'
        equipmentName='干粉灭火器'
      />
    )

    await waitFor(() => {
      expect(suggestSpy).toHaveBeenCalledWith(
        '手提式干粉灭火器 ABC 磷酸铵盐',
        '干粉灭火器'
      )
    })
  })

  it('自动建议命中显示分类名 + 置信度 + 采纳/手动选择按钮', async () => {
    vi.spyOn(categoriesService, 'autoSuggestCategories').mockResolvedValue({
      suggestions: [
        {
          category_id: 11,
          category_name: '手提式干粉灭火器',
          category_code: 'PORTABLE_POWDER',
          confidence: 0.85,
          reason: '描述含"干粉"关键词'
        }
      ]
    })

    render(
      <CategoryPicker
        onChange={vi.fn()}
        autoSuggestFromDescription='干粉灭火器'
        equipmentName='干粉'
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/建议分类/)).toBeInTheDocument()
    })
    expect(screen.getByText(/85%/)).toBeInTheDocument()
    expect(screen.getByText('采纳')).toBeInTheDocument()
    expect(screen.getByText('手动选择')).toBeInTheDocument()
  })

  it('点击"采纳"触发 onChange（带建议分类）', async () => {
    vi.spyOn(categoriesService, 'autoSuggestCategories').mockResolvedValue({
      suggestions: [
        {
          category_id: 11,
          category_name: '手提式干粉灭火器',
          category_code: 'PORTABLE_POWDER',
          confidence: 0.85,
          reason: '命中"干粉"'
        }
      ]
    })

    const handleChange = vi.fn()
    render(
      <CategoryPicker
        onChange={handleChange}
        autoSuggestFromDescription='干粉'
        equipmentName='干粉'
      />
    )

    await waitFor(() => {
      expect(screen.getByText('采纳')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('采纳'))

    expect(handleChange).toHaveBeenCalledWith({
      categoryId: 11,
      categoryName: '手提式干粉灭火器'
    })
  })

  it('降级（fallback=manual）显示"自动分类不可用，请手动选择"', async () => {
    vi.spyOn(categoriesService, 'autoSuggestCategories').mockResolvedValue({
      suggestions: [],
      fallback: 'manual'
    })

    render(
      <CategoryPicker
        onChange={vi.fn()}
        autoSuggestFromDescription='未知器材描述'
        equipmentName=''
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/自动分类不可用/)).toBeInTheDocument()
    })
    expect(screen.getByText('手动选择')).toBeInTheDocument()
  })

  it('点击"搜索分类"进入搜索模式，输入关键字过滤', async () => {
    render(<CategoryPicker onChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('请选择器材分类')).toBeInTheDocument()
    })

    // 点击"搜索分类"链接
    fireEvent.click(screen.getByText('搜索分类'))

    // 应显示搜索输入框
    const searchInput = screen.getByPlaceholderText('输入分类名称或 code 搜索')
    expect(searchInput).toBeInTheDocument()

    // 输入关键字过滤
    fireEvent.input(searchInput, { target: { value: '干粉' } })
    // 过滤后应显示"手提式干粉灭火器"
    expect(screen.getByText('手提式干粉灭火器')).toBeInTheDocument()
    // 不应显示"消防水带"
    expect(screen.queryByText('消防水带')).not.toBeInTheDocument()
  })

  it('搜索模式下点击分类项触发 onChange', async () => {
    const handleChange = vi.fn()
    render(<CategoryPicker onChange={handleChange} />)

    await waitFor(() => {
      expect(screen.getByText('搜索分类')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('搜索分类'))
    const searchInput = screen.getByPlaceholderText('输入分类名称或 code 搜索')
    fireEvent.input(searchInput, { target: { value: '水带' } })

    // 点击过滤后的"消防水带"
    fireEvent.click(screen.getByText('消防水带'))
    expect(handleChange).toHaveBeenCalledWith({
      categoryId: 21,
      categoryName: '消防水带'
    })
  })

  it('外部传入 value 时展示已选中分类名', async () => {
    const value: CategoryPickerValue = {
      categoryId: 11,
      categoryName: '手提式干粉灭火器'
    }
    render(<CategoryPicker value={value} onChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('手提式干粉灭火器')).toBeInTheDocument()
    })
    expect(screen.getByText('更换')).toBeInTheDocument()
  })
})
