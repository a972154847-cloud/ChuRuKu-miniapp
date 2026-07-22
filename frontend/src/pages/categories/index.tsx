import { useEffect, useState, useCallback } from 'react'
import { View, Text, Input, Picker, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import {
  listCategoriesTree,
  createCategory,
  updateCategory,
  deleteCategory,
  type CategoryTreeNode
} from '@/services/categories'
import { ApiError } from '@/services/request'
import { useUserStore } from '@/store/user'
import AIFab from '@/components/AIFab'
import AIChatPanel from '@/components/AIChatPanel'
import './index.scss'

type ModalMode = 'create' | 'edit'

interface ModalForm {
  id?: number
  name: string
  code: string
  parentId: number | null
  level: number
}

export default function Categories() {
  const currentUser = useUserStore((s) => s.user)
  const token = useUserStore((s) => s.token)
  const isAdmin = currentUser?.role === 'admin'

  const [tree, setTree] = useState<CategoryTreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>('create')
  const [form, setForm] = useState<ModalForm>({
    name: '',
    code: '',
    parentId: null,
    level: 1
  })

  const fetchTree = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const t = await listCategoriesTree()
      setTree(t || [])
    } catch {
      // 错误已由 request.ts toast
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) fetchTree()
  }, [token, fetchTree])

  // 未登录跳转
  useEffect(() => {
    if (!token) {
      Taro.reLaunch({ url: '/pages/login/index' })
    }
  }, [token])

  // 非 admin 显示无权限
  if (token && !isAdmin) {
    return (
      <View className='categories-page'>
        <View className='categories-empty'>
          <Text className='categories-empty__text'>无权限</Text>
          <Text className='categories-empty__sub'>请联系管理员开通权限</Text>
        </View>
      </View>
    )
  }

  if (!token) {
    return (
      <View className='categories-page'>
        <View className='categories-empty'>
          <Text className='categories-empty__text'> </Text>
        </View>
      </View>
    )
  }

  // 新增一级分类
  const openCreateRoot = () => {
    setModalMode('create')
    setForm({ name: '', code: '', parentId: null, level: 1 })
    setModalVisible(true)
  }

  // 新增子分类
  const openCreateChild = (parent: CategoryTreeNode) => {
    setModalMode('create')
    setForm({ name: '', code: '', parentId: parent.id, level: 2 })
    setModalVisible(true)
  }

  // 编辑分类
  const openEdit = (cat: { id: number; name: string; code: string; parent_id: number | null; level: number }) => {
    setModalMode('edit')
    setForm({
      id: cat.id,
      name: cat.name,
      code: cat.code,
      parentId: cat.parent_id,
      level: cat.level
    })
    setModalVisible(true)
  }

  // parent Picker 选项：0=一级分类(null)，后面是各大类
  const parentOptions = ['(作为一级分类)', ...tree.map((r) => r.name)]
  const parentIdx = form.parentId
    ? (() => {
        const idx = tree.findIndex((r) => r.id === form.parentId)
        return idx >= 0 ? idx + 1 : 0
      })()
    : 0

  const handleParentChange = (idx: number) => {
    if (idx === 0) {
      setForm({ ...form, parentId: null, level: 1 })
    } else {
      const root = tree[idx - 1]
      setForm({ ...form, parentId: root.id, level: 2 })
    }
  }

  const handleSubmit = async () => {
    const name = form.name.trim()
    const code = form.code.trim()
    if (!name) {
      Taro.showToast({ title: '请输入分类名称', icon: 'none' })
      return
    }
    if (!code) {
      Taro.showToast({ title: '请输入分类 code', icon: 'none' })
      return
    }
    setLoading(true)
    try {
      if (modalMode === 'create') {
        await createCategory({
          name,
          code,
          parent_id: form.parentId,
          level: form.level
        })
        Taro.showToast({ title: '创建成功', icon: 'success' })
      } else {
        await updateCategory(form.id!, { name, code, parent_id: form.parentId, level: form.level })
        Taro.showToast({ title: '修改成功', icon: 'success' })
      }
      setModalVisible(false)
      await fetchTree()
    } catch {
      // 错误已 toast
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = (cat: { id: number; name: string; level: number }) => {
    Taro.showModal({
      title: '删除分类',
      content: `确定删除分类「${cat.name}」？`,
      confirmText: '删除',
      confirmColor: '#d9534f',
      success: async (r) => {
        if (!r.confirm) return
        setLoading(true)
        try {
          await deleteCategory(cat.id)
          Taro.showToast({ title: '删除成功', icon: 'success' })
          await fetchTree()
        } catch (err) {
          // 检测是否有关联器材，若有则弹出二次确认（输入分类名确认）
          if (err instanceof ApiError && err.hasEquipments) {
            ;(Taro.showModal as Function)({
              title: '检测到关联器材',
              content: `${err.message}\n如需强制删除，请输入分类名称「${cat.name}」确认（关联器材的 category_id 将被置空）`,
              editable: true,
              placeholderText: `请输入 ${cat.name}`,
              confirmText: '强制删除',
              confirmColor: '#d9534f',
              success: async (r2: any) => {
                if (!r2.confirm) {
                  setLoading(false)
                  return
                }
                // 校验用户输入是否与分类名称完全一致
                if (r2.content !== cat.name) {
                  Taro.showToast({ title: '输入与分类名称不一致，已取消', icon: 'none' })
                  setLoading(false)
                  return
                }
                try {
                  await deleteCategory(cat.id, true)
                  Taro.showToast({ title: '已强制删除', icon: 'success' })
                  await fetchTree()
                } catch (e2) {
                  const msg = e2 instanceof ApiError ? e2.message : '删除失败'
                  Taro.showToast({ title: msg, icon: 'none' })
                } finally {
                  setLoading(false)
                }
              },
              fail: () => setLoading(false),
            })
          } else {
            // 其他错误：toast 提示
            const msg = err instanceof ApiError ? err.message : '删除失败'
            Taro.showToast({ title: msg, icon: 'none' })
            setLoading(false)
          }
        }
      },
    })
  }

  return (
    <View className='categories-page'>
      <View className='categories-header'>
        <Text className='categories-header__title'>器材分类管理</Text>
        <Button
          className='categories-header__btn'
          size='mini'
          onClick={openCreateRoot}
        >
          新增分类
        </Button>
      </View>

      <View className='categories-tree'>
        {tree.length === 0 && !loading && (
          <View className='categories-empty'>
            <Text className='categories-empty__text'>暂无分类数据</Text>
          </View>
        )}
        {tree.map((root) => (
          <View key={root.id} className='categories-node categories-node--root'>
            <View className='categories-node__row'>
              <View className='categories-node__main'>
                <Text className='categories-node__name'>{root.name}</Text>
                <Text className='categories-node__code'>{root.code}</Text>
              </View>
              <View className='categories-node__actions'>
                <Text
                  className='categories-node__action categories-node__action--add'
                  onClick={() => openCreateChild(root)}
                >
                  +子类
                </Text>
                <Text
                  className='categories-node__action'
                  onClick={() => openEdit(root)}
                >
                  编辑
                </Text>
                <Text
                  className='categories-node__action categories-node__action--del'
                  onClick={() => handleDelete(root)}
                >
                  删除
                </Text>
              </View>
            </View>
            {root.children && root.children.length > 0 && (
              <View className='categories-node__children'>
                {root.children.map((child) => (
                  <View key={child.id} className='categories-node categories-node--child'>
                    <View className='categories-node__row'>
                      <View className='categories-node__main'>
                        <Text className='categories-node__name categories-node__name--child'>
                          {child.name}
                        </Text>
                        <Text className='categories-node__code'>{child.code}</Text>
                      </View>
                      <View className='categories-node__actions'>
                        <Text
                          className='categories-node__action'
                          onClick={() => openEdit(child)}
                        >
                          编辑
                        </Text>
                        <Text
                          className='categories-node__action categories-node__action--del'
                          onClick={() => handleDelete(child)}
                        >
                          删除
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </View>

      {modalVisible && (
        <View className='categories-modal-mask'>
          <View className='categories-modal'>
            <Text className='categories-modal__title'>
              {modalMode === 'create' ? '新增分类' : '编辑分类'}
            </Text>
            <View className='categories-modal__field'>
              <Text className='categories-modal__label'>分类名称</Text>
              <Input
                className='categories-modal__input'
                value={form.name}
                placeholder='请输入分类名称'
                onInput={(e) => setForm({ ...form, name: e.detail.value })}
              />
            </View>
            <View className='categories-modal__field'>
              <Text className='categories-modal__label'>分类 code（唯一）</Text>
              <Input
                className='categories-modal__input'
                value={form.code}
                placeholder='例如 PORTABLE_POWDER'
                onInput={(e) => setForm({ ...form, code: e.detail.value })}
              />
            </View>
            <View className='categories-modal__field'>
              <Text className='categories-modal__label'>父级分类</Text>
              <Picker
                mode='selector'
                range={parentOptions}
                value={parentIdx}
                onChange={(e) => handleParentChange(Number(e.detail.value))}
              >
                <View className='categories-modal__picker'>
                  <Text>{parentOptions[parentIdx]}</Text>
                </View>
              </Picker>
            </View>
            <View className='categories-modal__btns'>
              <Button
                className='categories-modal__btn categories-modal__btn--cancel'
                onClick={() => setModalVisible(false)}
              >
                取消
              </Button>
              <Button
                className='categories-modal__btn categories-modal__btn--ok'
                loading={loading}
                onClick={handleSubmit}
              >
                确认
              </Button>
            </View>
          </View>
        </View>
      )}

      <AIFab />
      <AIChatPanel mode='floating' />
    </View>
  )
}
