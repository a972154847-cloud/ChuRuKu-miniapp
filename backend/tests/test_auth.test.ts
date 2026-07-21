process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import request from 'supertest'
import app from '../src/app'
import { resetDatabase } from '../src/db/seed'
import db from '../src/db'

beforeEach(() => {
  resetDatabase()
})

describe('权限管理', () => {
  test('dev-login 首个用户为 admin', async () => {
    const res = await request(app).post('/api/auth/dev-login?override=true').send({})
    expect(res.status).toBe(200)
    expect(res.body.data.user.role).toBe('admin')
    expect(res.body.data.token).toBeTruthy()
  })

  test('dev-login 第二个用户为 viewer', async () => {
    await request(app).post('/api/auth/dev-login?override=true').send({})
    const res = await request(app)
      .post('/api/auth/dev-login?override=true')
      .send({ openid: 'user2', name: 'User2' })
    expect(res.body.data.user.role).toBe('viewer')
  })

  test('GET /me 携带 token 返回当前用户', async () => {
    const login = await request(app).post('/api/auth/dev-login?override=true').send({})
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${login.body.data.token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('开发者')
  })

  test('无 token 访问 /me 返回 401', async () => {
    const res = await request(app).get('/api/users/me')
    expect(res.status).toBe(401)
  })

  test('viewer 访问 GET /users 返回 403', async () => {
    await request(app).post('/api/auth/dev-login?override=true').send({}) // admin
    const viewer = await request(app)
      .post('/api/auth/dev-login?override=true')
      .send({ openid: 'v1', name: 'Viewer' })
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${viewer.body.data.token}`)
    expect(res.status).toBe(403)
  })

  test('admin 访问 GET /users 返回 200', async () => {
    const admin = await request(app).post('/api/auth/dev-login?override=true').send({})
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${admin.body.data.token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThan(0)
  })

  test('admin 修改用户角色成功，写入 logs', async () => {
    const admin = await request(app).post('/api/auth/dev-login?override=true').send({})
    const viewer = await request(app)
      .post('/api/auth/dev-login?override=true')
      .send({ openid: 'v1', name: 'Viewer' })
    const viewerId = viewer.body.data.user.id
    const res = await request(app)
      .patch(`/api/users/${viewerId}/role`)
      .set('Authorization', `Bearer ${admin.body.data.token}`)
      .send({ role: 'editor' })
    expect(res.status).toBe(200)
    expect(res.body.data.role).toBe('editor')
    // 验证 logs 表
    const logs = db.prepare('SELECT * FROM logs WHERE action = ?').all('role.change') as Array<{
      action: string
    }>
    expect(logs.length).toBeGreaterThan(0)
  })

  test('admin 不能修改自己的角色', async () => {
    const admin = await request(app).post('/api/auth/dev-login?override=true').send({})
    const adminId = admin.body.data.user.id
    const res = await request(app)
      .patch(`/api/users/${adminId}/role`)
      .set('Authorization', `Bearer ${admin.body.data.token}`)
      .send({ role: 'viewer' })
    expect(res.status).toBe(403)
  })

  test('PATCH role 非法值返回 400', async () => {
    const admin = await request(app).post('/api/auth/dev-login?override=true').send({})
    const viewer = await request(app).post('/api/auth/dev-login?override=true').send({ openid: 'v1' })
    const res = await request(app)
      .patch(`/api/users/${viewer.body.data.user.id}/role`)
      .set('Authorization', `Bearer ${admin.body.data.token}`)
      .send({ role: 'superadmin' })
    expect(res.status).toBe(400)
  })
})
