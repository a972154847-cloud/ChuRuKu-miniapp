import { useState, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { getEquipmentList, getEquipmentInRecords, type EquipmentItem, type EquipmentInRecord } from '@/services/records'

interface UseEquipmentPickerReturn {
  equipmentList: EquipmentItem[]
  showEquipmentPicker: boolean
  showSuggestions: boolean
  showConfirmEquipment: boolean
  equipmentInRecords: EquipmentInRecord[]
  currentStock: number
  filteredList: EquipmentItem[]
  loadEquipmentList: () => Promise<void>
  handleSelectEquipment: (item: EquipmentItem, type: string) => Promise<void>
  handleConfirmEquipment: () => void
  handleCancelEquipment: () => void
  handleEquipmentInput: (value: string, type: string) => void
  setShowEquipmentPicker: (v: boolean) => void
  setCurrentStock: (v: number) => void
}

export function useEquipmentPicker(): UseEquipmentPickerReturn {
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([])
  const [showEquipmentPicker, setShowEquipmentPicker] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showConfirmEquipment, setShowConfirmEquipment] = useState(false)
  const [equipmentInRecords, setEquipmentInRecords] = useState<EquipmentInRecord[]>([])
  const [currentStock, setCurrentStock] = useState(0)
  const [filterKeyword, setFilterKeyword] = useState('')

  const loadEquipmentList = useCallback(async () => {
    try {
      const result = await getEquipmentList()
      setEquipmentList(result.list || [])
    } catch {
      Taro.showToast({ title: '加载器材列表失败', icon: 'none' })
    }
  }, [])

  const handleSelectEquipment = useCallback(async (item: EquipmentItem, type: string) => {
    setCurrentStock(item.stock)
    setShowEquipmentPicker(false)
    setShowSuggestions(false)
    setFilterKeyword(item.name)

    if (type === 'out') {
      try {
        const result = await getEquipmentInRecords(item.name)
        setEquipmentInRecords(result.list || [])
        setShowConfirmEquipment(true)
      } catch {
        Taro.showToast({ title: '加载入库记录失败', icon: 'none' })
      }
    }
  }, [])

  const handleConfirmEquipment = useCallback(() => {
    setShowConfirmEquipment(false)
  }, [])

  const handleCancelEquipment = useCallback(() => {
    setShowConfirmEquipment(false)
    setFilterKeyword('')
    setCurrentStock(0)
  }, [])

  const handleEquipmentInput = useCallback((value: string, type: string) => {
    setFilterKeyword(value)
    if (type === 'out' && value.trim().length >= 1) {
      setShowSuggestions(true)
    } else {
      setShowSuggestions(false)
    }
  }, [])

  const filteredList = equipmentList.filter(item =>
    item.name.toLowerCase().includes(filterKeyword.toLowerCase())
  )

  return {
    equipmentList,
    showEquipmentPicker,
    showSuggestions,
    showConfirmEquipment,
    equipmentInRecords,
    currentStock,
    filteredList,
    loadEquipmentList,
    handleSelectEquipment,
    handleConfirmEquipment,
    handleCancelEquipment,
    handleEquipmentInput,
    setShowEquipmentPicker,
    setCurrentStock,
  }
}
