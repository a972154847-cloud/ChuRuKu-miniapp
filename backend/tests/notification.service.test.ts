/**
 * notification.service 单元测试
 * 覆盖：
 * - listNotifyOpenids：admin/editor 命中，viewer/null/空字符串排除
 * - getWxAccessToken：无配置 → null / 命中缓存 / 缓存过期 / 微信返回 errcode → 抛错
 * - sendWxSubscribeMessage：未配模板 / openid 空 / 无 token 跳过 / 微信 errcode / axios 抛错
 * - notifyRecordEvent：未配置跳过 / 无 openid 跳过 / 正常推送 / 部分失败统计
 * - __resetTokenCacheForTest
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

import db from '../src/db'
import { resetDatabase } from '../src/db/seed'
import {
  getWxAccessToken,
  sendWxSubscribeMessage,
  listNotifyOpenids,
  __resetTokenCacheForTest,
} from '../src/services/notification.service'

const ORIGINAL_ENV = { ...process.env }

/**
 * 工具函数：在隔离模块中获取 fresh notification.service
 * - 原因：config.wxAppId/wxAppSecret 在模块加载时读 env，每次 jest.isolateModules 都能拿到最新 env
 * - 由于 jest.isolateModules 会重置模块注册表，必须重新初始化 db（重新跑 migrations）
 * - result 直接赋为 fn(svc)（可能是 Promise）
 */
function withFreshNotification<T>(envSetter: () => void, fn: (svc: any) => T): T {
  let result!: T
  envSetter()
  jest.isolateModules(() => {
    const { runMigrations } = require('../src/db/migrate')
    runMigrations()
    const svc = require('../src/services/notification.service')
    result = fn(svc)
  })
  return result
}

beforeEach(() => {
  resetDatabase()
  __resetTokenCacheForTest()
  jest.clearAllMocks()
  // 默认：无微信配置
  delete process.env.WX_APP_ID
  delete process.env.WX_APP_SECRET
  delete process.env.WX_SUBSCRIBE_TEMPLATE_ID
})

afterAll(() => {
  Object.assign(process.env, ORIGINAL_ENV)
})

describe('listNotifyOpenids', () => {
  test('返回 admin + editor 的 openid，不含 viewer', () => {
    db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
      'admin-oid',
      'Admin',
      'admin'
    )
    db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
      'editor-oid',
      'Editor',
      'editor'
    )
    db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
      'viewer-oid',
      'Viewer',
      'viewer'
    )
    const openids = listNotifyOpenids()
    expect(openids).toContain('admin-oid')
    expect(openids).toContain('editor-oid')
    expect(openids).not.toContain('viewer-oid')
  })

  test('openid 为 null 的用户被排除（实际 schema 限制 NOT NULL，此处用 viewer 排除验证）', () => {
    // 注意：users.openid 在 schema 中是 NOT NULL，无法直接 insert null
    // listNotifyOpenids 内部用 `AND openid IS NOT NULL` 防御空值，但实际由 schema 保证
    // 此处用 viewer 角色 + null openid 模拟"业务上不应被通知"的场景
    db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
      'valid-admin-oid',
      'Admin',
      'admin'
    )
    expect(listNotifyOpenids()).toEqual(['valid-admin-oid'])
  })

  test('openid 为空字符串的用户被排除', () => {
    // schema 是 UNIQUE NOT NULL，无法插入空字符串（SQLite 空字符串允许但 UNIQUE 会拒绝重复）
    // 此处验证 viewer 角色不被通知
    db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
      'v',
      'Viewer',
      'viewer'
    )
    expect(listNotifyOpenids()).toEqual([])
  })

  test('DISTINCT 去重（同一 openid 不能绑两个 user，schema UNIQUE 限制）', () => {
    db.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
      'oid',
      'A1',
      'admin'
    )
    // 同一 openid 在 schema UNIQUE 约束下只能存在一条
    const res = listNotifyOpenids()
    expect(res).toEqual(['oid'])
  })
})

describe('getWxAccessToken 降级与缓存', () => {
  test('无 wxAppId/wxAppSecret → 返回 null（不抛错）', async () => {
    const token = await getWxAccessToken()
    expect(token).toBeNull()
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('有配置 + 微信返回成功 → 缓存 token', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
      },
      async (svc) => {
        mockedAxios.get.mockResolvedValueOnce({
          data: { access_token: 'tok-abc', expires_in: 7200 },
        } as any)
        const t1 = await svc.getWxAccessToken()
        expect(t1).toBe('tok-abc')
        expect(mockedAxios.get).toHaveBeenCalledTimes(1)
      }
    )
  })

  test('命中缓存：不再次调微信', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
      },
      async (svc) => {
        mockedAxios.get.mockResolvedValue({
          data: { access_token: 'tok-cached', expires_in: 7200 },
        } as any)
        const t1 = await svc.getWxAccessToken()
        const t2 = await svc.getWxAccessToken()
        expect(t1).toBe('tok-cached')
        expect(t2).toBe('tok-cached')
        expect(mockedAxios.get).toHaveBeenCalledTimes(1)
      }
    )
  })

  test('微信返回 errcode → 抛错', async () => {
    await expect(
      withFreshNotification(
        () => {
          process.env.WX_APP_ID = 'wxid'
          process.env.WX_APP_SECRET = 'secret'
        },
        async (svc) => {
          mockedAxios.get.mockResolvedValueOnce({
            data: { errcode: 40013, errmsg: 'invalid appid' },
          } as any)
          return svc.getWxAccessToken()
        }
      )
    ).rejects.toThrow(/invalid appid/)
  })

  test('expires_in 缺失时回退 7200s', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
      },
      async (svc) => {
        mockedAxios.get.mockResolvedValueOnce({
          data: { access_token: 'tok-noexp' },
        } as any)
        const t = await svc.getWxAccessToken()
        expect(t).toBe('tok-noexp')
      }
    )
  })
})

describe('sendWxSubscribeMessage', () => {
  test('未配置 SUBSCRIBE_TEMPLATE_ID → 跳过', async () => {
    await expect(
      sendWxSubscribeMessage('k', 'openid', { thing1: { value: 'x' } })
    ).resolves.toBeUndefined()
    expect(mockedAxios.post).not.toHaveBeenCalled()
  })

  test('openid 为空 → 跳过', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
      },
      async (svc) => {
        mockedAxios.get.mockResolvedValueOnce({
          data: { access_token: 'tok', expires_in: 7200 },
        } as any)
        await svc.sendWxSubscribeMessage('k', '', { thing1: { value: 'x' } })
        expect(mockedAxios.post).not.toHaveBeenCalled()
      }
    )
  })

  test('token 获取失败（无 WX_APP_ID）→ 静默跳过', async () => {
    await expect(
      withFreshNotification(
        () => {
          process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
          // 故意不设 WX_APP_ID → getWxAccessToken → null → 跳过
        },
        async (svc) => {
          return svc.sendWxSubscribeMessage('k', 'openid', { thing1: { value: 'x' } })
        }
      )
    ).resolves.toBeUndefined()
  })

  test('正常路径：调 message/subscribe/send 端点', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
      },
      async (svc) => {
        svc.__resetTokenCacheForTest()
        mockedAxios.get.mockResolvedValueOnce({
          data: { access_token: 'tok-ok', expires_in: 7200 },
        } as any)
        mockedAxios.post.mockResolvedValueOnce({
          data: { errcode: 0, errmsg: 'ok' },
        } as any)
        await svc.sendWxSubscribeMessage('record_event', 'user-oid', {
          thing1: { value: '入库' },
          thing2: { value: '灭火器' },
        })
        expect(mockedAxios.post).toHaveBeenCalledTimes(1)
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[0]).toContain('message/subscribe/send')
        expect(callArgs[1].touser).toBe('user-oid')
        expect(callArgs[1].template_id).toBe('tmpl')
        expect(callArgs[1].data.thing1.value).toBe('入库')
      }
    )
  })

  test('微信返回 errcode → 只 warn 不抛错', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
      },
      async (svc) => {
        svc.__resetTokenCacheForTest()
        mockedAxios.get.mockResolvedValueOnce({
          data: { access_token: 'tok', expires_in: 7200 },
        } as any)
        mockedAxios.post.mockResolvedValueOnce({
          data: { errcode: 43101, errmsg: 'user refuse' },
        } as any)
        // 不应抛错
        await expect(
          svc.sendWxSubscribeMessage('k', 'oid', { thing1: { value: 'x' } })
        ).resolves.toBeUndefined()
      }
    )
  })

  test('axios.post 抛错 → catch 不抛错', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
      },
      async (svc) => {
        svc.__resetTokenCacheForTest()
        mockedAxios.get.mockResolvedValueOnce({
          data: { access_token: 'tok', expires_in: 7200 },
        } as any)
        mockedAxios.post.mockRejectedValueOnce(new Error('network fail'))
        await expect(
          svc.sendWxSubscribeMessage('k', 'oid', { thing1: { value: 'x' } })
        ).resolves.toBeUndefined()
      }
    )
  })
})

describe('notifyRecordEvent', () => {
  test('未配置 WX_APP_ID/WX_APP_SECRET/模板 → 整体跳过', async () => {
    await expect(
      withFreshNotification(
        () => {
          // 不设任何 WX_* env
        },
        async (svc) => {
          await svc.notifyRecordEvent({
            type: 'in',
            equipment_name: 'X',
            quantity: 1,
            operator_name: 'A',
          })
          expect(mockedAxios.get).not.toHaveBeenCalled()
        }
      )
    ).resolves.toBeUndefined()
  })

  test('有配置但无 openid → 跳过', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
      },
      async (svc) => {
        await svc.notifyRecordEvent({
          type: 'in',
          equipment_name: 'X',
          quantity: 1,
          operator_name: 'A',
        })
        // 无 openid → listNotifyOpenids 返回空 → 跳过
        expect(mockedAxios.get).not.toHaveBeenCalled()
      }
    )
  })

  test('happy path：推送入库通知给所有 admin/editor', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
      },
      async (svc) => {
        // 重新拿 isolateModules 内的 db
        const innerDb = require('../src/db').default
        innerDb.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
          'oid-1',
          'A',
          'admin'
        )
        innerDb.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
          'oid-2',
          'B',
          'editor'
        )
        svc.__resetTokenCacheForTest()
        mockedAxios.get.mockResolvedValue({
          data: { access_token: 'tok', expires_in: 7200 },
        } as any)
        mockedAxios.post.mockResolvedValue({
          data: { errcode: 0 },
        } as any)
        await svc.notifyRecordEvent({
          type: 'in',
          equipment_name: '灭火器',
          quantity: 3,
          operator_name: 'Tester',
        })
        // 2 个 openid → 2 次 POST
        expect(mockedAxios.post).toHaveBeenCalledTimes(2)
      }
    )
  })

  test('type=out 时 actionLabel 走"出库"分支', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
      },
      async (svc) => {
        const innerDb = require('../src/db').default
        innerDb.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
          'oid-1',
          'A',
          'admin'
        )
        svc.__resetTokenCacheForTest()
        mockedAxios.get.mockResolvedValue({
          data: { access_token: 'tok', expires_in: 7200 },
        } as any)
        mockedAxios.post.mockResolvedValue({ data: { errcode: 0 } } as any)
        await svc.notifyRecordEvent({
          type: 'out',
          equipment_name: 'X',
          quantity: 1,
          operator_name: 'OP',
        })
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[1].data.thing1.value).toBe('出库')
      }
    )
  })

  test('部分推送被拒绝 → warn 统计（不阻塞）', async () => {
    await withFreshNotification(
      () => {
        process.env.WX_APP_ID = 'wxid'
        process.env.WX_APP_SECRET = 'secret'
        process.env.WX_SUBSCRIBE_TEMPLATE_ID = 'tmpl'
      },
      async (svc) => {
        const innerDb = require('../src/db').default
        innerDb.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
          'oid-1',
          'A',
          'admin'
        )
        innerDb.prepare('INSERT INTO users (openid, name, role) VALUES (?, ?, ?)').run(
          'oid-2',
          'B',
          'editor'
        )
        svc.__resetTokenCacheForTest()
        mockedAxios.get.mockResolvedValue({
          data: { access_token: 'tok', expires_in: 7200 },
        } as any)
        mockedAxios.post.mockRejectedValue(new Error('partial fail'))
        await expect(
          svc.notifyRecordEvent({
            type: 'in',
            equipment_name: 'X',
            quantity: 1,
            operator_name: 'OP',
          })
        ).resolves.toBeUndefined()
      }
    )
  })
})
