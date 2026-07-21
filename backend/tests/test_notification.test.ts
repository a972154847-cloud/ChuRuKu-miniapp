process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import {
  sendWxSubscribeMessage,
  notifyRecordEvent,
  listNotifyOpenids,
} from '../src/services/notification.service'
import { resetDatabase } from '../src/db/seed'
import { createRecord } from '../src/services/record.service'
import db from '../src/db'

beforeEach(() => {
  resetDatabase()
  // 造 admin + editor + viewer 用户，验证只通知 admin/editor
  db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
    'admin-openid',
    'Admin',
    'admin'
  )
  db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
    'editor-openid',
    'Editor',
    'editor'
  )
  db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
    'viewer-openid',
    'Viewer',
    'viewer'
  )
})

describe('通知服务（F7）- 微信配置未启用时降级', () => {
  test('sendWxSubscribeMessage 未配置模板时跳过不抛错', async () => {
    await expect(
      sendWxSubscribeMessage('record_event', 'any-openid', {
        thing1: { value: '入库' },
      })
    ).resolves.toBeUndefined()
  })

  test('notifyRecordEvent 未配置时不抛错', async () => {
    await expect(
      notifyRecordEvent({
        type: 'in',
        equipment_name: '手提式干粉灭火器',
        quantity: 2,
        operator_name: 'Tester',
      })
    ).resolves.toBeUndefined()
  })

  test('listNotifyOpenids 返回 admin + editor 的 openid，不含 viewer', () => {
    const openids = listNotifyOpenids()
    expect(openids).toContain('admin-openid')
    expect(openids).toContain('editor-openid')
    expect(openids).not.toContain('viewer-openid')
  })

  test('createRecord 触发异步通知钩子但不阻塞、不抛错', () => {
    const eqName = (
      db.prepare('SELECT name FROM equipments LIMIT 1').get() as { name: string }
    ).name
    const opId = (
      db
        .prepare("SELECT id FROM users WHERE openid = 'editor-openid'")
        .get() as { id: number }
    ).id
    expect(() =>
      createRecord(
        { equipment_name: eqName, type: 'in', quantity: 3 },
        opId
      )
    ).not.toThrow()
    const log = db
      .prepare("SELECT * FROM logs WHERE action = 'record.create'")
      .get()
    expect(log).toBeTruthy()
  })
})
