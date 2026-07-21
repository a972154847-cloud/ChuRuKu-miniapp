/**
 * ai.service 单元测试
 * 覆盖：
 * - hashImage SHA256
 * - isUrl / isPrivateIp / validateImageUrl 全分支
 * - extractJson 各种 AI 返回格式（empty / code block / 裸 JSON / 解析失败）
 * - describeImage（无 apiKey / 非 URL / 内网 IP / 缓存命中）
 * - matchEquipment（无 apiKey / 非数组返回 → []）
 * - listAllEquipments / textSearch
 * - _clearImageCache
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

// 必须在 mock 之后 import
import {
  hashImage,
  listAllEquipments,
  textSearch,
  _clearImageCache,
} from '../src/services/ai.service'
import db from '../src/db'
import { resetDatabase } from '../src/db/seed'

/**
 * 工具函数：在隔离模块中获取 fresh ai.service
 * - 原因：config 在模块加载时读 env，每次 jest.isolateModules 都能拿到最新 env
 * - 适用于：API_KEY / NODE_ENV / LLM_IMAGE_ALLOWED_DOMAINS 等影响 config 的测试
 * - 与 llm.service.test.ts 中 withFreshModule 同样模式：result 直接赋为 fn(svc)（可能是 Promise）
 * - 由于 jest.isolateModules 会重置模块注册表，必须同时重新初始化 db（重新跑 migrations）
 *   否则 ai.service 引用的 db 是个新连接，:memory: 模式下没有表
 */
function withFreshAiService<T>(envSetter: () => void, fn: (svc: any) => T): T {
  let result!: T
  envSetter()
  jest.isolateModules(() => {
    // 重新初始化 db（:memory: 模式每次 new Database 都是新连接）
    const { runMigrations } = require('../src/db/migrate')
    runMigrations()
    // 重新 require ai.service，让它用刚初始化的 db
    const svc = require('../src/services/ai.service')
    result = fn(svc)
  })
  return result
}

beforeEach(() => {
  resetDatabase()
  // 清空迁移预置的 20 条种子器材
  db.exec('DELETE FROM record_photos')
  db.exec('DELETE FROM records')
  db.exec('DELETE FROM equipments')
  _clearImageCache()
  jest.clearAllMocks()
  // 默认配置：保留顶部已设的 apiKey；个别用例单独 delete 后隔离模块验证"无 apiKey"
  delete process.env.LLM_IMAGE_ALLOWED_DOMAINS
})

describe('hashImage', () => {
  test('计算文件 SHA256', () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const tmpFile = path.join(os.tmpdir(), `hash-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'hello world')
    const hash = hashImage(tmpFile)
    // SHA256('hello world') = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hash).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    )
    fs.unlinkSync(tmpFile)
  })

  test('不同内容产生不同 hash', () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const f1 = path.join(os.tmpdir(), `h1-${Date.now()}.txt`)
    const f2 = path.join(os.tmpdir(), `h2-${Date.now()}.txt`)
    fs.writeFileSync(f1, 'content1')
    fs.writeFileSync(f2, 'content2')
    expect(hashImage(f1)).not.toBe(hashImage(f2))
    fs.unlinkSync(f1)
    fs.unlinkSync(f2)
  })
})

describe('listAllEquipments', () => {
  test('只返回 is_active=1 的器材 + 关联分类名', () => {
    db.prepare('INSERT INTO equipments (name, is_active) VALUES (?, ?)').run('灭火器A', 1)
    db.prepare('INSERT INTO equipments (name, is_active) VALUES (?, ?)').run('灭火器B', 0)
    const list = listAllEquipments()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('灭火器A')
    expect(list[0]).toHaveProperty('category_id')
    expect(list[0]).toHaveProperty('category_name')
  })

  test('空表返回空数组', () => {
    expect(listAllEquipments()).toEqual([])
  })
})

describe('textSearch', () => {
  beforeEach(() => {
    db.prepare('INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)').run(
      '手提式干粉灭火器',
      '4kg',
      1
    )
    db.prepare('INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)').run(
      '推车式干粉灭火器',
      '25kg',
      1
    )
  })

  test('关键字命中 name 字段', () => {
    const res = textSearch('手提')
    expect(res.length).toBe(1)
    expect(res[0].name).toBe('手提式干粉灭火器')
  })

  test('关键字命中 spec 字段', () => {
    const res = textSearch('25kg')
    expect(res.length).toBe(1)
    expect(res[0].spec).toBe('25kg')
  })

  test('空关键字 → 空数组', () => {
    expect(textSearch('')).toEqual([])
  })

  test('纯空白 → 空数组', () => {
    expect(textSearch('   ')).toEqual([])
  })

  test('无匹配 → 空数组', () => {
    expect(textSearch('不存在的关键字')).toEqual([])
  })
})

describe('describeImage', () => {
  test('无 apiKey → 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          // 删除 AI_API_KEY → config.ai.apiKey 为空
          delete process.env.AI_API_KEY
        },
        async (svc) => svc.describeImage('https://example.com/a.jpg')
      )
    ).rejects.toThrow(/apiKey/)
  })

  test('非 URL 输入（本地文件路径）→ 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('/local/path/to/image.jpg')
      )
    ).rejects.toThrow(/只接受 http\(s\) URL/)
  })

  test('非 http(s) 协议（ftp）→ 抛错（isUrl 检查）', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('ftp://example.com/a.jpg')
      )
    ).rejects.toThrow(/只接受 http\(s\) URL/)
  })

  test('内网 IP（10.0.0.1）→ 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://10.0.0.1/a.jpg')
      )
    ).rejects.toThrow(/内网/)
  })

  test('内网 IP（172.16.0.1）→ 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://172.16.0.1/a.jpg')
      )
    ).rejects.toThrow(/内网/)
  })

  test('内网 IP（172.31.0.1）→ 抛错（边界 172.31）', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://172.31.0.1/a.jpg')
      )
    ).rejects.toThrow(/内网/)
  })

  test('内网 IP（192.168.1.1）→ 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://192.168.1.1/a.jpg')
      )
    ).rejects.toThrow(/内网/)
  })

  test('内网 IP（169.254.169.254 元数据）→ 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://169.254.169.254/latest')
      )
    ).rejects.toThrow(/内网/)
  })

  test('loopback（127.0.0.1）→ 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://127.0.0.1/a.jpg')
      )
    ).rejects.toThrow(/内网/)
  })

  test('0.0.0.0 → 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://0.0.0.0/a.jpg')
      )
    ).rejects.toThrow(/内网/)
  })

  test('IPv6 loopback（::1）→ 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => svc.describeImage('https://[::1]/a.jpg')
      )
    ).rejects.toThrow(/内网/)
  })

  test('http://localhost 在 dev 允许（仅当 NODE_ENV=development）', async () => {
    const res = await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
        process.env.NODE_ENV = 'development'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: '{"type":"x"}' } }] },
        } as any)
        return svc.describeImage('http://localhost:3000/a.jpg')
      }
    )
    expect(res.type).toBe('x')
  })

  test('http://example.com 在 test 环境 → 抛错（强制 https）', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
          process.env.NODE_ENV = 'test'
        },
        async (svc) => svc.describeImage('http://example.com/a.jpg')
      )
    ).rejects.toThrow(/https/)
  })

  test('LLM_IMAGE_ALLOWED_DOMAINS 白名单校验：不在白名单 → 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
          process.env.LLM_IMAGE_ALLOWED_DOMAINS = 'trusted.com,cdn.com'
        },
        async (svc) => svc.describeImage('https://untrusted.com/a.jpg')
      )
    ).rejects.toThrow(/不在.*白名单/)
  })

  test('LLM_IMAGE_ALLOWED_DOMAINS 白名单：域名匹配 → 成功', async () => {
    const res = await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
        process.env.LLM_IMAGE_ALLOWED_DOMAINS = 'trusted.com'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: '{"type":"x","confidence":0.9}' } }] },
        } as any)
        return svc.describeImage('https://trusted.com/a.jpg')
      }
    )
    expect(res.type).toBe('x')
  })

  test('正常 https URL → 调 AI + 解析 JSON', async () => {
    const res = await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"type":"extinguisher","color":"red","material":"metal","suspected_name":"灭火器","confidence":0.9}',
                },
              },
            ],
          },
        } as any)
        return svc.describeImage('https://example.com/a.jpg')
      }
    )
    expect(res.type).toBe('extinguisher')
    expect(res.color).toBe('red')
    expect(res.confidence).toBe(0.9)
  })

  test('LLM 返回 ```json 代码块 → extractJson 提取', async () => {
    const res = await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: '前缀说明\n```json\n{"type":"A","color":"red","material":"x","suspected_name":"y","confidence":0.8}\n```\n后缀',
                },
              },
            ],
          },
        } as any)
        return svc.describeImage('https://example.com/a.jpg')
      }
    )
    expect(res.type).toBe('A')
  })

  test('缓存命中：相同 URL 第二次不调 axios', async () => {
    await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValue({
          data: {
            choices: [{ message: { content: '{"type":"cached","confidence":1}' } }],
          },
        } as any)
        const url = 'https://example.com/cache-test.jpg'
        const r1 = await svc.describeImage(url)
        const r2 = await svc.describeImage(url)
        expect(r1.type).toBe('cached')
        expect(r2.type).toBe('cached')
        expect(mockedAxios.post).toHaveBeenCalledTimes(1)
      }
    )
  })

  test('LLM 返回内容不可解析 JSON → 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'no json at all' } }] },
          } as any)
          return svc.describeImage('https://example.com/x.jpg')
        }
      )
    ).rejects.toThrow(/无可解析 JSON|JSON 解析失败/)
  })

  test('LLM 返回空内容 → 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockResolvedValueOnce({
            data: { choices: [{ message: { content: '' } }] },
          } as any)
          return svc.describeImage('https://example.com/x.jpg')
        }
      )
    ).rejects.toThrow(/为空/)
  })
})

describe('matchEquipment', () => {
  test('无 apiKey → 抛错', async () => {
    await expect(
      withFreshAiService(
        () => {
          // 删除 AI_API_KEY，让 config.ai.apiKey 为空
          delete process.env.AI_API_KEY
        },
        async (svc) => svc.matchEquipment('灭火器')
      )
    ).rejects.toThrow(/apiKey/)
  })

  test('LLM 返回数组 → 返回 matches', async () => {
    const res = await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    { id: 1, name: '灭火器A', confidence: 0.9 },
                    { id: 2, name: '灭火器B', confidence: 0.7 },
                  ]),
                },
              },
            ],
          },
        } as any)
        return svc.matchEquipment('灭火器')
      }
    )
    expect(res).toHaveLength(2)
    expect(res[0].id).toBe(1)
  })

  test('LLM 返回非数组 → 返回 []', async () => {
    const res = await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: '{"not":"array"}' } }] },
        } as any)
        return svc.matchEquipment('x')
      }
    )
    expect(res).toEqual([])
  })

  test('LLM 返回空字符串 → 抛错（extractJson 抛错，matchEquipment 不捕获）', async () => {
    await expect(
      withFreshAiService(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockResolvedValueOnce({
            data: { choices: [{ message: { content: '' } }] },
          } as any)
          return svc.matchEquipment('x')
        }
      )
    ).rejects.toThrow(/为空/)
  })

  test('prompt 包含所有器材清单（listAllEquipments）', async () => {
    await withFreshAiService(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        // 在 isolateModules 上下文内重新初始化 db，所以这里 INSERT 也得在内部
        const { runMigrations } = require('../src/db/migrate')
        runMigrations()
        const innerDb = require('../src/db').default
        innerDb.prepare('INSERT INTO equipments (name, is_active) VALUES (?, ?)').run('AAA器材', 1)
        innerDb.prepare('INSERT INTO equipments (name, is_active) VALUES (?, ?)').run('BBB器材', 1)
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: '[]' } }] },
        } as any)
        await svc.matchEquipment('AAA')
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[1].messages[0].content).toContain('AAA器材')
        expect(callArgs[1].messages[0].content).toContain('BBB器材')
      }
    )
  })
})
