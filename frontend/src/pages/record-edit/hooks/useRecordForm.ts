import { useState, useCallback } from 'react'
import Taro from '@tarojs/taro'
import {
  createRecord,
  updateRecord,
  attachPhotos,
  replacePhotos,
  getRecordById,
  type PhotoKind,
  type RecordDetail,
} from '@/services/records'
import { parseRecord } from '@/services/ai-chat'
import type { RecordType } from '@/types'

export interface PhotoItem {
  url: string
  kind: PhotoKind
  annotation_json?: string
  isAnnotated?: boolean
  originalUrl?: string
}

export interface AnnotatorState {
  imageUrl: string
  originalUrl: string
}

interface UseRecordFormReturn {
  type: RecordType
  equipmentName: string
  quantity: string
  photos: PhotoItem[]
  recipient: string
  purpose: string
  expectedReturnAt: string
  remark: string
  submitting: boolean
  annotator: AnnotatorState | null
  editingId: number | null
  currentStock: number
  setType: (t: RecordType) => void
  setEquipmentName: (v: string) => void
  setQuantity: (v: string) => void
  setPhotos: React.Dispatch<React.SetStateAction<PhotoItem[]>>
  setRecipient: (v: string) => void
  setPurpose: (v: string) => void
  setExpectedReturnAt: (v: string) => void
  setRemark: (v: string) => void
  setAnnotator: (v: AnnotatorState | null) => void
  setCurrentStock: (v: number) => void
  loadRecord: (id: number) => Promise<void>
  handleSubmit: (currentStock: number) => Promise<void>
  handleAiFill: () => Promise<void>
}

export function useRecordForm(): UseRecordFormReturn {
  const [type, setType] = useState<RecordType>('in')
  const [equipmentName, setEquipmentName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [recipient, setRecipient] = useState('')
  const [purpose, setPurpose] = useState('')
  const [expectedReturnAt, setExpectedReturnAt] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [annotator, setAnnotator] = useState<AnnotatorState | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [currentStock, setCurrentStock] = useState(0)

  const loadRecord = useCallback(async (id: number) => {
    try {
      const detail: RecordDetail = await getRecordById(id)
      if (detail) {
        setEditingId(id)
        setType(detail.type)
        setEquipmentName(detail.equipment?.name || '')
        setQuantity(String(detail.quantity))
        setRecipient(detail.recipient || '')
        setPurpose(detail.purpose || '')
        setExpectedReturnAt(detail.expected_return_at || '')
        setRemark(detail.remark || '')
        setCurrentStock(detail.current_stock || 0)
        if (detail.photos && detail.photos.length > 0) {
          setPhotos(detail.photos.map(p => ({
            url: p.url,
            kind: p.kind,
            annotation_json: p.annotation_json || undefined,
            isAnnotated: p.kind === 'annotated'
          })))
        }
      }
    } catch {
      Taro.showToast({ title: '加载记录失败', icon: 'none' })
    }
  }, [])

  const handleConfirmStep = async (step: number, stock: number): Promise<boolean> => {
    const qty = parseInt(quantity, 10)
    const confirmMessages = [
      `器材：${equipmentName}\n数量：${qty}${stock > 0 ? `（当前库存：${stock}）` : ''}`,
      `领用人：${recipient || '无'}\n预计归还：${expectedReturnAt || '无'}\n用途：${purpose || '无'}`
    ]

    return new Promise<boolean>((resolve) => {
      Taro.showModal({
        title: `确认出库（${step + 1}/2）`,
        content: confirmMessages[step],
        confirmText: '确认',
        cancelText: '取消',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
  }

  const handleSubmit = useCallback(async (stock: number) => {
    if (submitting) return

    if (!equipmentName.trim()) {
      Taro.showToast({ title: '请输入器材名称', icon: 'none' })
      return
    }
    const qty = parseInt(quantity, 10)
    if (!Number.isFinite(qty) || qty <= 0 || String(qty) !== quantity.trim()) {
      Taro.showToast({ title: '数量必须为正整数', icon: 'none' })
      return
    }
    if (type !== 'in' && type !== 'out') {
      Taro.showToast({ title: '请选择入库或出库', icon: 'none' })
      return
    }

    // 出库库存校验
    if (type === 'out' && stock > 0 && qty > stock) {
      Taro.showToast({ title: `出库数量超过当前库存（${stock}）`, icon: 'none' })
      return
    }

    // 出库确认流程（2 步）
    if (type === 'out') {
      for (let i = 0; i < 2; i++) {
        const confirmed = await handleConfirmStep(i, stock)
        if (!confirmed) return
      }
    }

    setSubmitting(true)
    Taro.showLoading({ title: '提交中...' })
    try {
      let record: RecordDetail
      const payload = {
        equipment_name: equipmentName.trim(),
        quantity: qty,
        recipient: type === 'out' && recipient ? recipient : null,
        purpose: purpose || null,
        expected_return_at: type === 'out' && expectedReturnAt ? expectedReturnAt : null,
        remark: remark || null,
        name_source: 'manual' as const,
      }

      if (editingId) {
        record = await updateRecord(editingId, payload)
      } else {
        record = await createRecord({ ...payload, type })
      }

      // 照片同步
      if (type === 'in') {
        try {
          if (editingId) {
            await replacePhotos(
              record.id,
              photos.map((p) => ({
                url: p.url,
                kind: p.kind,
                annotation_json: p.annotation_json || null
              }))
            )
          } else if (photos.length > 0) {
            await attachPhotos(
              record.id,
              photos.map((p) => ({
                url: p.url,
                kind: p.kind,
                annotation_json: p.annotation_json || null
              }))
            )
          }
        } catch (photoErr) {
          console.warn('[record-edit] photo sync failed', photoErr)
          Taro.hideLoading()
          Taro.showToast({
            title: '记录已保存，但照片同步失败',
            icon: 'none',
            duration: 2000
          })
          setTimeout(() => goBack(), 1200)
          return
        }
      }

      Taro.hideLoading()
      Taro.showToast({ title: editingId ? '修改成功' : '提交成功', icon: 'success' })
      setTimeout(() => goBack(), 800)
    } catch (e) {
      Taro.hideLoading()
      const msg = e instanceof Error ? e.message : '提交失败'
      Taro.showToast({ title: msg, icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }, [submitting, equipmentName, quantity, type, recipient, purpose, expectedReturnAt, remark, editingId, photos])

  const handleAiFill = useCallback(async () => {
    try {
      // editable / content 为微信小程序扩展属性，Taro 类型定义未收录
      const modalRes = await (Taro.showModal as Function)({
        title: 'AI 填表助手',
        editable: true,
        placeholderText: '如：出库2个干粉灭火器给张三',
        confirmText: '解析',
        cancelText: '取消'
      }) as { confirm: boolean; content?: string }
      if (!modalRes.confirm || !modalRes.content || !modalRes.content.trim()) return

      Taro.showLoading({ title: 'AI 解析中...', mask: true })
      const result = await parseRecord(modalRes.content.trim(), type)
      Taro.hideLoading()

      if (!result.fields) {
        Taro.showToast({ title: 'AI 未能解析指令，请换个说法', icon: 'none' })
        return
      }

      const f = result.fields
      const filled: string[] = []
      if (f.type && f.type !== type) {
        setType(f.type)
        filled.push('类型')
      }
      if (f.equipment_name) {
        setEquipmentName(f.equipment_name)
        filled.push('器材名称')
      }
      if (f.quantity) {
        setQuantity(String(f.quantity))
        filled.push('数量')
      }
      if (f.recipient) {
        setRecipient(f.recipient)
        filled.push('领用人')
      }
      if (f.purpose) {
        setPurpose(f.purpose)
        filled.push('用途')
      }
      if (f.expected_return_at) {
        setExpectedReturnAt(f.expected_return_at)
        filled.push('预计归还时间')
      }
      if (f.remark) {
        setRemark(f.remark)
        filled.push('备注')
      }

      if (filled.length === 0) {
        Taro.showToast({ title: '未识别到可填充字段', icon: 'none' })
      } else {
        Taro.showToast({
          title: `已填充：${filled.join('、')}`,
          icon: 'none',
          duration: 2500
        })
      }
    } catch (e) {
      Taro.hideLoading()
      const msg = e instanceof Error ? e.message : 'AI 解析失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }, [type])

  return {
    type,
    equipmentName,
    quantity,
    photos,
    recipient,
    purpose,
    expectedReturnAt,
    remark,
    submitting,
    annotator,
    editingId,
    currentStock,
    setType,
    setEquipmentName,
    setQuantity,
    setPhotos,
    setRecipient,
    setPurpose,
    setExpectedReturnAt,
    setRemark,
    setAnnotator,
    setCurrentStock,
    loadRecord,
    handleSubmit,
    handleAiFill,
  }
}

function goBack() {
  const pages = Taro.getCurrentPages()
  if (pages.length > 1) {
    Taro.navigateBack()
  } else {
    Taro.redirectTo({ url: '/pages/records/index' })
  }
}
