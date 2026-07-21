process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import type { Application } from 'express'
import type { SuperTest, Test } from 'supertest'

// mock LLM 服务：parse-record 不调工具，仅用 LLM 解析自然语言
jest.mock('../src/services/llm.service', () => ({
  __esModule: true,
  chatCompletion: jest.fn(),
  getCurrentProvider: jest.fn(() => 'qwen'),
  getCurrentModel: jest.fn(() => 'qwen-plus'),
}))

const { runMigrations } = require('../src/db/migrate')
runMigrations()

const app = require('../src/app').default as Application
const request = require('supertest') as (app: Application) => SuperTest<Test>
const { resetDatabase } = require('../src/db/seed') as typeof import('../src/db/seed')
const db = require('../src/db').default as typeof import('../src/db').default
const { signToken } = require('../src/middlewares/auth') as typeof import('../src/middlewares/auth')
const { chatCompletion } = require('../src/services/llm.service') as {
  chatCompletion: jest.Mock
}

beforeEach(() => {
  resetDatabase()
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'") } catch (e) { /* status column already exists via 008 migration */ }
  jest.clearAllMocks()
})

// 模块级递增 id：避免 verifyToken 的 userCache（30s TTL）跨测试命中旧用户
// resetDatabase drop 后 AUTOINCREMENT 从 1 重新开始；若用自增 id，viewer -> editor 顺序
// 会让 editor 用户的 id 命中上一个 viewer 测试的缓存，导致 role 被错误判定为 viewer
let _userIdCounter = 1000

function createUser(role: 'admin' | 'editor' | 'viewer', name?: string) {
  const id = ++_userIdCounter
  const openid = `${role}-${id}-${Math.random().toString(36).slice(2, 8)}`
  db.prepare('INSERT INTO users (id, openid, name, role) VALUES (?, ?, ?, ?)').run(
    id,
    openid,
    name || role,
    role
  )
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as {
    id: number
    openid: string
    name: string
    role: string
    status: string
  }
  return { token: signToken(user as any), id: user.id, role, user }
}

describe('POST /api/ai/parse-record', () => {
  test('未登录返回 401', async () => {
    const res = await request(app)
      .post('/api/ai/parse-record')
      .send({ message: '入库 5 个灭火器' })
    expect(res.status).toBe(401)
  })

  test('viewer 返回 403（router.use(requireEditor) 全局）', async () => {
    const viewer = createUser('viewer')
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ message: '入库 5 个灭火器' })
    expect(res.status).toBe(403)
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  test('缺 message 字段返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('message')
  })

  test('message 为空字符串返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '' })
    expect(res.status).toBe(400)
  })

  test('LLM 返回合法入库 JSON，正确解析字段', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'in',
        equipment_name: '手提式干粉灭火器 4kg',
        quantity: 5,
        remark: '一批',
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '入库 5 个手提式干粉灭火器 4kg' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.fields.type).toBe('in')
    expect(res.body.data.fields.equipment_name).toBe('手提式干粉灭火器 4kg')
    expect(res.body.data.fields.quantity).toBe(5)
    expect(res.body.data.fields.remark).toBe('一批')
  })

  test('LLM 返回合法出库 JSON，含 recipient 和 expected_return_at', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'out',
        equipment_name: '灭火器',
        quantity: 2,
        recipient: '张三',
        purpose: '演练',
        expected_return_at: '2026-08-01',
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '出库 2 个灭火器给张三' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.type).toBe('out')
    expect(res.body.data.fields.recipient).toBe('张三')
    expect(res.body.data.fields.purpose).toBe('演练')
    expect(res.body.data.fields.expected_return_at).toBe('2026-08-01')
  })

  test('LLM 返回带 ```json 代码块标记的 JSON，正则提取成功', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: '```json\n{"type":"in","equipment_name":"灭火器","quantity":3}\n```',
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '入库 3 个' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.type).toBe('in')
    expect(res.body.data.fields.quantity).toBe(3)
  })

  test('LLM 返回非 JSON 文本，fields=null', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: '我无法理解你的意思，请明确说明入库或出库操作',
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '今天天气怎么样' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields).toBeNull()
    expect(res.body.data.raw_reply).toContain('我无法理解')
  })

  test('LLM 返回非法 JSON 字符串，fields=null', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: '这不是 JSON {type: in}', // 非合法 JSON
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    // {type: in} 不是合法 JSON（key 无引号，in 无引号），正则提取后 JSON.parse 失败
    expect(res.body.data.fields).toBeNull()
  })

  test('字段白名单清洗：忽略非法字段（如 id, created_at）', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'in',
        equipment_name: '灭火器',
        quantity: 1,
        id: 999, // 非法字段
        created_at: '2026-01-01', // 非法字段
        password: 'hack', // 非法字段
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '入库 1 个' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.id).toBeUndefined()
    expect(res.body.data.fields.created_at).toBeUndefined()
    expect(res.body.data.fields.password).toBeUndefined()
    expect(res.body.data.fields.equipment_name).toBe('灭火器')
  })

  test('type 非法时省略 type 字段', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'invalid',
        equipment_name: '灭火器',
        quantity: 1,
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.type).toBeUndefined()
  })

  test('quantity 非数字时省略 quantity 字段', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'in',
        equipment_name: '灭火器',
        quantity: 'abc',
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.quantity).toBeUndefined()
  })

  test('quantity 为 0 或负数时省略', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'in',
        equipment_name: '灭火器',
        quantity: 0,
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.quantity).toBeUndefined()
  })

  test('quantity 为小数时向下取整', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'in',
        equipment_name: '灭火器',
        quantity: 3.7,
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.quantity).toBe(3)
  })

  test('equipment_name 为空字符串时省略', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'in',
        equipment_name: '   ',
        quantity: 1,
      }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    expect(res.body.data.fields.equipment_name).toBeUndefined()
  })

  test('current_type=in 时 prompt 提示入库', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({ type: 'in', equipment_name: 'x', quantity: 1 }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '5 个灭火器', current_type: 'in' })
    const callArgs = chatCompletion.mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    const userMsg = callArgs.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('入库')
  })

  test('current_type=out 时 prompt 提示出库', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({ type: 'out', equipment_name: 'x', quantity: 1 }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '2 个灭火器', current_type: 'out' })
    const callArgs = chatCompletion.mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    const userMsg = callArgs.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('出库')
  })

  test('current_type 为非法值时被忽略（视为未传）', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({ type: 'in', equipment_name: 'x', quantity: 1 }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '5 个灭火器', current_type: 'invalid' })
    const callArgs = chatCompletion.mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    const userMsg = callArgs.find((m) => m.role === 'user')
    expect(userMsg?.content).not.toContain('当前表单类型')
  })

  test('LLM 抛错返回 503', async () => {
    const editor = createUser('editor')
    chatCompletion.mockRejectedValueOnce(new Error('AI 服务宕机'))
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe(503)
    expect(res.body.message).toContain('AI 服务宕机')
    expect(res.body.provider).toBe('qwen')
  })

  test('admin 可访问（admin 满足 requireEditor）', async () => {
    const admin = createUser('admin')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({ type: 'in', equipment_name: 'x', quantity: 1 }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ message: '入库 1 个' })
    expect(res.status).toBe(200)
  })

  test('响应结构包含 code/message/data.fields/data.raw_reply', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({ type: 'in', equipment_name: 'x', quantity: 1 }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '入库 1 个' })
    expect(res.body).toHaveProperty('code')
    expect(res.body).toHaveProperty('message')
    expect(res.body.data).toHaveProperty('fields')
    expect(res.body.data).toHaveProperty('raw_reply')
  })

  test('不调用任何工具（chatCompletion 第二参数为 undefined）', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({ type: 'in', equipment_name: 'x', quantity: 1 }),
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    await request(app)
      .post('/api/ai/parse-record')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '入库 1 个' })
    // chatCompletion 第二参数是 tools，/parse-record 不传 tools
    const toolsArg = chatCompletion.mock.calls[0][1]
    expect(toolsArg).toBeUndefined()
  })
})