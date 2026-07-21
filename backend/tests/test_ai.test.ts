process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import { resetDatabase } from '../src/db/seed'

let editorToken: string
let viewerToken: string

beforeEach(async () => {
  resetDatabase()
  // 先登录一个 admin 占位（dev-login 首用户强制 admin），让后续 editor/viewer 角色生效
  await request(app).post('/api/auth/dev-login?override=true').send({})
  const editor = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'e1', name: 'Editor', role: 'editor' })
  editorToken = editor.body.data.token
  const viewer = await request(app)
    .post('/api/auth/dev-login?override=true')
    .send({ openid: 'v1', name: 'Viewer', role: 'viewer' })
  viewerToken = viewer.body.data.token
})

describe('AI 图片识别与反向查找', () => {
  test('POST /describe-image 无 API Key 返回 503 + fallback_hint: semantic', async () => {
    const res = await request(app)
      .post('/api/ai/describe-image')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ image_url: 'https://example.com/test.jpg' })
    expect(res.status).toBe(503)
    expect(res.body.fallback_hint).toBe('semantic')
  })

  test('POST /match-equipment 无 API Key 返回 503', async () => {
    const res = await request(app)
      .post('/api/ai/match-equipment')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ description: '红色灭火器' })
    expect(res.status).toBe(503)
    expect(res.body.fallback_hint).toBe('semantic')
  })

  test('POST /semantic-search 无模型时返回 503 + fallback_hint: text', async () => {
    const res = await request(app)
      .post('/api/ai/semantic-search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ query: '灭火器' })
    expect(res.status).toBe(503)
    expect(res.body.fallback_hint).toBe('text')
  })

  test('POST /text-search 搜"干粉"返回非空', async () => {
    const res = await request(app)
      .post('/api/ai/text-search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '干粉' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.matches)).toBe(true)
    expect(res.body.data.matches.length).toBeGreaterThan(0)
    // 干粉灭火器名字应包含"干粉"
    expect(res.body.data.matches[0].name).toContain('干粉')
  })

  test('POST /text-search 空关键字返回空列表', async () => {
    const res = await request(app)
      .post('/api/ai/text-search')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ keyword: '' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.matches)).toBe(true)
    expect(res.body.data.matches.length).toBe(0)
  })

  test('POST /recognize 带 query 走到 text 阶段', async () => {
    const res = await request(app)
      .post('/api/ai/recognize')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ query: '干粉' })
    expect(res.status).toBe(200)
    expect(res.body.data.stage).toBe('text')
    expect(Array.isArray(res.body.data.matches)).toBe(true)
    expect(res.body.data.matches.length).toBeGreaterThan(0)
  })

  test('viewer 访问 AI 端点返回 403', async () => {
    const res = await request(app)
      .post('/api/ai/text-search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ keyword: '干粉' })
    expect(res.status).toBe(403)
  })
})
