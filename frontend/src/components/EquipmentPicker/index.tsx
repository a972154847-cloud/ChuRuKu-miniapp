import { useState, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { searchEquipments, type EquipmentWithCategory } from '@/services/equipments'
import './index.scss'

export interface EquipmentPickerValue {
  id: number
  name: string
  category_name?: string | null
}

export interface EquipmentPickerChange {
  id: number
  name: string
  category_name?: string | null
  name_source: 'search' | 'manual'
}

export interface EquipmentPickerProps {
  value?: EquipmentPickerValue
  onChange: (val: EquipmentPickerChange) => void
  onError?: (msg: string) => void
  placeholder?: string
}

export interface EquipmentPickerRef {
  getNameSource: () => 'search' | 'manual'
}

type NameSource = 'search' | 'manual'

/**
 * 器材选择器
 * - 输入关键字搜索后端，候选列表点击选中（name_source='search'）
 * - 搜索无结果或失败时切到手动输入（name_source='manual'，id=0）
 * - 通过 ref.getNameSource() 读取最近一次的选择来源
 */
function EquipmentPicker(
  { value, onChange, onError, placeholder = '搜索器材名称或规格' }: EquipmentPickerProps,
  ref: React.Ref<EquipmentPickerRef>
) {
  const [keyword, setKeyword] = useState('')
  const [list, setList] = useState<EquipmentWithCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [showList, setShowList] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manualName, setManualName] = useState('')
  // 用 ref 保存 nameSource，供父组件命令式读取
  const nameSourceRef = useRef<NameSource>('search')
  // 受控 value 同步：外部传入 value 时更新 nameSource（编辑场景）
  const lastValueIdRef = useRef<number | undefined>(value?.id)

  useImperativeHandle(
    ref,
    () => ({
      getNameSource: () => nameSourceRef.current
    }),
    []
  )

  // 受控同步：当外部 value.id 变化时，推断 nameSource
  // value.id > 0 → search；value.id === 0 且有 name → manual
  if (value && value.id !== lastValueIdRef.current) {
    lastValueIdRef.current = value.id
    nameSourceRef.current = value.id > 0 ? 'search' : 'manual'
  }

  const doSearch = useCallback(async () => {
    const kw = keyword.trim()
    if (!kw) {
      Taro.showToast({ title: '请输入关键字', icon: 'none' })
      return
    }
    setLoading(true)
    setShowList(true)
    try {
      const res = await searchEquipments(kw)
      setList(res.list || [])
      if (!res.list || res.list.length === 0) {
        // 无结果自动切手动模式
        setManualMode(true)
        setManualName(keyword)
        nameSourceRef.current = 'manual'
        onChange({ id: 0, name: keyword, name_source: 'manual' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '搜索失败'
      onError?.(msg)
      // 失败也切手动模式，保证流程不卡
      setManualMode(true)
      setManualName(keyword)
      nameSourceRef.current = 'manual'
      onChange({ id: 0, name: keyword, name_source: 'manual' })
    } finally {
      setLoading(false)
    }
  }, [keyword, onChange, onError])

  const handlePick = (item: EquipmentWithCategory) => {
    nameSourceRef.current = 'search'
    onChange({
      id: item.id,
      name: item.name,
      category_name: item.category_name || null,
      name_source: 'search'
    })
    setKeyword(item.name)
    setShowList(false)
    setManualMode(false)
  }

  const handleManualInput = (e: any) => {
    const v = e.detail.value || ''
    setManualName(v)
    nameSourceRef.current = 'manual'
    onChange({ id: 0, name: v, name_source: 'manual' })
  }

  const switchToSearch = () => {
    setManualMode(false)
    setManualName('')
    setShowList(false)
  }

  const switchToManual = () => {
    setManualMode(true)
    setShowList(false)
    // 用户主动切到手动模式：立即标记 nameSource='manual'，
    // 即使 keyword 为空也标记（避免父组件读到默认 'search' 误判）
    nameSourceRef.current = 'manual'
    if (keyword) {
      setManualName(keyword)
      onChange({ id: 0, name: keyword, name_source: 'manual' })
    }
  }

  // 已选中状态展示
  const selectedName = value?.name

  return (
    <View className='equipment-picker'>
      {/* 已选中展示 */}
      {selectedName && !showList && !manualMode && (
        <View className='equipment-picker__selected'>
          <View className='equipment-picker__selected-info'>
            <Text className='equipment-picker__selected-name'>{selectedName}</Text>
            {value?.category_name && (
              <Text className='equipment-picker__selected-cat'>
                {value.category_name}
              </Text>
            )}
            {value?.id === 0 && (
              <Text className='equipment-picker__tag equipment-picker__tag--manual'>
                手动
              </Text>
            )}
            {value?.id && value.id > 0 && (
              <Text className='equipment-picker__tag equipment-picker__tag--search'>
                已匹配
              </Text>
            )}
          </View>
          <Text className='equipment-picker__reset' onClick={switchToSearch}>
            更换
          </Text>
        </View>
      )}

      {/* 搜索输入区 */}
      {!selectedName && !manualMode && (
        <View className='equipment-picker__search'>
          <Input
            className='equipment-picker__input'
            value={keyword}
            placeholder={placeholder}
            onInput={(e) => setKeyword(e.detail.value)}
            onConfirm={doSearch}
            confirmType='search'
          />
          <Button
            className='equipment-picker__btn'
            loading={loading}
            onClick={doSearch}
            size='mini'
          >
            搜索
          </Button>
          <Text className='equipment-picker__manual-link' onClick={switchToManual}>
            手动输入
          </Text>
        </View>
      )}

      {/* 候选列表 */}
      {showList && !manualMode && list.length > 0 && (
        <View className='equipment-picker__list'>
          {list.map((item) => (
            <View
              key={item.id}
              className='equipment-picker__item'
              onClick={() => handlePick(item)}
            >
              <View className='equipment-picker__item-main'>
                <Text className='equipment-picker__item-name'>{item.name}</Text>
                {item.spec && (
                  <Text className='equipment-picker__item-spec'>规格：{item.spec}</Text>
                )}
              </View>
              {item.category_name && (
                <Text className='equipment-picker__item-cat'>{item.category_name}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* 搜索无结果提示 */}
      {showList && !manualMode && list.length === 0 && !loading && (
        <View className='equipment-picker__empty'>
          <Text className='equipment-picker__empty-text'>未找到匹配器材，已切换到手动输入</Text>
        </View>
      )}

      {/* 手动输入区 */}
      {manualMode && (
        <View className='equipment-picker__manual'>
          <Input
            className='equipment-picker__input'
            value={manualName}
            placeholder='请输入器材名称（手动）'
            onInput={handleManualInput}
          />
          <Text className='equipment-picker__reset' onClick={switchToSearch}>
            改用搜索
          </Text>
          <Text className='equipment-picker__manual-hint'>
            手动输入的器材不会关联到器材库，提交时 name_source='manual'
          </Text>
        </View>
      )}
    </View>
  )
}

export default forwardRef(EquipmentPicker)
