import { Router, Request, Response } from 'express'
import authRequired from '../middlewares/auth'
import { requireEditor, requireViewer } from '../middlewares/role'
import {
  describeImage,
  matchEquipment,
  textSearch,
  ImageDescription,
} from '../services/ai.service'
import { semanticSearch } from '../services/embedding.service'
import { chatCompletion, getCurrentProvider, getCurrentModel, type ChatMessage } from '../services/llm.service'
import { AI_TOOLS, executeTool, type ToolContext } from '../services/ai-tools.service'

const router = Router()

// 所有 AI 端点都需要登录
router.use(authRequired)

// 图片识别 / 匹配类端点需要 editor 及以上角色
router.use(requireEditor)

/**
 * 将 ImageDescription 拼接为自然语言描述串，供 matchEquipment 使用。
 */
function descriptionToText(d: ImageDescription): string {
  return [d.type, d.color, d.material, d.suspected_name].filter(Boolean).join(' ')
}

/**
 * 1. POST /describe-image
 * Body: { image_url } 或 { file_path }
 * 成功：{ code: 0, data: { description } }
 * 失败：503 { code: 503, message, fallback_hint: 'semantic' }
 */
router.post('/describe-image', async (req: Request, res: Response) => {
  const b = req.body || {}
  const input = b.image_url || b.file_path
  if (!input || typeof input !== 'string') {
    res.status(400).json({ code: 400, message: '需要 image_url 或 file_path' })
    return
  }
  try {
    const description = await describeImage(input)
    res.json({ code: 0, message: 'ok', data: { description } })
  } catch {
    res.status(503).json({
      code: 503,
      message: 'AI 服务不可用',
      fallback_hint: 'semantic',
    })
  }
})

/**
 * 2. POST /match-equipment
 * Body: { description } 或 { image_url }
 * 成功：{ code: 0, data: { matches } }
 * 失败：503 { code: 503, message, fallback_hint: 'semantic' }
 */
router.post('/match-equipment', async (req: Request, res: Response) => {
  const b = req.body || {}
  try {
    let description: string | undefined = typeof b.description === 'string' ? b.description : undefined
    if (!description && b.image_url) {
      const desc = await describeImage(b.image_url)
      description = descriptionToText(desc)
    }
    if (!description) {
      res.status(400).json({ code: 400, message: '需要 description 或 image_url' })
      return
    }
    const matches = await matchEquipment(description)
    res.json({ code: 0, message: 'ok', data: { matches } })
  } catch {
    res.status(503).json({
      code: 503,
      message: 'AI 服务不可用',
      fallback_hint: 'semantic',
    })
  }
})

/**
 * 3. POST /semantic-search
 * Body: { query }
 * 成功：{ code: 0, data: { matches, fallback_hint? } }
 *   - 若 top score < 0.5，附带 fallback_hint: 'text'
 * 失败：503 { code: 503, message, fallback_hint: 'text' }
 */
router.post('/semantic-search', async (req: Request, res: Response) => {
  const b = req.body || {}
  const query = typeof b.query === 'string' ? b.query : ''
  if (!query.trim()) {
    res.status(400).json({ code: 400, message: '需要 query' })
    return
  }
  try {
    const matches = await semanticSearch(query, 5)
    const topScore = matches[0]?.score ?? 0
    const data: { matches: unknown[]; fallback_hint?: string } = { matches }
    if (topScore < 0.5) {
      data.fallback_hint = 'text'
    }
    res.json({ code: 0, message: 'ok', data })
  } catch {
    res.status(503).json({
      code: 503,
      message: '语义搜索服务不可用',
      fallback_hint: 'text',
    })
  }
})

/**
 * 4. POST /text-search
 * Body: { keyword }
 * 本地 LIKE 搜索，无外部依赖，始终 200。
 */
router.post('/text-search', (req: Request, res: Response) => {
  const b = req.body || {}
  const keyword = typeof b.keyword === 'string' ? b.keyword : ''
  const matches = textSearch(keyword)
  res.json({ code: 0, message: 'ok', data: { matches } })
})

/**
 * 5. POST /recognize 统一入口
 * Body: { image_url?, query? }
 * 降级链：
 *   1. 有 image_url → describeImage + matchEquipment → { stage: 'ai', matches }
 *   2. 失败 → semanticSearch(query 或描述) → { stage: 'semantic', matches }（score >= 0.5）
 *   3. 失败或 score < 0.5 → textSearch(query) → { stage: 'text', matches }
 */
router.post('/recognize', async (req: Request, res: Response) => {
  const b = req.body || {}
  const imageUrl: string | undefined =
    typeof b.image_url === 'string' ? b.image_url : undefined
  const query: string = typeof b.query === 'string' ? b.query : ''

  // Stage 1: AI 图片识别
  if (imageUrl) {
    try {
      const description = await describeImage(imageUrl)
      const descText = descriptionToText(description)
      const matches = await matchEquipment(descText)
      res.json({ code: 0, message: 'ok', data: { stage: 'ai', matches } })
      return
    } catch {
      // 降级到 semantic
    }
  }

  // Stage 2: 语义搜索
  const semanticQuery = query
  if (semanticQuery.trim()) {
    try {
      const matches = await semanticSearch(semanticQuery, 5)
      const topScore = matches[0]?.score ?? 0
      if (topScore >= 0.5) {
        res.json({ code: 0, message: 'ok', data: { stage: 'semantic', matches } })
        return
      }
      // score < 0.5，降级到 text
    } catch {
      // 语义服务不可用，降级到 text
    }
  }

  // Stage 3: 文字搜索
  const matches = textSearch(query)
  res.json({ code: 0, message: 'ok', data: { stage: 'text', matches } })
})

/**
 * 6. POST /chat AI 对话辅助（editor 及以上）
 * Body: { message: string, history?: ChatMessage[] }
 *
 * 工作流程：
 *   1. 把用户消息 + 历史记录发给 LLM，附带工具定义
 *   2. 若 LLM 返回 tool_calls，执行相应工具，把结果回传给 LLM
 *   3. 最多循环 3 轮工具调用，避免死循环
 *   4. 返回最终回复 + 工具调用轨迹
 */
const SYSTEM_PROMPT = `你是消防器材装备管理系统的 AI 助手，帮助用户管理器材进出库和查询。
你可以通过以下工具辅助用户：
- list_equipments: 查询器材库存列表
- list_categories: 查询器材分类树
- search_records: 查询出入库记录
- create_inbound_record: 创建入库记录（增加库存，可附 photo_urls 列表）
- create_outbound_record: 创建出库记录（减少库存，需要领用人）
- get_equipment_stock: 查询单个器材的当前库存
- web_search: 联网搜索外部知识（消防标准、器材规格、技术参数等）

工作要求：
1. 用户说"入库 N 个 XXX"时，调用 create_inbound_record；如用户提供了照片 URL 一并传入 photo_urls（最多 3 张）
2. 用户说"出库 N 个 XXX 给 YYY"时，调用 create_outbound_record
3. 用户问"XXX 还有多少"时，调用 get_equipment_stock
4. 用户问"有哪些器材/分类"时，调用 list_equipments / list_categories
5. 用户问外部知识（标准、规格等）时，调用 web_search
6. 操作前确认关键信息（器材名称、数量、领用人），不确定时主动询问
7. 用简洁的中文回复，执行工具后报告结果
8. 不要编造数据，所有信息通过工具获取`

const MAX_TOOL_ROUNDS = 3

router.post('/chat', requireEditor, async (req: Request, res: Response) => {
  const b = req.body || {}
  const userMessage = typeof b.message === 'string' ? b.message.trim() : ''
  if (!userMessage) {
    res.status(400).json({ code: 400, message: '需要 message 字段' })
    return
  }

  const MAX_CONTENT_LENGTH = 4000
  // history 仅保留 user/assistant 消息，content 截断避免上下文爆炸与 role 注入
  const rawHistory: ChatMessage[] = Array.isArray(b.history) ? b.history : []
  const history: ChatMessage[] = rawHistory
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, MAX_CONTENT_LENGTH) : '',
    }))
  const ctx: ToolContext = {
    userId: req.user!.id,
    userRole: req.user!.role,
    userName: req.user!.name,
  }

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage.slice(0, MAX_CONTENT_LENGTH) },
    ]

    const toolTrace: Array<{
      tool: string
      args: any
      result: any
      success: boolean
    }> = []

    // 循环调用 LLM，最多 MAX_TOOL_ROUNDS 轮工具调用
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await chatCompletion(messages, AI_TOOLS)

      // 没有 tool_calls，说明 LLM 已给出最终回复
      if (!result.tool_calls || result.tool_calls.length === 0) {
        res.json({
          code: 0,
          message: 'ok',
          data: {
            reply: result.content,
            tool_trace: toolTrace,
            provider: getCurrentProvider(),
            model: getCurrentModel(),
            rounds: round + 1,
          },
        })
        return
      }

      // 把 assistant 的 tool_calls 消息加入历史
      messages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.tool_calls,
      })

      // 依次执行每个工具调用
      for (const tc of result.tool_calls) {
        const toolResult = await executeTool(tc.function.name, tc.function.arguments, ctx)
        toolTrace.push({
          tool: tc.function.name,
          args: (() => {
            try {
              return JSON.parse(tc.function.arguments)
            } catch {
              return tc.function.arguments
            }
          })(),
          result: toolResult.data || toolResult.message,
          success: toolResult.success,
        })
        // 把工具结果回传给 LLM
        messages.push({
          role: 'tool',
          content: JSON.stringify(
            toolResult.success
              ? { success: true, data: toolResult.data }
              : { success: false, error: toolResult.message }
          ),
          tool_call_id: tc.id,
        })
      }
    }

    // 达到最大轮数仍有 tool_calls，强制要求 LLM 总结
    const finalResult = await chatCompletion(
      [
        ...messages,
        {
          role: 'user',
          content: '已达到最大工具调用轮数，请根据已有信息直接回复用户。',
        },
      ],
      undefined
    )
    res.json({
      code: 0,
      message: 'ok',
      data: {
        reply: finalResult.content,
        tool_trace: toolTrace,
        provider: getCurrentProvider(),
        model: getCurrentModel(),
        rounds: MAX_TOOL_ROUNDS + 1,
      },
    })
  } catch (err) {
    const msg = (err as Error).message || 'AI 服务不可用'
    res.status(503).json({
      code: 503,
      message: msg,
      provider: getCurrentProvider(),
      model: getCurrentModel(),
    })
  }
})

/**
 * 7. POST /parse-record AI 填表助手
 * Body: { message: string, current_type?: 'in' | 'out' }
 *
 * 与 /chat 不同：不调用任何工具，只让 LLM 解析用户的自然语言指令，
 * 返回结构化 JSON 字段供前端回填表单。
 */
const PARSE_PROMPT = `你是消防器材装备管理系统的填表助手。
用户会用自然语言描述一次入库或出库操作，请解析出以下字段并以严格 JSON 格式返回：
{
  "type": "in" | "out",              // 入库=in，出库=out
  "equipment_name": string,          // 器材名称
  "quantity": number,                // 数量（正整数）
  "recipient": string,               // 领用人（仅出库时有）
  "purpose": string,                 // 用途（可选）
  "expected_return_at": string,      // 预计归还日期 YYYY-MM-DD（仅出库且用户提及时）
  "remark": string                   // 备注（可选）
}

规则：
1. 无法确定的字段不要出现在 JSON 中（省略该字段）
2. quantity 必须是数字，不带单位
3. expected_return_at 必须是 YYYY-MM-DD 格式
4. 只返回 JSON，不要任何解释、代码块标记或额外文字
5. 用户说"入库 N 个 XXX" → type=in, equipment_name=XXX, quantity=N
6. 用户说"出库 N 个 XXX 给 YYY" → type=out, equipment_name=XXX, quantity=N, recipient=YYY`

router.post('/parse-record', async (req: Request, res: Response) => {
  const b = req.body || {}
  const userMessage = typeof b.message === 'string' ? b.message.trim() : ''
  if (!userMessage) {
    res.status(400).json({ code: 400, message: '需要 message 字段' })
    return
  }
  const currentType =
    b.current_type === 'in' || b.current_type === 'out' ? b.current_type : undefined

  try {
    const userHint = currentType
      ? `（当前表单类型为${currentType === 'in' ? '入库' : '出库'}，若用户未明确类型则沿用）\n用户指令：${userMessage}`
      : `用户指令：${userMessage}`

    const result = await chatCompletion(
      [
        { role: 'system', content: PARSE_PROMPT },
        { role: 'user', content: userHint },
      ],
      undefined
    )

    // 从回复中提取 JSON（兼容 LLM 偶尔带代码块标记的情况）
    const reply = result.content || ''
    let parsed: any = null
    try {
      parsed = JSON.parse(reply)
    } catch {
      const match = reply.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          parsed = JSON.parse(match[0])
        } catch {
          parsed = null
        }
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      res.json({
        code: 0,
        message: 'ok',
        data: { raw_reply: reply, fields: null },
      })
      return
    }

    // 字段白名单 + 类型清洗
    const fields: Record<string, any> = {}
    if (parsed.type === 'in' || parsed.type === 'out') {
      fields.type = parsed.type
    }
    if (typeof parsed.equipment_name === 'string' && parsed.equipment_name.trim()) {
      fields.equipment_name = parsed.equipment_name.trim()
    }
    const qty = Number(parsed.quantity)
    if (Number.isFinite(qty) && qty > 0) {
      fields.quantity = Math.floor(qty)
    }
    if (typeof parsed.recipient === 'string' && parsed.recipient.trim()) {
      fields.recipient = parsed.recipient.trim()
    }
    if (typeof parsed.purpose === 'string' && parsed.purpose.trim()) {
      fields.purpose = parsed.purpose.trim()
    }
    if (typeof parsed.expected_return_at === 'string' && parsed.expected_return_at.trim()) {
      fields.expected_return_at = parsed.expected_return_at.trim()
    }
    if (typeof parsed.remark === 'string' && parsed.remark.trim()) {
      fields.remark = parsed.remark.trim()
    }

    res.json({
      code: 0,
      message: 'ok',
      data: { fields, raw_reply: reply },
    })
  } catch (err) {
    const msg = (err as Error).message || 'AI 服务不可用'
    res.status(503).json({
      code: 503,
      message: msg,
      provider: getCurrentProvider(),
      model: getCurrentModel(),
    })
  }
})

export default router
