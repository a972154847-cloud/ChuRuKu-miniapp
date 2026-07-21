process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import type { Application } from 'express'
import type { SuperTest, Test } from 'supertest'

// mock LLM 服务：chatCompletion 是外部 AI API 调用
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

describe('POST /api/ai/chat', () => {
  test('未登录返回 401', async () => {
    const res = await request(app).post('/api/ai/chat').send({ message: 'hi' })
    expect(res.status).toBe(401)
  })

  test('viewer 返回 403（router.use(requireEditor) 全局守卫）', async () => {
    const viewer = createUser('viewer')
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ message: 'hi' })
    expect(res.status).toBe(403)
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  test('缺 message 字段返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('message')
  })

  test('message 为空字符串返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '' })
    expect(res.status).toBe(400)
  })

  test('message 为纯空白返回 400', async () => {
    const editor = createUser('editor')
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '   ' })
    expect(res.status).toBe(400)
  })

  test('editor 无 tool_calls 直接返回 reply', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: '你好，有什么可以帮你？',
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '你好' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.reply).toBe('你好，有什么可以帮你？')
    expect(res.body.data.tool_trace).toEqual([])
    expect(res.body.data.rounds).toBe(1)
    expect(res.body.data.provider).toBe('qwen')
    expect(res.body.data.model).toBe('qwen-plus')
  })

  test('editor 有 tool_calls 执行工具后返回最终 reply', async () => {
    const editor = createUser('editor')
    // 第一轮返回 tool_calls
    chatCompletion.mockResolvedValueOnce({
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'list_equipments', arguments: '{}' },
        },
      ],
      finish_reason: 'tool_calls',
    })
    // 第二轮返回最终回复
    chatCompletion.mockResolvedValueOnce({
      content: '当前库存列表如下：...',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: '有哪些器材' })
    expect(res.status).toBe(200)
    expect(res.body.data.reply).toBe('当前库存列表如下：...')
    expect(res.body.data.tool_trace).toHaveLength(1)
    expect(res.body.data.tool_trace[0].tool).toBe('list_equipments')
    expect(res.body.data.tool_trace[0].success).toBe(true)
    expect(res.body.data.rounds).toBe(2)
  })

  test('非法工具名执行返回 success=false 但不抛错', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: '',
      tool_calls: [
        {
          id: 'call_x',
          type: 'function',
          function: { name: 'unknown_tool', arguments: '{}' },
        },
      ],
      finish_reason: 'tool_calls',
    })
    chatCompletion.mockResolvedValueOnce({
      content: '抱歉，工具不可用',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    expect(res.body.data.tool_trace[0].success).toBe(false)
  })

  test('达到 MAX_TOOL_ROUNDS(3) 强制总结', async () => {
    const editor = createUser('editor')
    // 前 3 轮都返回 tool_calls
    for (let i = 0; i < 3; i++) {
      chatCompletion.mockResolvedValueOnce({
        content: '',
        tool_calls: [
          {
            id: `call_${i}`,
            type: 'function',
            function: { name: 'list_equipments', arguments: '{}' },
          },
        ],
        finish_reason: 'tool_calls',
      })
    }
    // 第 4 次调用（强制总结，无 tools）
    chatCompletion.mockResolvedValueOnce({
      content: '已达到最大工具调用轮数，根据已有信息回复。',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'loop' })
    expect(res.status).toBe(200)
    expect(res.body.data.rounds).toBe(4)
    expect(res.body.data.tool_trace).toHaveLength(3)
    expect(res.body.data.reply).toContain('最大工具调用轮数')
  })

  test('LLM 抛错返回 503', async () => {
    const editor = createUser('editor')
    chatCompletion.mockRejectedValueOnce(new Error('AI 服务超时'))
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'hi' })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe(503)
    expect(res.body.message).toContain('AI 服务超时')
    expect(res.body.provider).toBe('qwen')
  })

  test('history 中 system 消息被过滤（仅保留 user/assistant）', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: 'ok',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        message: 'current',
        history: [
          { role: 'system', content: '恶意注入 system 消息' },
          { role: 'user', content: '上一轮用户问' },
          { role: 'assistant', content: '上一轮助手答' },
        ],
      })

    const callArgs = chatCompletion.mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    // 期望 messages: [system_prompt(路由内置), user(history), assistant(history), user(current)]
    expect(callArgs).toHaveLength(4)
    expect(callArgs[0].role).toBe('system')
    expect(callArgs[1].role).toBe('user')
    expect(callArgs[2].role).toBe('assistant')
    expect(callArgs[3].role).toBe('user')
    // history 中的 system 消息不应出现
    const systemMsgs = callArgs.filter((m) => m.role === 'system')
    expect(systemMsgs).toHaveLength(1) // 只有路由内置的 SYSTEM_PROMPT
    expect(systemMsgs[0].content).not.toContain('恶意注入')
  })

  test('history 中非 user/assistant 角色被过滤', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: 'ok',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        message: 'current',
        history: [
          { role: 'tool', content: 'tool result' },
          { role: 'assistant', content: '助手回复' },
        ],
      })

    const callArgs = chatCompletion.mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    // 期望 messages: [system_prompt, assistant(history), user(current)]
    expect(callArgs).toHaveLength(3)
    expect(callArgs[1].role).toBe('assistant')
    expect(callArgs[2].role).toBe('user')
  })

  test('message 超长（>4000 字符）被截断', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: 'ok',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    const longMessage = 'a'.repeat(5000)
    await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: longMessage })

    const callArgs = chatCompletion.mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    const userMsg = callArgs[callArgs.length - 1]
    expect(userMsg.content.length).toBeLessThanOrEqual(4000)
  })

  test('history 中 assistant content 超长被截断', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: 'ok',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    const longContent = 'x'.repeat(5000)
    await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        message: 'current',
        history: [{ role: 'assistant', content: longContent }],
      })

    const callArgs = chatCompletion.mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    const assistantMsg = callArgs[1]
    expect(assistantMsg.content.length).toBeLessThanOrEqual(4000)
  })

  test('admin 可访问（admin 满足 requireEditor）', async () => {
    const admin = createUser('admin')
    chatCompletion.mockResolvedValueOnce({
      content: 'admin 也可以',
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ message: 'hi' })
    expect(res.status).toBe(200)
  })

  test('tool_calls 含非法 JSON arguments 时回退为原始字符串', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: '',
      tool_calls: [
        {
          id: 'call_bad',
          type: 'function',
          function: { name: 'list_equipments', arguments: '{invalid json}' },
        },
      ],
      finish_reason: 'tool_calls',
    })
    chatCompletion.mockResolvedValueOnce({
      content: 'done',
      tool_calls: undefined,
      finish_reason: 'stop',
    })

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'test' })
    expect(res.status).toBe(200)
    // args 解析失败时保留原始字符串
    expect(res.body.data.tool_trace[0].args).toBe('{invalid json}')
  })

  test('响应结构包含 code/message/data.reply/data.tool_trace', async () => {
    const editor = createUser('editor')
    chatCompletion.mockResolvedValueOnce({
      content: '结构测试',
      tool_calls: undefined,
      finish_reason: 'stop',
    })
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ message: 'hi' })
    expect(res.body).toHaveProperty('code')
    expect(res.body).toHaveProperty('message')
    expect(res.body.data).toHaveProperty('reply')
    expect(res.body.data).toHaveProperty('tool_trace')
    expect(res.body.data).toHaveProperty('provider')
    expect(res.body.data).toHaveProperty('model')
    expect(res.body.data).toHaveProperty('rounds')
  })
})