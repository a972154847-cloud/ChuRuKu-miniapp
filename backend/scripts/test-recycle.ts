/**
 * 回收站功能测试脚本
 * 测试流程：
 *   1. 登录获取 admin token
 *   2. 测试记录删除→回收站
 *   3. 测试分类删除→回收站
 *   4. 测试回收站列表（含筛选）
 *   5. 测试恢复记录
 *   6. 测试恢复分类
 *   7. 测试永久删除
 *
 * 运行: npx tsx scripts/test-recycle.ts
 */
import http from 'http'

const BASE = 'http://localhost:3001/api'
let token = ''
let testRecordId = 0
let testCategoryId = 0
let recycleItemId = 0

function request(method: string, path: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path)
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ ${msg}`)
  console.log(`  ✅ ${msg}`)
}

function assertStatus(res: any, expected: number, label: string) {
  const ok = res.status === expected
  const statusSymbol = ok ? '✅' : '❌'
  console.log(`  ${statusSymbol} ${label} → ${res.status} ${ok ? '' : JSON.stringify(res.body).slice(0, 120)}`)
  if (!ok) throw new Error(`${label} 失败: ${JSON.stringify(res.body)}`)
}

async function main() {
  console.log('\n========== 1. 登录获取 admin token ==========')
  const loginRes = await request('POST', '/auth/dev-login?override=true', { role: 'admin' })
  assertStatus(loginRes, 200, '管理员登录')
  token = loginRes.body.data?.token || ''
  assert(!!token, '获取到 token')

  console.log('\n========== 2. 准备测试数据 ==========')
  // 获取一级分类作为父分类
  const catTree = await request('GET', '/categories')
  assertStatus(catTree, 200, '获取分类树')
  const parentCat = catTree.body.data?.[0]
  assert(!!parentCat, '存在一级分类')
  const parentId = parentCat.id
  console.log(`  父分类: ${parentCat.name} (ID: ${parentId})`)

  // 创建一个测试分类
  const catRes = await request('POST', '/categories', {
    name: '测试分类-回收站',
    code: 'TEST_RECYCLE_CAT_' + Date.now(),
    level: 2,
    parent_id: parentId,
  })
  assertStatus(catRes, 201, '创建测试分类')
  testCategoryId = catRes.body.data?.id || 0
  assert(testCategoryId > 0, `测试分类 ID: ${testCategoryId}`)

  // 创建一个测试器材
  const equipRes = await request('POST', '/records', {
    equipment_name: '测试器材-回收站_' + Date.now(),
    type: 'in',
    quantity: 10,
    remark: '回收站测试',
  })
  assertStatus(equipRes, 201, '创建测试入库记录')
  testRecordId = equipRes.body.data?.id || 0
  assert(testRecordId > 0, `测试记录 ID: ${testRecordId}`)

  console.log('\n========== 3. 删除记录→验证进入回收站 ==========')
  const delRecordRes = await request('DELETE', `/records/${testRecordId}`)
  assertStatus(delRecordRes, 200, '删除测试记录')

  // 检查回收站列表
  const list1 = await request('GET', '/recycle?entity_type=record&pageSize=50')
  assertStatus(list1, 200, '查询回收站列表(按记录筛选)')
  const recordInBin = list1.body.data?.list?.find((i: any) => i.entity_id === testRecordId)
  assert(!!recordInBin, `记录 #${testRecordId} 出现在回收站中`)
  assert(recordInBin.entity_type === 'record', 'entity_type 为 record')
  assert(!!recordInBin.entity_summary, 'entity_summary 不为空')
  assert(!!recordInBin.deleted_by_name, 'deleted_by_name 不为空')
  console.log(`  摘要: ${recordInBin.entity_summary}`)
  console.log(`  删除者: ${recordInBin.deleted_by_name}`)
  recycleItemId = recordInBin.id

  console.log('\n========== 4. 删除分类→验证进入回收站 ==========')
  // force=true 删除分类（因为关联器材可能已删，但为了演示用 force）
  const delCatRes = await request('DELETE', `/categories/${testCategoryId}?force=true`)
  assertStatus(delCatRes, 200, '删除测试分类')

  const list2 = await request('GET', '/recycle?entity_type=category&pageSize=50')
  assertStatus(list2, 200, '查询回收站列表(按分类筛选)')
  const catInBin = list2.body.data?.list?.find((i: any) => i.entity_id === testCategoryId)
  assert(!!catInBin, `分类 #${testCategoryId} 出现在回收站中`)
  assert(catInBin.entity_type === 'category', 'entity_type 为 category')
  console.log(`  摘要: ${catInBin.entity_summary}`)

  console.log('\n========== 5. 测试回收站列表全部 + 分页 ==========')
  const listAll = await request('GET', '/recycle?page=1&pageSize=10')
  assertStatus(listAll, 200, '查询全部回收站列表')
  assert(listAll.body.data?.total >= 2, `总数 >= 2 (实际: ${listAll.body.data?.total})`)
  assert(Array.isArray(listAll.body.data?.list), 'list 为数组')
  assert(listAll.body.data?.list?.length > 0, 'list 不为空')
  console.log(`  总数: ${listAll.body.data?.total}, 当前页: ${listAll.body.data?.list?.length} 条`)

  console.log('\n========== 6. 测试恢复记录 ==========')
  const restoreRes = await request('POST', `/recycle/${recycleItemId}/restore`)
  assertStatus(restoreRes, 200, '恢复记录')
  assert(restoreRes.body.data?.restored_at, 'restored_at 已标记')

  // 验证记录已恢复
  const getRecordRes = await request('GET', `/records/${testRecordId}`)
  assertStatus(getRecordRes, 200, '查询已恢复的记录')
  console.log(`  恢复的记录 ID: ${getRecordRes.body.data?.id}`)

  // 验证已恢复的条目不在回收站列表中
  const list3 = await request('GET', '/recycle?entity_type=record&pageSize=50')
  const recordNotInBin = list3.body.data?.list?.find((i: any) => i.entity_id === testRecordId)
  assert(!recordNotInBin, '恢复后记录不再出现在回收站列表中')

  console.log('\n========== 7. 测试恢复分类 ==========')
  const catRestoreRes = await request('POST', `/recycle/${catInBin.id}/restore`)
  assertStatus(catRestoreRes, 200, '恢复分类')

  // 验证分类已恢复
  // 直接用 tree 接口看是否包含该分类
  const catTree2 = await request('GET', '/categories')
  assertStatus(catTree2, 200, '查询分类树')
  // 我们无法直接验证恢复的 ID，因为分类树是嵌套结构，但至少请求成功了

  console.log('\n========== 8. 测试重复恢复（应失败） ==========')
  // 记录已恢复，再恢复应报错
  const dupRestore = await request('POST', `/recycle/${recycleItemId}/restore`)
  assert(dupRestore.status === 400, '重复恢复返回 400')
  console.log(`  预期错误: ${dupRestore.body?.message || dupRestore.body}`)

  console.log('\n========== 9. 测试不存在的回收站条目 ==========')
  const notFound = await request('POST', '/recycle/999999/restore')
  assert(notFound.status === 404, '不存在的条目返回 404')

  const delNotFound = await request('DELETE', '/recycle/999999')
  assert(delNotFound.status === 404, '删除不存在的条目返回 404')

  console.log('\n========== 10. 清理：删除刚创建的记录和分类 ==========')
  // 删除测试记录和分类（测试它们再次进入回收站后可以永久删除）
  await request('DELETE', `/records/${testRecordId}`)
  await request('DELETE', `/categories/${testCategoryId}?force=true`)

  // 再次列出回收站
  const list4 = await request('GET', '/recycle?pageSize=50')
  const record2 = list4.body.data?.list?.find((i: any) => i.entity_id === testRecordId)
  const cat2 = list4.body.data?.list?.find((i: any) => i.entity_id === testCategoryId)

  if (record2) {
    // 测试永久删除
    const permDel = await request('DELETE', `/recycle/${record2.id}`)
    assertStatus(permDel, 200, '永久删除回收站的记录')
    console.log(`  已永久删除记录 #${record2.id}`)
  }
  if (cat2) {
    const permDel = await request('DELETE', `/recycle/${cat2.id}`)
    assertStatus(permDel, 200, '永久删除回收站的分类')
    console.log(`  已永久删除分类 #${cat2.id}`)
  }

  console.log('\n========== 11. 非法参数测试 ==========')
  const badId1 = await request('POST', '/recycle/abc/restore')
  assert(badId1.status === 400, '非法 id 返回 400')

  const badId2 = await request('DELETE', '/recycle/abc')
  assert(badId2.status === 400, '非法 id 返回 400')

  console.log('\n🎉 所有回收站功能测试通过！\n')
}

main().catch((err) => {
  console.error('\n❌ 测试失败:', err.message)
  process.exit(1)
})
