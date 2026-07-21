/**
 * LLM 多模型服务
 * 支持通义千问（Qwen）、DeepSeek、OpenAI、智谱AI（BigModel）四种 provider
 * 通过环境变量 AI_PROVIDER 切换：qwen | deepseek | openai | bigmodel
 *
 * 统一使用 OpenAI 兼容协议（四家都支持 /v1/chat/completions）。
 * 通义千问：https://dashscope.aliyuncs.com/compatible-mode/v1
 * DeepSeek：https://api.deepseek.com/v1
 * OpenAI：  https://api.openai.com/v1
 * 智谱AI：  https://open.bigmodel.cn/api/coding/paas/v4
 */
import axios from 'axios'
import { config } from '../config'
import { logger } from '../utils/logger'

/** 消息角色 */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

/** 对话消息 */
export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** 工具定义（function calling） */
export interface LlmTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

/** 工具调用请求 */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** 对话返回结果 */
export interface ChatResult {
  content: string
  tool_calls?: ToolCall[]
  finish_reason: 'stop' | 'tool_calls' | 'length'
}

/** 当前 provider 名称 */
export function getCurrentProvider(): string {
  return config.ai.provider || 'qwen'
}

/** 当前使用的模型名（对话 / function calling） */
export function getCurrentModel(): string {
  return config.ai.chatModel || 'qwen-plus'
}

/**
 * 调用大模型对话接口（OpenAI 兼容协议）
 * @param messages 消息列表
 * @param tools 可选的工具定义（function calling）
 * @returns ChatResult
 */
export async function chatCompletion(
  messages: ChatMessage[],
  tools?: LlmTool[]
): Promise<ChatResult> {
  const provider = getCurrentProvider()
  const baseUrl = config.ai.baseUrl
  const apiKey = config.ai.apiKey
  const model = getCurrentModel()

  if (!apiKey) {
    throw new Error(`AI_API_KEY 未配置（当前 provider: ${provider}）`)
  }

  const body: Record<string, any> = {
    model,
    messages,
    temperature: 0.3,
  }
  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  try {
    // 单轮超时 45s：function calling 场景下大模型响应较慢，18s 不够
    // 前端 chat 端 timeout=60s，单轮 45s + 工具执行留 15s 余量
    const res = await axios.post(`${baseUrl}/chat/completions`, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 45000,
    })
    const choice = res.data?.choices?.[0]
    if (!choice) {
      throw new Error('AI 返回数据格式异常')
    }
    return {
      content: choice.message?.content || '',
      tool_calls: choice.message?.tool_calls,
      finish_reason: choice.finish_reason,
    }
  } catch (err: any) {
    const msg =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      err?.message ||
      'AI 服务调用失败'
    logger.error('[llm] chatCompletion 失败:', msg)
    throw new Error(msg)
  }
}