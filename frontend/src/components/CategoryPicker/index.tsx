import { useEffect, useState, useMemo, useCallback } from 'react'
import { View, Text, Input, Picker } from '@tarojs/components'
import {
  listCategoriesTree,
  autoSuggestCategories,
  type CategoryTreeNode,
  type Category,
  type AutoSuggestResult
} from '@/services/categories'
import './index.scss'

export interface CategoryPickerValue {
  categoryId: number
  categoryName: string
}

export interface CategoryPickerProps {
  value?: CategoryPickerValue
  onChange: (val: CategoryPickerValue) => void
  /** 自动分类来源描述（变化时触发自动建议） */
  autoSuggestFromDescription?: string
  /** 可选：器材名（拼接到自动分类文本） */
  equipmentName?: string
  placeholder?: string
}

/**
 * 分类选择器
 * - 两级级联 Picker（一级 5 大类，二级对应子类）
 * - 搜索框过滤分类名称，点击选中
 * - 当 autoSuggestFromDescription 变化时调后端自动分类 API
 *   - 命中显示"建议分类：xxx（置信度 85%）[采纳][手动选择]"
 *   - 无命中或降级时显示提示并强制手动选择
 */
function CategoryPicker({
  value,
  onChange,
  autoSuggestFromDescription,
  equipmentName,
  placeholder = '请选择器材分类'
}: CategoryPickerProps) {
  const [tree, setTree] = useState<CategoryTreeNode[]>([])
  const [flatList, setFlatList] = useState<Category[]>([])
  const [suggest, setSuggest] = useState<AutoSuggestResult | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestDismissed, setSuggestDismissed] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  // 加载分类树
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const t = await listCategoriesTree()
        if (!mounted) return
        setTree(t || [])
        const flat: Category[] = []
        for (const r of t || []) {
          flat.push(r)
          if (r.children) {
            for (const c of r.children) flat.push(c)
          }
        }
        setFlatList(flat)
      } catch {
        // 错误已由 request.ts toast
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // 自动分类：autoSuggestFromDescription 变化时触发
  useEffect(() => {
    const desc = (autoSuggestFromDescription || '').trim()
    if (!desc) {
      setSuggest(null)
      setSuggestDismissed(false)
      return
    }
    let mounted = true
    setSuggestLoading(true)
    setSuggestDismissed(false)
    ;(async () => {
      try {
        const res = await autoSuggestCategories(desc, equipmentName)
        if (!mounted) return
        setSuggest(res)
      } catch {
        if (!mounted) return
        setSuggest(null)
      } finally {
        if (mounted) setSuggestLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [autoSuggestFromDescription, equipmentName])

  // 构造 Picker multiSelector 数据
  const { rootRange, childRangeByRoot, multiValue } = useMemo(() => {
    const roots: CategoryTreeNode[] = tree
    const rootRange: string[] = roots.map((r) => r.name)
    const childRangeByRoot: string[][] = roots.map((r) =>
      (r.children || []).map((c) => c.name)
    )

    // 反查 value 对应的索引
    let rootIdx = 0
    let childIdx = 0
    if (value?.categoryId && roots.length > 0) {
      for (let i = 0; i < roots.length; i++) {
        if (roots[i].id === value.categoryId) {
          rootIdx = i
          childIdx = 0
          break
        }
        const children = roots[i].children || []
        for (let j = 0; j < children.length; j++) {
          if (children[j].id === value.categoryId) {
            rootIdx = i
            childIdx = j
            break
          }
        }
      }
    }
    return {
      rootRange,
      childRangeByRoot,
      multiValue: [rootIdx, childIdx] as [number, number]
    }
  }, [tree, value])

  // Picker 当前一级对应的二级标签
  const currentChildRange = childRangeByRoot[multiValue[0]] || []

  const handlePickerChange = useCallback(
    (e: { detail: { value: number[] } }) => {
      const [rootIdx, childIdx] = e.detail.value
      const root = tree[rootIdx]
      if (!root) return
      const children = root.children || []
      const child = children[childIdx]
      // 优先选子类，无子类时选一级
      const picked = child || root
      onChange({ categoryId: picked.id, categoryName: picked.name })
    },
    [tree, onChange]
  )

  // Picker 列变化时更新二级范围（multiSelector 自动处理，这里仅用于显示）
  const handleColumnChange = (e: { detail: { column: number; value: number } }) => {
    // Taro Picker multiSelector 自身维护内部状态，这里不需要额外处理
    void e
  }

  const acceptSuggestion = () => {
    if (suggest && suggest.suggestions.length > 0) {
      const top = suggest.suggestions[0]
      onChange({
        categoryId: top.category_id,
        categoryName: top.category_name
      })
      setSuggestDismissed(true)
    }
  }

  const dismissSuggestion = () => {
    setSuggestDismissed(true)
    setShowSearch(true)
  }

  // 搜索过滤
  const filteredList = useMemo(() => {
    const kw = searchKeyword.trim()
    if (!kw) return flatList
    return flatList.filter(
      (c) => c.name.includes(kw) || c.code.toLowerCase().includes(kw.toLowerCase())
    )
  }, [flatList, searchKeyword])

  const handleSearchPick = (c: Category) => {
    onChange({ categoryId: c.id, categoryName: c.name })
    setShowSearch(false)
    setSearchKeyword('')
  }

  const switchToSearch = () => {
    setShowSearch(true)
  }

  const switchToPicker = () => {
    setShowSearch(false)
  }

  const selectedName = value?.categoryName

  // 自动建议展示：加载中 / 命中 / 降级
  const showSuggestBar =
    !suggestDismissed &&
    (suggestLoading || suggest !== null) &&
    !!autoSuggestFromDescription

  const topSuggestion = suggest?.suggestions?.[0]
  const isFallback = suggest?.fallback === 'manual'

  return (
    <View className='category-picker'>
      {/* 自动分类建议条 */}
      {showSuggestBar && (
        <View className='category-picker__suggest'>
          {suggestLoading && (
            <Text className='category-picker__suggest-text'>
              正在自动识别分类...
            </Text>
          )}
          {!suggestLoading && isFallback && (
            <View className='category-picker__suggest-fallback'>
              <Text className='category-picker__suggest-text'>
                自动分类不可用，请手动选择
              </Text>
              <Text
                className='category-picker__suggest-action'
                onClick={dismissSuggestion}
              >
                手动选择
              </Text>
            </View>
          )}
          {!suggestLoading && topSuggestion && !isFallback && (
            <View className='category-picker__suggest-hit'>
              <View className='category-picker__suggest-info'>
                <Text className='category-picker__suggest-name'>
                  建议分类：{topSuggestion.category_name}
                </Text>
                <Text className='category-picker__suggest-confidence'>
                  （置信度 {Math.round(topSuggestion.confidence * 100)}%）
                </Text>
                <Text className='category-picker__suggest-reason'>
                  {topSuggestion.reason}
                </Text>
              </View>
              <View className='category-picker__suggest-actions'>
                <Text
                  className='category-picker__suggest-btn category-picker__suggest-btn--accept'
                  onClick={acceptSuggestion}
                >
                  采纳
                </Text>
                <Text
                  className='category-picker__suggest-btn'
                  onClick={dismissSuggestion}
                >
                  手动选择
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* 已选中展示 */}
      {selectedName && !showSearch && (
        <View className='category-picker__selected'>
          <View className='category-picker__selected-info'>
            <Text className='category-picker__selected-name'>{selectedName}</Text>
          </View>
          <Text className='category-picker__reset' onClick={switchToSearch}>
            更换
          </Text>
        </View>
      )}

      {/* 级联 Picker */}
      {!selectedName && !showSearch && tree.length > 0 && (
        <View className='category-picker__picker-wrap'>
          <Picker
            mode='multiSelector'
            range={[rootRange, currentChildRange]}
            value={multiValue}
            onChange={handlePickerChange}
            onColumnChange={handleColumnChange}
          >
            <View className='category-picker__picker-display'>
              <Text
                className={`category-picker__picker-text ${!selectedName ? 'is-placeholder' : ''}`}
              >
                {selectedName || placeholder}
              </Text>
            </View>
          </Picker>
          <Text className='category-picker__search-link' onClick={switchToSearch}>
            搜索分类
          </Text>
        </View>
      )}

      {/* 搜索模式 */}
      {showSearch && (
        <View className='category-picker__search'>
          <Input
            className='category-picker__input'
            value={searchKeyword}
            placeholder='输入分类名称或 code 搜索'
            onInput={(e) => setSearchKeyword(e.detail?.value ?? '')}
            focus
          />
          <Text className='category-picker__reset' onClick={switchToPicker}>
            改用级联
          </Text>
        </View>
      )}

      {/* 搜索结果列表 */}
      {showSearch && (
        <View className='category-picker__list'>
          {filteredList.length === 0 && (
            <View className='category-picker__empty'>
              <Text className='category-picker__empty-text'>
                未找到匹配分类
              </Text>
            </View>
          )}
          {filteredList.map((c) => (
            <View
              key={c.id}
              className='category-picker__item'
              onClick={() => handleSearchPick(c)}
            >
              <View className='category-picker__item-main'>
                <Text className='category-picker__item-name'>{c.name}</Text>
                <Text className='category-picker__item-code'>{c.code}</Text>
              </View>
              <Text className='category-picker__item-level'>
                {c.level === 1 ? '一级' : '二级'}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

export default CategoryPicker
