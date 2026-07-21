import { useEffect } from 'react'
import { View, Text, Input, Textarea, Button } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useUserStore } from '@/store/user'
import PhotoAnnotator from '@/components/PhotoAnnotator'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import { useRecordForm } from './hooks/useRecordForm'
import { useEquipmentPicker } from './hooks/useEquipmentPicker'
import TypeSwitch from './components/TypeSwitch'
import EquipmentField from './components/EquipmentField'
import PhotoSection from './components/PhotoSection'
import OutFields from './components/OutFields'
import ConfirmModal from './components/ConfirmModal'
import AiFillBar from './components/AiFillBar'
import './index.scss'

export default function RecordEdit() {
  const router = useRouter()
  const token = useUserStore((s) => s.token)
  const user = useUserStore((s) => s.user)

  const form = useRecordForm()
  const picker = useEquipmentPicker()

  useEffect(() => {
    if (!token) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    if (user && user.role === 'viewer') {
      Taro.showToast({ title: '无操作权限', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    picker.loadEquipmentList()
  }, [token, user])

  useEffect(() => {
    const id = router.params?.id
    if (id) {
      form.loadRecord(parseInt(id, 10))
    }
  }, [router.params?.id])

  const handleTypeChange = (t: 'in' | 'out') => {
    form.setType(t)
    form.setPhotos([])
  }

  const handleEquipmentSelect = (item: { id: number; name: string; stock: number }) => {
    form.setEquipmentName(item.name)
    picker.handleSelectEquipment(item, form.type)
  }

  const handleEquipmentInput = (value: string) => {
    form.setEquipmentName(value)
    picker.handleEquipmentInput(value, form.type)
  }

  const handleAnnotatorSave = (newUrl: string) => {
    form.setPhotos((prev) => [
      ...prev,
      { url: newUrl, kind: 'annotated', isAnnotated: true }
    ])
    form.setAnnotator(null)
  }

  const handleAnnotatorCancel = () => {
    const currentAnnotator = form.annotator
    form.setAnnotator(null)
    if (currentAnnotator) {
      Taro.showModal({
        title: '提示',
        content: '是否将原图作为位置图上传（不标注）？',
        confirmText: '用原图',
        cancelText: '丢弃'
      })
        .then((r) => {
          if (r.confirm && currentAnnotator) {
            form.setPhotos((prev) => [
              ...prev,
              { url: currentAnnotator.originalUrl, kind: 'annotated', isAnnotated: false }
            ])
          }
        })
        .catch(() => {})
    }
  }

  const handlePickerCancel = () => {
    picker.handleCancelEquipment()
    form.setEquipmentName('')
  }

  // 标注器全屏模式
  if (form.annotator) {
    return (
      <PhotoAnnotator
        imageUrl={form.annotator.imageUrl}
        onSave={handleAnnotatorSave}
        onCancel={handleAnnotatorCancel}
      />
    )
  }

  // 权限守卫
  if (!token || (user && user.role === 'viewer')) {
    return <View className='record-edit'><Text> </Text></View>
  }

  return (
    <View className='record-edit'>
      <View className='record-edit__form'>
        <AiFillBar onTrigger={form.handleAiFill} />

        <TypeSwitch type={form.type} onChange={handleTypeChange} />

        <EquipmentField
          type={form.type}
          equipmentName={form.equipmentName}
          currentStock={picker.currentStock}
          showSuggestions={picker.showSuggestions}
          filteredList={picker.filteredList}
          showEquipmentPicker={picker.showEquipmentPicker}
          equipmentList={picker.equipmentList}
          onInput={handleEquipmentInput}
          onSelect={handleEquipmentSelect}
          onOpenPicker={() => picker.setShowEquipmentPicker(true)}
          onClosePicker={() => picker.setShowEquipmentPicker(false)}
        />

        <View className='record-edit__field'>
          <Text className='record-edit__label'>
            <Text className='record-edit__required'>*</Text>数量（正整数）
          </Text>
          <Input
            className='record-edit__input'
            type='number'
            value={form.quantity}
            placeholder='请输入数量'
            onInput={(e) => form.setQuantity(e.detail.value)}
          />
        </View>

        {form.type === 'in' && (
          <PhotoSection
            photos={form.photos}
            setPhotos={form.setPhotos}
            setAnnotator={form.setAnnotator}
          />
        )}

        {form.type === 'out' && (
          <OutFields
            recipient={form.recipient}
            expectedReturnAt={form.expectedReturnAt}
            onRecipientChange={form.setRecipient}
            onExpectedReturnChange={form.setExpectedReturnAt}
          />
        )}

        <View className='record-edit__field'>
          <Text className='record-edit__label'>用途（可选）</Text>
          <Input
            className='record-edit__input'
            value={form.purpose}
            placeholder='请输入用途'
            onInput={(e) => form.setPurpose(e.detail.value)}
          />
        </View>

        <View className='record-edit__field'>
          <Text className='record-edit__label'>备注（可选）</Text>
          <Textarea
            className='record-edit__textarea'
            value={form.remark}
            placeholder='请输入备注'
            maxlength={200}
            onInput={(e) => form.setRemark(e.detail.value)}
          />
        </View>

        <Button
          className='record-edit__submit'
          loading={form.submitting}
          disabled={form.submitting}
          onClick={() => form.handleSubmit(picker.currentStock)}
        >
          {form.submitting
            ? (form.editingId ? '修改中...' : '提交中...')
            : (form.editingId ? '保存修改' : '提交')}
        </Button>
      </View>

      {picker.showConfirmEquipment && (
        <ConfirmModal
          equipmentName={form.equipmentName}
          currentStock={picker.currentStock}
          equipmentInRecords={picker.equipmentInRecords}
          onConfirm={picker.handleConfirmEquipment}
          onCancel={handlePickerCancel}
        />
      )}

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
