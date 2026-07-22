process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import type { Application } from 'express'
import type { SuperTest, Test } from 'supertest'

// mock axios：wxLogin(code) 调 axios.get 拿 openid
jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  get: jest.fn(),
  post: jest.fn(),
}))

// mock express-rate-limit：绕过 login 5 req/min 与全局 100 req/min
jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { runMigrations } = require('../src/db/migrate')
runMigrations()

const app = require('../src/app').default as Application
const request = require('supertest') as (app: Application) => SuperTest<Test>
const { resetDatabase } = require('../src/db/seed') as typeof import('../src/db/seed')
const db = require('../src/db').default as typeof import('../src/db').default
const axiosDefault = require('axios').default as { get: jest.Mock; post: jest.Mock }

beforeEach(() => {
  resetDatabase()
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'") } catch (e) { /* status column already exists via 008 migration */ }
  jest.clearAllMocks()
})

describe('POST /api/auth/login', () => {
  test('缺少 code 参数返回 400', async () => {
    const res = await request(app).post('/api/auth/login').send({})
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
    expect(res.body.message).toContain('code')
  })

  test('code 为空字符串返回 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ code: '' })
    expect(res.status).toBe(400)
  })

  test('code 为 null 返回 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ code: null })
    expect(res.status).toBe(400)
  })

  test('请求体为空对象返回 400', async () => {
    const res = await request(app).post('/api/auth/login').send()
    expect(res.status).toBe(400)
  })

  test('微信 code2session 网络错误返回 502', async () => {
    axiosDefault.get.mockRejectedValueOnce(new Error('network error'))
    const res = await request(app).post('/api/auth/login').send({ code: 'net_err_code' })
    expect(res.status).toBe(502)
    expect(res.body.code).toBe(502)
    expect(res.body.message).toBe('微信登录失败')
    expect(res.body.detail).toBeUndefined()
  })

  test('微信返回 errcode 时抛错并返回 502', async () => {
    axiosDefault.get.mockResolvedValueOnce({
      data: { errcode: 40029, errmsg: 'invalid code' },
    })
    const res = await request(app).post('/api/auth/login').send({ code: 'bad_code' })
    expect(res.status).toBe(502)
    expect(res.body.message).toBe('微信登录失败')
    expect(res.body.detail).toBeUndefined()
  })

  test('微信接口超时返回 504，提示稍后重试', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
    axiosDefault.get.mockRejectedValueOnce(timeoutError)

    const res = await request(app).post('/api/auth/login').send({ code: 'timeout_code' })

    expect(res.status).toBe(504)
    expect(res.body.code).toBe(504)
    expect(res.body.message).toContain('响应较慢')
  })

  test('首用户登录成功并强制 admin 角色', async () => {
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'first_openid', session_key: 'sk' },
    })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ code: 'first_code', nickname: '首用户' })
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.message).toBe('ok')
    expect(res.body.data.user.role).toBe('admin')
    expect(res.body.data.user.openid).toBe('first_openid')
    expect(res.body.data.user.name).toBe('首用户')
    expect(res.body.data.token).toBeTruthy()
  })

  test('第二个不同 openid 用户登录为 viewer', async () => {
    // 首用户 admin
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'admin_openid', session_key: 'sk' },
    })
    await request(app).post('/api/auth/login').send({ code: 'c1' })

    // 第二个用户 viewer
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'viewer_openid', session_key: 'sk2' },
    })
    const res = await request(app).post('/api/auth/login').send({ code: 'c2' })
    expect(res.status).toBe(200)
    expect(res.body.data.user.role).toBe('viewer')
  })

  test('同一 openid 二次登录保持原角色（admin）', async () => {
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'persist_openid', session_key: 'sk' },
    })
    const r1 = await request(app).post('/api/auth/login').send({ code: 'c1' })
    expect(r1.body.data.user.role).toBe('admin')

    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'persist_openid', session_key: 'sk2' },
    })
    const r2 = await request(app).post('/api/auth/login').send({ code: 'c2' })
    expect(r2.status).toBe(200)
    expect(r2.body.data.user.role).toBe('admin')
    expect(r2.body.data.user.id).toBe(r1.body.data.user.id)
  })

  test('已存在用户登录时更新 nickname 并写 user.login 日志', async () => {
    // 首次登录
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'log_openid', session_key: 'sk' },
    })
    await request(app).post('/api/auth/login').send({ code: 'c1', nickname: '原名' })

    // 二次登录，带新 nickname
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'log_openid', session_key: 'sk2' },
    })
    const r2 = await request(app)
      .post('/api/auth/login')
      .send({ code: 'c2', nickname: '新名' })
    expect(r2.body.data.user.name).toBe('新名')

    const logs = db
      .prepare("SELECT * FROM logs WHERE action = 'user.login'")
      .all() as Array<{ action: string }>
    expect(logs.length).toBeGreaterThan(0)
  })

  test('登录失败写 login_failed 审计日志', async () => {
    axiosDefault.get.mockRejectedValueOnce(new Error('wx api down'))
    await request(app).post('/api/auth/login').send({ code: 'fail_code' })

    const logs = db
      .prepare("SELECT * FROM logs WHERE action = 'login_failed'")
      .all() as Array<{ action: string }>
    expect(logs.length).toBeGreaterThan(0)
  })

  test('首次登录写 user.register 日志', async () => {
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'reg_openid', session_key: 'sk' },
    })
    await request(app).post('/api/auth/login').send({ code: 'c' })

    const logs = db
      .prepare("SELECT * FROM logs WHERE action = 'user.register'")
      .all() as Array<{ action: string }>
    expect(logs.length).toBe(1)
  })

  test('有效 token 可访问受保护端点 /api/users/me', async () => {
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'protected_openid', session_key: 'sk' },
    })
    const loginRes = await request(app).post('/api/auth/login').send({ code: 'c' })
    const token = loginRes.body.data.token

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.openid).toBe('protected_openid')
  })

  test('无效 token 访问受保护端点返回 401', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer invalid.token.here')
    expect(res.status).toBe(401)
  })

  test('无 Authorization 头访问受保护端点返回 401', async () => {
    const res = await request(app).get('/api/users/me')
    expect(res.status).toBe(401)
  })

  test('avatar 字段透传到用户记录', async () => {
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'avatar_openid', session_key: 'sk' },
    })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ code: 'c', avatar: 'https://example.com/a.png' })
    expect(res.body.data.user.avatar).toBe('https://example.com/a.png')
  })

  test('未提供 nickname 时默认用 openid 作为 name', async () => {
    axiosDefault.get.mockResolvedValueOnce({
      data: { openid: 'noname_openid', session_key: 'sk' },
    })
    const res = await request(app).post('/api/auth/login').send({ code: 'c' })
    expect(res.body.data.user.name).toBe('noname_openid')
  })
})
