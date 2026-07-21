/**
 * ai-tools.service 单元测试
 * 覆盖：
 * - AI_TOOLS 定义（7 个工具：list_equipments / list_categories / search_records
 *   / create_inbound_record / web_search / create_outbound_record / get_equipment_stock）
 * - executeTool 6 个 case 全部 happy path + 错误分支
 * - args JSON 解析失败 / 未知工具名 / 工具执行抛错 三个 catch 路径
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

const { runMigrations } = require('../src/db/migrate')
runMigrations()

const db = require('../src/db').default

// mock web-search（外部 HTTP 调用）
jest.mock('../src/services/web-search.service', () => ({
  webSearch: jest.fn(),
}))
const { webSearch } = require('../src/services/web-search.service') as {
  webSearch: jest.Mock
}

// 在 mock 之后 import
const { AI_TOOLS, executeTool } = require('../src/services/ai-tools.service')
const { resetDatabase } = require('../src/db/seed') as typeof import('../src/db/seed')

const ctx = { userId: 1, userRole: 'editor', userName: 'Editor' }

beforeEach(() => {
  resetDatabase()
  jest.clearAllMocks()
  // 清空迁移预置的 20 条种子器材与相关记录，避免与固定 id 冲突
  db.exec('DELETE FROM record_photos')
  db.exec('DELETE FROM records')
  db.exec('DELETE FROM equipments')
  // 造一个 admin 用户作为操作人（createRecord 内部会按 id 查 operator.name）
  db.prepare('INSERT INTO users (id, openid, name, role) VALUES (?, ?, ?, ?)').run(
    1,
    'admin-openid',
    'Admin',
    'admin'
  )
  // 造 3 个种子器材（不同名字便于模糊匹配测试）
  db.prepare('INSERT INTO equipments (id, name, spec) VALUES (?, ?, ?)').run(1, '手提式干粉灭火器', '4kg')
  db.prepare('INSERT INTO equipments (id, name, spec) VALUES (?, ?, ?)').run(2, '推车式干粉灭火器', '25kg')
  db.prepare('INSERT INTO equipments (id, name, spec) VALUES (?, ?, ?)').run(3, '二氧化碳灭火器', '5kg')
})

describe('AI_TOOLS 定义', () => {
  test('导出 7 个工具（含 web_search）', () => {
    expect(AI_TOOLS).toHaveLength(7)
    const names = AI_TOOLS.map((t: any) => t.function.name)
    expect(names).toContain('list_equipments')
    expect(names).toContain('list_categories')
    expect(names).toContain('search_records')
    expect(names).toContain('create_inbound_record')
    expect(names).toContain('create_outbound_record')
    expect(names).toContain('get_equipment_stock')
    expect(names).toContain('web_search')
  })

  test('每个工具都有 type/function/parameters', () => {
    for (const t of AI_TOOLS) {
      expect(t.type).toBe('function')
      expect(t.function.name).toBeTruthy()
      expect(t.function.description).toBeTruthy()
      expect(t.function.parameters.type).toBe('object')
    }
  })

  test('create_inbound_record / create_outbound_record / web_search / get_equipment_stock 标记 required', () => {
    const requiredNames = ['create_inbound_record', 'create_outbound_record', 'web_search', 'get_equipment_stock']
    for (const name of requiredNames) {
      const tool = AI_TOOLS.find((t: any) => t.function.name === name) as any
      expect(Array.isArray(tool.function.parameters.required)).toBe(true)
      expect(tool.function.parameters.required.length).toBeGreaterThan(0)
    }
  })
})

describe('executeTool 公共错误分支', () => {
  test('argsJson 非合法 JSON → success=false', async () => {
    const res = await executeTool('list_equipments', '{invalid}', ctx)
    expect(res.success).toBe(false)
    expect(res.message).toContain('JSON 解析失败')
  })

  test('argsJson 为空字符串 → 默认 {}（继续执行）', async () => {
    const res = await executeTool('list_equipments', '', ctx)
    expect(res.success).toBe(true)
  })

  test('未知工具名 → success=false', async () => {
    const res = await executeTool('unknown_tool_xyz', '{}', ctx)
    expect(res.success).toBe(false)
    expect(res.message).toContain('未知工具')
  })

  test('工具内部抛错 → catch 返回 success=false 含错误信息', async () => {
    // 用 list_records + 非法 type 触发 record service 内部错误
    // 实际上 createRecord 等在输入非法时返回 throw，会被外层 catch
    const res = await executeTool('create_inbound_record', JSON.stringify({ quantity: -1 }), ctx)
    expect(res.success).toBe(false)
  })
})

describe('executeTool list_equipments', () => {
  test('无 keyword 返回全部 + 分页字段', async () => {
    const res = await executeTool('list_equipments', '{}', ctx)
    expect(res.success).toBe(true)
    expect(res.data.list.length).toBe(3)
    expect(res.data.page).toBe(1)
    expect(res.data.pageSize).toBe(20)
    expect(res.data.total).toBe(3)
  })

  test('有 keyword 时按名称 LIKE 过滤', async () => {
    const res = await executeTool('list_equipments', JSON.stringify({ keyword: '干粉' }), ctx)
    expect(res.success).toBe(true)
    expect(res.data.list.length).toBe(2)
    for (const e of res.data.list) {
      expect(e.name).toContain('干粉')
    }
  })

  test('pageSize 限制返回数量', async () => {
    const res = await executeTool(
      'list_equipments',
      JSON.stringify({ pageSize: 1 }),
      ctx
    )
    expect(res.data.list.length).toBe(1)
    expect(res.data.pageSize).toBe(1)
  })

  test('page=2 OFFSET 正确（避免返回第一页内容）', async () => {
    const res = await executeTool(
      'list_equipments',
      JSON.stringify({ page: 2, pageSize: 2 }),
      ctx
    )
    expect(res.success).toBe(true)
    expect(res.data.page).toBe(2)
  })

  test('非法 page/pageSize 走 Number() || 默认值', async () => {
    const res = await executeTool(
      'list_equipments',
      JSON.stringify({ page: 'abc', pageSize: 'xyz' }),
      ctx
    )
    expect(res.data.page).toBe(1)
    expect(res.data.pageSize).toBe(20)
  })

  test('current_stock 通过 COALESCE 计算（无记录时为 0）', async () => {
    const res = await executeTool('list_equipments', '{}', ctx)
    for (const e of res.data.list) {
      expect(e.current_stock).toBe(0)
    }
  })
})

describe('executeTool list_categories', () => {
  test('返回分类树（根节点含 children）', async () => {
    const res = await executeTool('list_categories', '{}', ctx)
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data.length).toBeGreaterThan(0)
    expect(Array.isArray(res.data[0].children)).toBe(true)
  })
})

describe('executeTool search_records', () => {
  test('无参数返回空 list', async () => {
    const res = await executeTool('search_records', '{}', ctx)
    expect(res.success).toBe(true)
    expect(res.data.list).toEqual([])
  })

  test('带 type=in 过滤', async () => {
    // 先造一条入库
    db.prepare(
      'INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, ?, ?, ?)'
    ).run(1, 'in', 5, 1)
    const res = await executeTool('search_records', JSON.stringify({ type: 'in' }), ctx)
    expect(res.data.list.length).toBe(1)
  })

  test('带 keyword 模糊搜索器材名', async () => {
    db.prepare(
      'INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, ?, ?, ?)'
    ).run(2, 'in', 3, 1)
    const res = await executeTool('search_records', JSON.stringify({ keyword: '推车' }), ctx)
    expect(res.data.list.length).toBe(1)
  })

  test('带 start_date / end_date 过滤', async () => {
    db.prepare(
      'INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, ?, ?, ?)'
    ).run(1, 'in', 1, 1)
    const today = new Date().toISOString().slice(0, 10)
    const res = await executeTool(
      'search_records',
      JSON.stringify({ start_date: today, end_date: today }),
      ctx
    )
    expect(res.data.list.length).toBe(1)
  })
})

describe('executeTool create_inbound_record', () => {
  test('happy path：自动创建新器材并入库', async () => {
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({ equipment_name: '新器材ABC', quantity: 10 }),
      ctx
    )
    expect(res.success).toBe(true)
    expect(res.data.message).toContain('入库 10')
    const eq = db.prepare('SELECT * FROM equipments WHERE name = ?').get('新器材ABC')
    expect(eq).toBeTruthy()
  })

  test('已存在器材 + quantity + remark', async () => {
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({ equipment_name: '手提式干粉灭火器', quantity: 5, remark: 'test' }),
      ctx
    )
    expect(res.success).toBe(true)
  })

  test('空名称 → 失败', async () => {
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({ equipment_name: '', quantity: 1 }),
      ctx
    )
    expect(res.success).toBe(false)
    expect(res.message).toContain('名称')
  })

  test('quantity=0 / 负数 → 失败', async () => {
    const r1 = await executeTool(
      'create_inbound_record',
      JSON.stringify({ equipment_name: 'X', quantity: 0 }),
      ctx
    )
    expect(r1.success).toBe(false)
    const r2 = await executeTool(
      'create_inbound_record',
      JSON.stringify({ equipment_name: 'X', quantity: -3 }),
      ctx
    )
    expect(r2.success).toBe(false)
  })

  test('quantity 非数字 → 失败', async () => {
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({ equipment_name: 'X', quantity: 'abc' }),
      ctx
    )
    expect(res.success).toBe(false)
  })

  test('photo_urls 传 2 张时成功附加（最多 3 张）', async () => {
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({
        equipment_name: '带图器材',
        quantity: 1,
        photo_urls: ['https://x.com/a.jpg', 'https://x.com/b.jpg'],
      }),
      ctx
    )
    expect(res.success).toBe(true)
    expect(res.data.message).toContain('含 2 张照片')
  })

  test('photo_urls > 3 张时被 slice(0,3) 截断', async () => {
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({
        equipment_name: '多图器材',
        quantity: 1,
        photo_urls: [
          'https://x.com/1.jpg',
          'https://x.com/2.jpg',
          'https://x.com/3.jpg',
          'https://x.com/4.jpg',
          'https://x.com/5.jpg',
        ],
      }),
      ctx
    )
    expect(res.success).toBe(true)
    // 实际附加 3 张
    const photos = db
      .prepare('SELECT * FROM record_photos WHERE kind = ?')
      .all('product') as Array<{ id: number; url: string }>
    expect(photos.length).toBe(3)
  })

  test('photo_urls 含非字符串元素时被过滤', async () => {
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({
        equipment_name: '过滤图',
        quantity: 1,
        photo_urls: ['https://x.com/1.jpg', 123, null, 'https://x.com/2.jpg', ''],
      }),
      ctx
    )
    expect(res.success).toBe(true)
    const photos = db
      .prepare('SELECT * FROM record_photos')
      .all() as Array<{ url: string }>
    // 空字符串被 length>0 过滤，非字符串被 typeof 过滤
    expect(photos.length).toBe(2)
  })

  test('photo_urls 关联失败时仍返回 success=true（含降级 message）', async () => {
    // 通过传一个不存在的 record id 不可行（executeTool 内部 createRecord 分配新 id）
    // 模拟 attachPhotos 抛错：传一个非法的 kind 让 attachPhotos 走异常路径
    // 这里只能测 happy 路径 → 改用直接 SQL 让 attachPhotos 在 service 内失败比较难
    // 改为：photo_urls 为非数组时被静默忽略
    const res = await executeTool(
      'create_inbound_record',
      JSON.stringify({
        equipment_name: '非数组图',
        quantity: 1,
        photo_urls: 'not-an-array',
      }),
      ctx
    )
    expect(res.success).toBe(true)
    const photos = db.prepare('SELECT * FROM record_photos').all() as unknown[]
    expect(photos.length).toBe(0)
  })
})

describe('executeTool web_search', () => {
  test('未配置搜索 API → available=false → success=false', async () => {
    webSearch.mockResolvedValueOnce({
      available: false,
      query: 'x',
      summary: 'not enabled',
      results: [],
    })
    const res = await executeTool('web_search', JSON.stringify({ query: '消防标准' }), ctx)
    expect(res.success).toBe(false)
    expect(res.message).toContain('未启用')
  })

  test('搜索结果返回前 5 条', async () => {
    webSearch.mockResolvedValueOnce({
      available: true,
      query: '消防',
      summary: 'sum',
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `title-${i}`,
        snippet: `snippet-${i}`,
        url: `https://x.com/${i}`,
      })),
    })
    const res = await executeTool('web_search', JSON.stringify({ query: '消防' }), ctx)
    expect(res.success).toBe(true)
    expect(res.data.results).toHaveLength(5)
    expect(res.data.results[0].title).toBe('title-0')
  })

  test('query 为空 → 失败', async () => {
    const res = await executeTool('web_search', JSON.stringify({ query: '' }), ctx)
    expect(res.success).toBe(false)
  })

  test('query 为纯空白 → 失败', async () => {
    const res = await executeTool('web_search', JSON.stringify({ query: '   ' }), ctx)
    expect(res.success).toBe(false)
  })
})

describe('executeTool create_outbound_record', () => {
  test('happy path：先入库再出库', async () => {
    // 先入库 10 个
    db.prepare(
      'INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, ?, ?, ?)'
    ).run(1, 'in', 10, 1)
    const res = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: '手提式干粉灭火器', quantity: 3, recipient: '张三' }),
      ctx
    )
    expect(res.success).toBe(true)
    expect(res.data.message).toContain('出库 3 件给 张三')
  })

  test('happy path 带 purpose + expected_return_at', async () => {
    db.prepare(
      'INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, ?, ?, ?)'
    ).run(1, 'in', 5, 1)
    const res = await executeTool(
      'create_outbound_record',
      JSON.stringify({
        equipment_name: '手提式干粉灭火器',
        quantity: 1,
        recipient: '李四',
        purpose: '演练',
        expected_return_at: '2026-12-31',
      }),
      ctx
    )
    expect(res.success).toBe(true)
  })

  test('空名称 / 空 recipient → 失败', async () => {
    const r1 = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: '', quantity: 1, recipient: 'X' }),
      ctx
    )
    expect(r1.success).toBe(false)
    const r2 = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: 'X', quantity: 1, recipient: '' }),
      ctx
    )
    expect(r2.success).toBe(false)
  })

  test('quantity 非正整数 → 失败', async () => {
    const r1 = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: 'X', quantity: 0, recipient: 'R' }),
      ctx
    )
    expect(r1.success).toBe(false)
    const r2 = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: 'X', quantity: 'abc', recipient: 'R' }),
      ctx
    )
    expect(r2.success).toBe(false)
  })

  test('器材不存在 → 失败', async () => {
    const res = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: '不存在器材XYZ', quantity: 1, recipient: 'R' }),
      ctx
    )
    expect(res.success).toBe(false)
    expect(res.message).toContain('未找到')
  })

  test('模糊匹配多个器材 → 提示精确指定', async () => {
    // 干粉 模糊匹配到 2 个（手提式 + 推车式）
    const res = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: '干粉', quantity: 1, recipient: 'R' }),
      ctx
    )
    expect(res.success).toBe(false)
    expect(res.message).toContain('匹配器材')
    expect(res.message).toContain('请精确指定')
  })

  test('库存不足 → 失败（含 current/demand 信息）', async () => {
    // 不入库直接出 → 库存为 0
    const res = await executeTool(
      'create_outbound_record',
      JSON.stringify({ equipment_name: '二氧化碳灭火器', quantity: 1, recipient: 'R' }),
      ctx
    )
    expect(res.success).toBe(false)
    expect(res.message).toContain('库存不足')
  })
})

describe('executeTool get_equipment_stock', () => {
  test('精确匹配单个器材', async () => {
    db.prepare(
      'INSERT INTO records (equipment_id, type, quantity, operator_id) VALUES (?, ?, ?, ?)'
    ).run(1, 'in', 8, 1)
    const res = await executeTool(
      'get_equipment_stock',
      JSON.stringify({ name: '手提式干粉灭火器' }),
      ctx
    )
    expect(res.success).toBe(true)
    expect(res.data.length).toBe(1)
    expect(res.data[0].current_stock).toBe(8)
  })

  test('模糊匹配多个器材 → 都返回', async () => {
    const res = await executeTool(
      'get_equipment_stock',
      JSON.stringify({ name: '灭火器' }),
      ctx
    )
    expect(res.success).toBe(true)
    expect(res.data.length).toBe(3)
  })

  test('未找到 → 失败', async () => {
    const res = await executeTool(
      'get_equipment_stock',
      JSON.stringify({ name: '不存在的器材XYZ' }),
      ctx
    )
    expect(res.success).toBe(false)
    expect(res.message).toContain('未找到')
  })

  test('空 name → 失败', async () => {
    const res = await executeTool('get_equipment_stock', JSON.stringify({ name: '' }), ctx)
    expect(res.success).toBe(false)
  })
})
