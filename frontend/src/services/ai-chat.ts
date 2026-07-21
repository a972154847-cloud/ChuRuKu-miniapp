import request from './request'

/** 历史消息（发给后端的历史记录） */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 工具调用轨迹 */
export interface ToolTraceItem {
  tool: string
  args: any
  result: any
  success: boolean
}

/** AI 聊天返回 */
export interface AiChatResult {
  reply: string
  tool_trace?: ToolTraceItem[]
  provider: string
  model: string
  rounds: number
}

/** AI 对话辅助 */
export function aiChat(message: string, history: ChatHistoryMessage[] = []) {
  return request<AiChatResult>({
    url: '/ai/chat',
    method: 'POST',
    data: { message, history },
    timeout: 60000,
  })
}

/** AI 填表助手解析出的字段（每个字段都可能缺失） */
export interface ParsedRecordFields {
  type?: 'in' | 'out'
  equipment_name?: string
  quantity?: number
  recipient?: string
  purpose?: string
  expected_return_at?: string
  remark?: string
}

/** /parse-record 返回结构 */
export interface ParseRecordResult {
  fields: ParsedRecordFields | null
  raw_reply: string
}

/**
 * AI 填表助手：把自然语言指令解析为结构化字段
 * @param message 用户输入的自然语言，如"出库2个干粉灭火器给张三"
 * @param currentType 当前表单类型（可选，帮助 AI 沿用）
 */
export function parseRecord(message: string, currentType?: 'in' | 'out') {
  return request<ParseRecordResult>({
    url: '/ai/parse-record',
    method: 'POST',
    data: { message, current_type: currentType },
    timeout: 30000,
  })
}