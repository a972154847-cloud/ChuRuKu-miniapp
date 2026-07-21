/**
 * llm.service 单元测试
 * 覆盖：
 * - 4 个 provider（qwen / deepseek / openai / bigmodel）的 baseUrl + chatModel 默认值
 * - chatCompletion 正常返回（content / tool_calls / finish_reason）
 * - chatCompletion 无 apiKey 抛错
 * - chatCompletion axios 抛错（network / 4xx / 5xx / timeout）
 * - getCurrentProvider / getCurrentModel 默认值与覆盖
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

// 清掉 env 中可能存在的 AI_API_KEY（保证无 apiKey 分支可测）
delete process.env.AI_API_KEY
delete process.env.AI_BASE_URL
delete process.env.AI_CHAT_MODEL
delete process.env.AI_PROVIDER

beforeEach(() => {
  jest.clearAllMocks()
  // 重置 env（避免其它测试干扰）
  delete process.env.AI_API_KEY
  delete process.env.AI_BASE_URL
  delete process.env.AI_CHAT_MODEL
  process.env.AI_PROVIDER = 'qwen'
})

describe('getCurrentProvider / getCurrentModel', () => {
  test('默认 provider 为 qwen', () => {
    delete process.env.AI_PROVIDER
    // 重新 require 获取新 config
    jest.isolateModules(() => {
      const svc = require('../src/services/llm.service')
      expect(svc.getCurrentProvider()).toBe('qwen')
      expect(svc.getCurrentModel()).toBe('qwen-plus')
    })
  })

  test('显式 provider=deepseek 走 deepseek-chat', () => {
    process.env.AI_PROVIDER = 'deepseek'
    jest.isolateModules(() => {
      const svc = require('../src/services/llm.service')
      expect(svc.getCurrentProvider()).toBe('deepseek')
      expect(svc.getCurrentModel()).toBe('deepseek-chat')
    })
  })

  test('显式 provider=openai 走 gpt-4o-mini', () => {
    process.env.AI_PROVIDER = 'openai'
    jest.isolateModules(() => {
      const svc = require('../src/services/llm.service')
      expect(svc.getCurrentProvider()).toBe('openai')
      expect(svc.getCurrentModel()).toBe('gpt-4o-mini')
    })
  })

  test('显式 provider=bigmodel 走 glm-4-flash', () => {
    process.env.AI_PROVIDER = 'bigmodel'
    jest.isolateModules(() => {
      const svc = require('../src/services/llm.service')
      expect(svc.getCurrentProvider()).toBe('bigmodel')
      expect(svc.getCurrentModel()).toBe('glm-4-flash')
    })
  })

  test('AI_CHAT_MODEL 显式覆盖默认 chatModel', () => {
    process.env.AI_PROVIDER = 'qwen'
    process.env.AI_CHAT_MODEL = 'qwen-max'
    jest.isolateModules(() => {
      const svc = require('../src/services/llm.service')
      expect(svc.getCurrentModel()).toBe('qwen-max')
    })
  })

  test('未知 provider 走 qwen 默认', () => {
    process.env.AI_PROVIDER = 'unknown-xyz'
    jest.isolateModules(() => {
      const svc = require('../src/services/llm.service')
      expect(svc.getCurrentProvider()).toBe('unknown-xyz')
      expect(svc.getCurrentModel()).toBe('qwen-plus')
    })
  })
})

/**
 * 工具函数：在隔离模块中获取 fresh chatCompletion
 * - 原因：config 在模块加载时读 env，每次 jest.isolateModules 都能拿到最新 env
 */
function withFreshModule<T>(envSetter: () => void, fn: (svc: any) => T): T {
  let result: T
  envSetter()
  jest.isolateModules(() => {
    const svc = require('../src/services/llm.service')
    result = fn(svc)
  })
  return result!
}

describe('chatCompletion 正常路径', () => {
  test('无 tools 时 body 不含 tools/tool_choice', async () => {
    const result = await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
          },
        } as any)
        return svc.chatCompletion([{ role: 'user', content: 'hi' }])
      }
    )
    expect(result.content).toBe('hi')
    expect(result.finish_reason).toBe('stop')
    const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
    expect(callArgs[1]).not.toHaveProperty('tools')
    expect(callArgs[1].messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(callArgs[1].temperature).toBe(0.3)
  })

  test('有 tools 时 body 注入 tools + tool_choice=auto', async () => {
    const tools = [
      {
        type: 'function',
        function: { name: 't1', description: 'd', parameters: { type: 'object', properties: {} } },
      },
    ]
    const result = await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    { id: 'c1', type: 'function', function: { name: 't1', arguments: '{}' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          },
        } as any)
        return svc.chatCompletion([{ role: 'user', content: 'hi' }], tools)
      }
    )
    expect(result.tool_calls).toHaveLength(1)
    const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
    expect(callArgs[1].tools).toBe(tools)
    expect(callArgs[1].tool_choice).toBe('auto')
  })

  test('空 tools 数组时不注入 tool_choice（视为无 tools）', async () => {
    await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] },
        } as any)
        await svc.chatCompletion([{ role: 'user', content: 'hi' }], [])
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[1]).not.toHaveProperty('tools')
        expect(callArgs[1]).not.toHaveProperty('tool_choice')
      }
    )
  })

  test('Authorization header 含 Bearer token', async () => {
    await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] },
        } as any)
        await svc.chatCompletion([{ role: 'user', content: 'x' }])
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[2].headers.Authorization).toBe('Bearer test-key')
        expect(callArgs[2].headers['Content-Type']).toBe('application/json')
      }
    )
  })

  test('timeout 设置为 18s（4 轮 tool_calls 循环 < 60s 前端 timeout）', async () => {
    await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] },
        } as any)
        await svc.chatCompletion([{ role: 'user', content: 'x' }])
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[2].timeout).toBe(18000)
      }
    )
  })

  test('AI 返回 data.choices 为空 → 抛错', async () => {
    await expect(
      withFreshModule(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockResolvedValueOnce({ data: { choices: [] } } as any)
          return svc.chatCompletion([{ role: 'user', content: 'x' }])
        }
      )
    ).rejects.toThrow(/数据格式异常/)
  })

  test('content 缺失时回退空字符串', async () => {
    const result = await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: {}, finish_reason: 'stop' }] },
        } as any)
        return svc.chatCompletion([{ role: 'user', content: 'x' }])
      }
    )
    expect(result.content).toBe('')
  })
})

describe('chatCompletion 错误处理', () => {
  test('未配置 apiKey → 抛错含 provider 名', async () => {
    await expect(
      withFreshModule(
        () => {
          // 故意不设 AI_API_KEY
        },
        async (svc) => svc.chatCompletion([{ role: 'user', content: 'x' }])
      )
    ).rejects.toThrow(/AI_API_KEY 未配置.*qwen/)
  })

  test('axios 抛错（generic Error）→ 抛出 err.message', async () => {
    await expect(
      withFreshModule(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockRejectedValueOnce(new Error('network fail'))
          return svc.chatCompletion([{ role: 'user', content: 'x' }])
        }
      )
    ).rejects.toThrow('network fail')
  })

  test('axios 抛错（带 response.data.error.message）→ 优先用上游错误', async () => {
    await expect(
      withFreshModule(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockRejectedValueOnce({
            message: 'Request failed',
            response: { data: { error: { message: 'invalid api key' } } },
          } as any)
          return svc.chatCompletion([{ role: 'user', content: 'x' }])
        }
      )
    ).rejects.toThrow('invalid api key')
  })

  test('axios 抛错（只有 response.data.message）→ 回退到 message', async () => {
    await expect(
      withFreshModule(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockRejectedValueOnce({
            message: 'fallback',
            response: { data: { message: 'upstream msg' } },
          } as any)
          return svc.chatCompletion([{ role: 'user', content: 'x' }])
        }
      )
    ).rejects.toThrow('upstream msg')
  })

  test('axios 抛错（无 message 字段）→ 默认 "AI 服务调用失败"', async () => {
    await expect(
      withFreshModule(
        () => {
          process.env.AI_API_KEY = 'test-key'
        },
        async (svc) => {
          mockedAxios.post.mockRejectedValueOnce({} as any)
          return svc.chatCompletion([{ role: 'user', content: 'x' }])
        }
      )
    ).rejects.toThrow(/AI 服务调用失败/)
  })
})

describe('chatCompletion baseUrl 按 provider 切换', () => {
  test('provider=qwen → dashscope.aliyuncs.com', async () => {
    await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
        process.env.AI_PROVIDER = 'qwen'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] },
        } as any)
        await svc.chatCompletion([{ role: 'user', content: 'x' }])
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[0]).toContain('dashscope.aliyuncs.com')
      }
    )
  })

  test('provider=deepseek → api.deepseek.com', async () => {
    await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
        process.env.AI_PROVIDER = 'deepseek'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] },
        } as any)
        await svc.chatCompletion([{ role: 'user', content: 'x' }])
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[0]).toContain('api.deepseek.com')
      }
    )
  })

  test('provider=openai → api.openai.com', async () => {
    await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
        process.env.AI_PROVIDER = 'openai'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] },
        } as any)
        await svc.chatCompletion([{ role: 'user', content: 'x' }])
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[0]).toContain('api.openai.com')
      }
    )
  })

  test('provider=bigmodel → open.bigmodel.cn', async () => {
    await withFreshModule(
      () => {
        process.env.AI_API_KEY = 'test-key'
        process.env.AI_PROVIDER = 'bigmodel'
      },
      async (svc) => {
        mockedAxios.post.mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] },
        } as any)
        await svc.chatCompletion([{ role: 'user', content: 'x' }])
        const callArgs = mockedAxios.post.mock.calls[0] as unknown as [string, any, any]
        expect(callArgs[0]).toContain('open.bigmodel.cn')
      }
    )
  })
})
