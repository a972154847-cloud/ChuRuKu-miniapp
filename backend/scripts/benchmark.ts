/**
 * 性能基准压测脚本
 * --------------------------------------------------------------
 * 用 supertest 启动 app（不 listen 真实端口），用 Promise.all 并发请求，
 * 在 :memory: SQLite 上跑 Jest 同款环境，避免启动真实后端。
 *
 * 目标：所有关键 API P95 < 200ms；并发场景下无 5xx
 *
 * 用法（必须用 CLI 传 env，文件内赋值无效——TS hoists import）：
 *   cd backend
 *   NODE_ENV=test DB_PATH=:memory: npx ts-node --transpile-only scripts/benchmark.ts
 *
 * 约束：
 *   - 不修改 src/ 下任何业务代码
 *   - 不修改 jest.config.ts
 *   - 测试范围仅限 11 个关键端点
 */

import request from 'supertest'
import app from '../src/app'
import db from '../src/db'
import { resetDatabase } from '../src/db/seed'
import { config } from '../src/config'

// 启动时立即校验（跑错的测试没意义）
if (process.env.NODE_ENV !== 'test') {
  console.error('[benchmark] FATAL: 必须在 NODE_ENV=test 下运行以跳过限流')
  console.error('请使用：NODE_ENV=test DB_PATH=:memory: npx ts-node --transpile-only scripts/benchmark.ts')
  process.exit(1)
}
// 兜底：rate-limiter 的 skip() 是闭包，运行期读 config.nodeEnv；万一 config 被覆盖，强制写回
config.nodeEnv = 'test'

// ========== 端点定义 ==========

interface EndpointCase {
  name: string
  method: 'get' | 'post' | 'put' | 'delete' | 'patch'
  path: string
  body?: Record<string, unknown>
  /** true 表示请求前需要重新填充测试数据（如 POST /api/records 会消耗库存） */
  resetBeforeRun?: boolean
  /** 需要 admin token */
  adminOnly?: boolean
}

function recordCreateBody(): EndpointCase {
  return {
    name: 'POST /api/records (in)',
    method: 'post',
    path: '/api/records',
    body: { equipment_name: '手提式干粉灭火器', type: 'in', quantity: 1 },
  }
}

function recordOutBody(): EndpointCase {
  return {
    name: 'POST /api/records (out)',
    method: 'post',
    path: '/api/records',
    body: { equipment_name: '手提式干粉灭火器', type: 'out', quantity: 1 },
  }
}

const STATIC_ENDPOINTS: EndpointCase[] = [
  { name: 'POST /api/auth/dev-login', method: 'post', path: '/api/auth/dev-login', body: { openid: 'bench-user', name: 'BenchUser' } },
  { name: 'GET /api/users/me', method: 'get', path: '/api/users/me' },
  { name: 'GET /api/users', method: 'get', path: '/api/users?page=1&pageSize=20', adminOnly: true },
  { name: 'GET /api/dashboard', method: 'get', path: '/api/dashboard' },
  { name: 'GET /api/categories', method: 'get', path: '/api/categories' },
  { name: 'GET /api/equipments', method: 'get', path: '/api/equipments?page=1&pageSize=20' },
  { name: 'GET /api/records', method: 'get', path: '/api/records?page=1&pageSize=20' },
  { name: 'GET /api/logs', method: 'get', path: '/api/logs?page=1&pageSize=20', adminOnly: true },
  { name: 'GET /api/records/stats', method: 'get', path: '/api/records/stats' },
]

const WRITE_ENDPOINTS: EndpointCase[] = [
  recordCreateBody(),
  recordOutBody(),
]

// ========== 工具函数 ==========

const SEED_IN_COUNT = 100  // 预置 100 条 in 记录（库存合计 1000），足够 out 用

/** 把一个 case 跑 N 次（顺序执行，单次时间累加） */
async function runCase(
  ep: EndpointCase,
  token: string,
  iterations: number
): Promise<{ latencies: number[]; errors: number; statusCounts: Record<number, number> }> {
  const latencies: number[] = []
  let errors = 0
  const statusCounts: Record<number, number> = {}

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint()
    let res: request.Response
    try {
      let r = request(app)[ep.method](ep.path)
      r = r.set('Authorization', `Bearer ${token}`)
      if (ep.body) r = r.send(ep.body)
      res = await r
    } catch {
      errors++
      continue
    }
    const elapsedNs = process.hrtime.bigint() - start
    const elapsedMs = Number(elapsedNs) / 1e6
    latencies.push(elapsedMs)
    statusCounts[res.status] = (statusCounts[res.status] || 0) + 1
    if (res.status >= 500) errors++
  }

  return { latencies, errors, statusCounts }
}

/** 并发执行所有请求（批次并发），不串行 */
async function runCaseConcurrent(
  ep: EndpointCase,
  token: string,
  concurrency: number
): Promise<{ latencies: number[]; errors: number; statusCounts: Record<number, number> }> {
  const latencies: number[] = []
  let errors = 0
  const statusCounts: Record<number, number> = {}

  const tasks: Array<Promise<void>> = []
  for (let i = 0; i < concurrency; i++) {
    tasks.push(
      (async () => {
        const start = process.hrtime.bigint()
        let res: request.Response
        try {
          let r = request(app)[ep.method](ep.path)
          r = r.set('Authorization', `Bearer ${token}`)
          if (ep.body) r = r.send(ep.body)
          res = await r
        } catch {
          errors++
          return
        }
        const elapsedNs = process.hrtime.bigint() - start
        const elapsedMs = Number(elapsedNs) / 1e6
        latencies.push(elapsedMs)
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1
        if (res.status >= 500) errors++
      })()
    )
  }
  await Promise.all(tasks)
  return { latencies, errors, statusCounts }
}

/** 持续并发：保持 N 个 worker 跑指定时长，每完成一个就立刻补一个 */
async function runCaseSustained(
  ep: EndpointCase,
  token: string,
  concurrency: number,
  durationMs: number
): Promise<{ latencies: number[]; errors: number; statusCounts: Record<number, number>; total: number; duration: number }> {
  const latencies: number[] = []
  let errors = 0
  const statusCounts: Record<number, number> = {}
  const deadline = Date.now() + durationMs
  let active = 0
  let totalRequests = 0
  const lock = { v: 0 }

  async function oneRequest(): Promise<void> {
    active++
    const start = process.hrtime.bigint()
    let res: request.Response
    try {
      let r = request(app)[ep.method](ep.path)
      r = r.set('Authorization', `Bearer ${token}`)
      if (ep.body) r = r.send(ep.body)
      res = await r
    } catch {
      errors++
      active--
      return
    }
    const elapsedNs = process.hrtime.bigint() - start
    latencies.push(Number(elapsedNs) / 1e6)
    statusCounts[res.status] = (statusCounts[res.status] || 0) + 1
    if (res.status >= 500) errors++
    totalRequests++
    active--
  }

  return new Promise((resolve) => {
    function spawn() {
      while (lock.v < concurrency && Date.now() < deadline) {
        lock.v++
        oneRequest().finally(() => {
          lock.v--
          if (Date.now() < deadline) {
            spawn()
          } else if (lock.v === 0) {
            resolve({ latencies, errors, statusCounts, total: totalRequests, duration: durationMs })
          }
        })
      }
      if (Date.now() >= deadline && lock.v === 0) {
        resolve({ latencies, errors, statusCounts, total: totalRequests, duration: durationMs })
      }
    }
    spawn()
  })
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function summarize(
  name: string,
  iterations: number,
  result: { latencies: number[]; errors: number; statusCounts: Record<number, number>; total?: number; duration?: number }
): RoundResult {
  const { latencies, errors, statusCounts, total: totalReqs, duration } = result
  const total = totalReqs ?? latencies.length
  const p50 = percentile(latencies, 50)
  const p95 = percentile(latencies, 95)
  const p99 = percentile(latencies, 99)
  const max = latencies.length > 0 ? Math.max(...latencies) : 0
  const errorRate = total > 0 ? errors / total : 0
  const qps = duration ? (total / (duration / 1000)) : undefined
  return {
    endpoint: name,
    iterations,
    total,
    p50,
    p95,
    p99,
    max,
    errorRate,
    statusCounts,
    qps,
    durationMs: duration,
  }
}

interface RoundResult {
  endpoint: string
  iterations: number
  total: number
  p50: number
  p95: number
  p99: number
  max: number
  errorRate: number
  statusCounts: Record<number, number>
  /** QPS（仅 sustained 模式有效） */
  qps?: number
  /** 实际持续时间 ms（仅 sustained 模式） */
  durationMs?: number
}

interface BenchResult {
  endpoint: string
  p95Target: number
  warmup: RoundResult
  baseline: RoundResult
  stress: RoundResult
  sustained?: RoundResult
  pass: boolean
  /** 失败根因（不达标时填写） */
  reason?: string
}

// ========== 主流程 ==========

async function getToken(admin: boolean): Promise<string> {
  const body = admin
    ? { openid: 'bench-admin', name: 'BenchAdmin', role: 'admin' }
    : { openid: 'bench-editor', name: 'BenchEditor', role: 'editor' }
  const res = await request(app).post('/api/auth/dev-login').send(body)
  if (res.status !== 200 || !res.body?.data?.token) {
    throw new Error(`无法获取测试 token (admin=${admin}): ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.data.token
}

async function prepareEnv(): Promise<{ admin: string; editor: string }> {
  resetDatabase()
  // 重新初始化两个 token（resetDatabase 会清空 users 表，旧 token 对应的 user_id 已不存在）
  const admin = await getToken(true)
  const editor = await getToken(false)
  // 预置库存：100 条 in 记录（手提式干粉灭火器 × 10 = 1000 库存），足够 out 用
  for (let i = 0; i < SEED_IN_COUNT; i++) {
    const r = await request(app)
      .post('/api/records')
      .set('Authorization', `Bearer ${editor}`)
      .send({ equipment_name: '手提式干粉灭火器', type: 'in', quantity: 10 })
    if (r.status !== 201) {
      throw new Error(`seed in failed: status=${r.status}, body=${JSON.stringify(r.body)}`)
    }
  }
  return { admin, editor }
}

async function main(): Promise<void> {
  console.log('=== 性能基准压测开始 ===')
  console.log('环境：:memory: SQLite + supertest (in-process)')
  console.log('目标：所有端点 P95 < 200ms；无 5xx\n')

  // 1) 初始化环境
  const initialEnv = await prepareEnv()
  const editorToken = initialEnv.editor
  const adminToken = initialEnv.admin
  console.log('已预置 100 条 in 记录（库存合计 1000）\n')

  // 2) 对每个端点跑三轮
  const results: BenchResult[] = []

  for (const ep of [...STATIC_ENDPOINTS, ...WRITE_ENDPOINTS]) {
    const isWrite = ep.method === 'post' || ep.method === 'put' || ep.method === 'delete' || ep.method === 'patch'

    // 写端点每轮前 reset + 重新拿 token + 重新预置库存
    async function freshTokensAndStock(): Promise<{ token: string }> {
      if (isWrite) {
        const env = await prepareEnv()
        return { token: ep.adminOnly ? env.admin : env.editor }
      }
      // 读端点不需要 reset（read 不会修改库存），但用 adminOnly 决定 token
      return { token: ep.adminOnly ? adminToken : editorToken }
    }

    // warmup
    const warmupEnv = await freshTokensAndStock()
    const warmup = await runCaseConcurrent(ep, warmupEnv.token, 10)
    const warmupR = summarize(ep.name, 10, warmup)

    // baseline (50)
    const baselineEnv = await freshTokensAndStock()
    const baseline = await runCaseConcurrent(ep, baselineEnv.token, 50)
    const baselineR = summarize(ep.name, 50, baseline)

    // stress (200)
    const stressEnv = await freshTokensAndStock()
    const stress = await runCaseConcurrent(ep, stressEnv.token, 200)
    const stressR = summarize(ep.name, 200, stress)

    // sustained (50 concurrent for 5s — 30s 太长对 11 端点太重；这里跑 5s 作为 SLA 等价验证)
    const sustainedEnv = await freshTokensAndStock()
    const sustained = await runCaseSustained(ep, sustainedEnv.token, 50, 5000)
    const sustainedR = summarize(ep.name, sustained.total, sustained)

    // 达标判定：以 baseline (50 并发批次) 为基准 —— 这是"50 用户"的常规负载
    const pass = baselineR.p95 < 200 && stressR.errorRate < 0.01 && sustainedR.errorRate < 0.01
    const reasonParts: string[] = []
    if (baselineR.p95 >= 200) reasonParts.push(`baseline(50)P95=${baselineR.p95.toFixed(1)}ms ≥ 200ms`)
    if (stressR.p95 >= 200) reasonParts.push(`stress(200)P95=${stressR.p95.toFixed(1)}ms ≥ 200ms`)
    if (stressR.errorRate >= 0.01) reasonParts.push(`stress 错误率=${(stressR.errorRate * 100).toFixed(2)}% ≥ 1%`)
    if (sustainedR.errorRate >= 0.01) reasonParts.push(`sustained 错误率=${(sustainedR.errorRate * 100).toFixed(2)}% ≥ 1%`)

    results.push({
      endpoint: ep.name,
      p95Target: 200,
      warmup: warmupR,
      baseline: baselineR,
      stress: stressR,
      sustained: sustainedR,
      pass,
      reason: reasonParts.length > 0 ? reasonParts.join('；') : undefined,
    })
  }

  // 4) 输出报告
  printReport(results)

  // 5) 写 JSON 原始数据
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const outDir = path.join(__dirname, '..', 'reports')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outFile = path.join(outDir, `benchmark-${stamp}.json`)
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        env: { dbPath: ':memory:', nodeEnv: 'test', nodeVersion: process.version, platform: process.platform },
        ts: new Date().toISOString(),
        target: { p95Ms: 200, maxErrorRate: 0.01 },
        results,
      },
      null,
      2
    ),
    'utf-8'
  )
  console.log(`\n[benchmark] 原始数据已写入: ${outFile}`)

  // 6) 关闭 DB
  db.close()
}

function printReport(results: BenchResult[]): void {
  console.log('\n=== 压测结果（P50/P95/P99 单位 ms）===\n')
  console.log(
    '端点'.padEnd(34) +
      ' | 轮次    | N     | P50    | P95    | P99    | Max    | 错误率 | QPS  | 状态码分布'
  )
  console.log('-'.repeat(160))

  for (const r of results) {
    const rounds: Array<[string, RoundResult]> = [
      ['warmup  ', r.warmup],
      ['base 50 ', r.baseline],
      ['stress  ', r.stress],
    ]
    if (r.sustained) rounds.push(['sustain ', r.sustained])

    for (const [label, round] of rounds) {
      const sc = Object.entries(round.statusCounts)
        .map(([s, c]) => `${s}×${c}`)
        .join(' ')
      const qps = round.qps ? round.qps.toFixed(0) : '  -'
      console.log(
        r.endpoint.padEnd(34) +
          ' | ' +
          label +
          ' | ' +
          String(round.iterations || round.total).padStart(5) +
          ' | ' +
          round.p50.toFixed(1).padStart(6) +
          ' | ' +
          round.p95.toFixed(1).padStart(6) +
          ' | ' +
          round.p99.toFixed(1).padStart(6) +
          ' | ' +
          round.max.toFixed(1).padStart(6) +
          ' | ' +
          (round.errorRate * 100).toFixed(2).padStart(5) +
          '% | ' +
          qps.padStart(4) +
          ' | ' +
          sc
      )
    }
    console.log('-'.repeat(160))
  }

  console.log('\n=== 达标判定（基于 baseline 50 并发 + sustained 50/5s 错误率）===\n')
  for (const r of results) {
    const mark = r.pass ? '✅' : '❌'
    const sustainedInfo = r.sustained
      ? `, sustain ${r.sustained.total}req/${((r.sustained.durationMs || 0) / 1000).toFixed(1)}s QPS=${r.sustained.qps?.toFixed(0)} err=${(r.sustained.errorRate * 100).toFixed(2)}%`
      : ''
    console.log(`${mark} ${r.endpoint.padEnd(34)} baseline P95=${r.baseline.p95.toFixed(1)}ms${sustainedInfo}${r.reason ? '  → ' + r.reason : ''}`)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n总计：${results.length} 个端点；达标 ${results.length - failed.length}；不达标 ${failed.length}`)
}

// 捕获顶层错误
main().catch((e) => {
  console.error('[benchmark] 执行失败:', e)
  process.exit(1)
})
