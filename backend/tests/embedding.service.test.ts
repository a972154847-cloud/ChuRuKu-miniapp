/**
 * embedding.service 单元测试
 * 覆盖：
 * - cosineSimilarity：相同 / 正交 / 零向量 / 不同长度
 * - embedBatch：空数组短路
 * - semanticSearch：空表 / 正常 TopK / 排序
 * - getOrInitPipeline：缓存单例
 * - 默认导出
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

// mock @huggingface/transformers：返回一个可调用函数
// 真实使用中 pipeline('feature-extraction', MODEL_ID) 返回 extractor
// extractor(text, { pooling, normalize }) → Tensor with .data / .tolist()
jest.mock('@huggingface/transformers', () => {
  const fakePipeline = jest.fn()
  return {
    pipeline: fakePipeline,
    env: { cacheDir: '', allowRemoteModels: true },
  }
})

const { pipeline, env } = require('@huggingface/transformers') as {
  pipeline: jest.Mock
  env: { cacheDir: string; allowRemoteModels: boolean }
}

const {
  getOrInitPipeline,
  embed,
  embedBatch,
  cosineSimilarity,
  semanticSearch,
} = require('../src/services/embedding.service')

const db = require('../src/db').default as typeof import('../src/db').default
const { resetDatabase } = require('../src/db/seed') as typeof import('../src/db/seed')

// 简易 fake extractor：把字符串长度归一化为向量（确定性、可比较）
function makeFakeExtractor() {
  const fn: any = (input: string | string[]) => {
    const texts = Array.isArray(input) ? input : [input]
    const vectors = texts.map((t) => {
      // 用每个 char 的 unicode 累加做伪 embedding
      let sum = 0
      for (const c of t) sum += c.charCodeAt(0)
      // 简单的 4 维向量用于测试
      return [sum, sum * 2, sum * 3, sum * 4]
    })
    if (Array.isArray(input)) {
      return { tolist: () => vectors }
    }
    return { data: new Float32Array(vectors[0]) }
  }
  return fn
}

beforeEach(() => {
  resetDatabase()
  // 清空迁移预置的 20 条种子器材
  db.exec('DELETE FROM record_photos')
  db.exec('DELETE FROM records')
  db.exec('DELETE FROM equipments')
  jest.clearAllMocks()
  // 每次重置 pipeline，让 getOrInitPipeline 重新初始化
  pipeline.mockResolvedValue(makeFakeExtractor())
})

describe('cosineSimilarity', () => {
  test('相同向量 → 1.0', () => {
    const a = [1, 2, 3]
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5)
  })

  test('正交向量 → 0', () => {
    const a = [1, 0]
    const b = [0, 1]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
  })

  test('反向向量 → -1.0', () => {
    const a = [1, 2, 3]
    const b = [-1, -2, -3]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5)
  })

  test('零向量 → 0（防 NaN）', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  test('不同长度取 min（min 之外的多余维度不影响结果）', () => {
    // 短的 b 只有 2 维，长的 a 有 4 维，取 min=2 比较前 2 维 = [1,0] vs [0,1]
    // → dot=0, cos=0
    const a = [1, 0]
    const b = [0, 1, 999, 888, 777]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
    // 验证 b 的多余维度不影响结果
    const bShort = [0, 1]
    const bLong = [0, 1, 999, 888, 777]
    expect(cosineSimilarity(a, bLong)).toBeCloseTo(cosineSimilarity(a, bShort), 5)
  })
})

describe('embedBatch 空数组短路', () => {
  test('空数组不调用 pipeline', async () => {
    const res = await embedBatch([])
    expect(res).toEqual([])
    expect(pipeline).not.toHaveBeenCalled()
  })

  test('非空数组调用 pipeline 并返回 number[][]', async () => {
    const res = await embedBatch(['abc', 'def'])
    expect(res).toHaveLength(2)
    expect(res[0]).toBeInstanceOf(Array)
    expect(res[0].length).toBe(4)
  })
})

describe('embed', () => {
  test('返回 number[]', async () => {
    const v = await embed('hello')
    expect(v).toBeInstanceOf(Array)
    expect(v.length).toBe(4)
  })
})

describe('getOrInitPipeline 单例', () => {
  test('多次调用只初始化一次（pipeline() 只调一次）', async () => {
    // 隔离模块以重置 _pipeline 缓存
    let isolatedGet: typeof getOrInitPipeline
    jest.isolateModules(() => {
      const mod = require('../src/services/embedding.service')
      isolatedGet = mod.getOrInitPipeline
    })
    // 第一次调用
    const p1 = await isolatedGet!()
    // 第二次调用应该返回缓存，不调 pipeline
    const p2 = await isolatedGet!()
    expect(p1).toBe(p2)
    expect(pipeline).toHaveBeenCalledTimes(1)
  })
})

describe('semanticSearch', () => {
  test('空表 → []', async () => {
    const res = await semanticSearch('anything')
    expect(res).toEqual([])
  })

  test('正常 TopK：query 匹配自身排序第一', async () => {
    db.prepare('INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)').run(
      '干粉灭火器',
      '4kg',
      1
    )
    db.prepare('INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)').run(
      '二氧化碳灭火器',
      '5kg',
      1
    )
    // fake extractor 给相同字串返回相同向量
    const res = await semanticSearch('干粉灭火器', 5)
    expect(res.length).toBe(2)
    // 干粉灭火器 应该排第一
    expect(res[0].name).toBe('干粉灭火器')
    expect(res[0].score).toBeGreaterThanOrEqual(res[1].score)
    // 返回字段
    expect(res[0]).toHaveProperty('id')
    expect(res[0]).toHaveProperty('spec')
    expect(res[0]).toHaveProperty('category_name')
    expect(res[0]).toHaveProperty('score')
  })

  test('topK 限制返回数量', async () => {
    for (let i = 0; i < 5; i++) {
      db.prepare('INSERT INTO equipments (name, is_active) VALUES (?, ?)').run(
        `器材${i}`,
        1
      )
    }
    const res = await semanticSearch('xx', 2)
    expect(res.length).toBe(2)
  })

  test('spec 字段参与 embedding（spec 为空时只 embed name）', async () => {
    db.prepare('INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)').run(
      'A',
      null,
      1
    )
    db.prepare('INSERT INTO equipments (name, spec, is_active) VALUES (?, ?, ?)').run(
      'B',
      'spec-text',
      1
    )
    const res = await semanticSearch('query', 5)
    expect(res).toHaveLength(2)
  })
})

describe('embedding 默认导出', () => {
  test('default export 包含 5 个方法', () => {
    const mod = require('../src/services/embedding.service')
    expect(mod.default).toBeDefined()
    expect(typeof mod.default.getOrInitPipeline).toBe('function')
    expect(typeof mod.default.embed).toBe('function')
    expect(typeof mod.default.embedBatch).toBe('function')
    expect(typeof mod.default.cosineSimilarity).toBe('function')
    expect(typeof mod.default.semanticSearch).toBe('function')
  })
})

describe('env 配置', () => {
  test('测试环境设置 allowRemoteModels=false', () => {
    expect(env.allowRemoteModels).toBe(false)
  })

  test('env.cacheDir 已设置', () => {
    expect(env.cacheDir).toBeTruthy()
  })
})
