process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import type { Application } from 'express'
import type { SuperTest, Test } from 'supertest'

// 必须先 migrate 再加载 app：
// log.service.ts 模块加载时调 ensureLogsColumns 执行 ALTER TABLE logs，
// 若 logs 表不存在会抛 SqliteError，导致 app 模块加载失败。
// TypeScript 的 import 会被 hoist，所以用 require 控制加载顺序。
const { runMigrations } = require('../src/db/migrate')
runMigrations()

const app: Application = require('../src/app').default
const request: (app: Application) => SuperTest<Test> = require('supertest')

describe('GET /api/health', () => {
  test('返回 200 状态码', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
  })

  test('返回 code:0', async () => {
    const res = await request(app).get('/api/health')
    expect(res.body.code).toBe(0)
  })

  test('返回 message:"ok"', async () => {
    const res = await request(app).get('/api/health')
    expect(res.body.message).toBe('ok')
  })

  test('data.status 为 "up"', async () => {
    const res = await request(app).get('/api/health')
    expect(res.body.data.status).toBe('up')
  })

  test('data.time 为合法 ISO 字符串', async () => {
    const res = await request(app).get('/api/health')
    expect(typeof res.body.data.time).toBe('string')
    expect(Number.isNaN(Date.parse(res.body.data.time))).toBe(false)
  })

  test('无需 Authorization 头即可访问', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
  })

  test('响应结构包含 code/message/data 三字段', async () => {
    const res = await request(app).get('/api/health')
    expect(res.body).toHaveProperty('code')
    expect(res.body).toHaveProperty('message')
    expect(res.body).toHaveProperty('data')
  })

  test('POST 方法不被支持（404 或 405）', async () => {
    const res = await request(app).post('/api/health')
    expect([404, 405]).toContain(res.status)
  })
})