import { pipeline, env } from '@huggingface/transformers'
import db from '../db'
import { config } from '../config'

/**
 * 语义搜索服务：基于 @huggingface/transformers 加载 Xenova/bge-small-zh 模型，
 * 对器材库做向量化 + 余弦相似度匹配。
 *
 * 测试环境（NODE_ENV=test）下 env.allowRemoteModels=false，
 * 模型未缓存时 pipeline() 立即抛错，避免下载 100MB 模型挂起测试。
 */

const MODEL_ID = 'Xenova/bge-small-zh'

// 模块加载时配置 env（仅执行一次）
env.cacheDir = './.transformers-cache'
if (config.nodeEnv === 'test') {
  // 测试环境禁止远程下载，模型未缓存立即抛错
  env.allowRemoteModels = false
}

let _pipeline: any = null

/**
 * 懒加载 feature-extraction pipeline。
 * 首次调用时加载模型（dev/prod 允许远程下载，test 禁止）。
 */
export async function getOrInitPipeline(): Promise<any> {
  if (_pipeline) return _pipeline
  _pipeline = await pipeline('feature-extraction', MODEL_ID)
  return _pipeline
}

/**
 * 单文本 embedding：返回归一化后的向量。
 */
export async function embed(text: string): Promise<number[]> {
  const extractor = await getOrInitPipeline()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  // output.data 是 Float32Array，转普通数组
  return Array.from(output.data as Float32Array)
}

/**
 * 批量 embedding：返回归一化向量数组（与输入文本顺序一致）。
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const extractor = await getOrInitPipeline()
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  // tolist() 对 (batch, dim) Tensor 返回 number[][]
  return output.tolist() as number[][]
}

/**
 * 余弦相似度（向量已归一化时等于点积，但这里保留通用实现）。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 语义搜索结果项 */
export interface SemanticSearchItem {
  id: number
  name: string
  spec: string | null
  category_name: string | null
  score: number
}

/**
 * 语义搜索：加载所有启用器材 → embed query + embedBatch items → 余弦相似度 → TopK。
 */
export async function semanticSearch(
  query: string,
  topK = 5
): Promise<SemanticSearchItem[]> {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.spec, c.name as category_name
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.is_active = 1`
    )
    .all() as Array<{
    id: number
    name: string
    spec: string | null
    category_name: string | null
  }>

  if (rows.length === 0) return []

  const queryVec = await embed(query)
  const texts = rows.map((r) => `${r.name}${r.spec ? ' ' + r.spec : ''}`)
  const vectors = await embedBatch(texts)

  const scored = rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    spec: r.spec,
    category_name: r.category_name,
    score: cosineSimilarity(queryVec, vectors[i]),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

export default {
  getOrInitPipeline,
  embed,
  embedBatch,
  cosineSimilarity,
  semanticSearch,
}
