/**
 * 联网搜索服务
 * 支持多家搜索 API：Bocha AI、Tavily、SerpAPI
 * 通过环境变量 WEB_SEARCH_PROVIDER 切换
 *
 * - bocha:  Bocha AI（推荐，国内免费额度）   https://api.bochaai.com/v1/web-search
 * - tavily: Tavily（英文/全球）              https://api.tavily.com/search
 * - serpapi: SerpAPI（Google 搜索）          https://serpapi.com/search
 *
 * 未配置 API Key 时返回 { available: false }，前端工具调用会降级提示
 */
import axios from 'axios'
import { logger } from '../utils/logger'

export interface WebSearchResultItem {
  title: string
  snippet: string
  url: string
}

export interface WebSearchResult {
  available: boolean
  query: string
  summary: string
  results: WebSearchResultItem[]
  reason?: string
}

const MAX_TITLE_LEN = 200
const MAX_SNIPPET_LEN = 500
const MAX_URL_LEN = 2048
const ALLOWED_URL_SCHEMES = ['http:', 'https:']
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/**
 * 实时读取 env，避免模块级常量在测试切换 env 时不生效
 * 同时支持热重载：dotenv 在 test 间修改会立刻被识别
 */
function getProvider(): string {
  return process.env.WEB_SEARCH_PROVIDER || ''
}
function getApiKey(): string {
  return process.env.WEB_SEARCH_API_KEY || ''
}

function cleanText(text: unknown, maxLen: number): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

function cleanUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.replace(CONTROL_CHARS, '').trim().slice(0, MAX_URL_LEN)
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (!ALLOWED_URL_SCHEMES.includes(u.protocol.toLowerCase())) {
      return null
    }
    return u.toString()
  } catch {
    return null
  }
}

function cleanResults(
  rawResults: Array<{ title: unknown; snippet: unknown; url: unknown }>
): WebSearchResultItem[] {
  const out: WebSearchResultItem[] = []
  for (const r of rawResults) {
    const safeUrl = cleanUrl(r.url)
    if (!safeUrl) continue // 拒绝不安全 URL（javascript: / data: 等）
    out.push({
      title: cleanText(r.title, MAX_TITLE_LEN),
      snippet: cleanText(r.snippet, MAX_SNIPPET_LEN),
      url: safeUrl,
    })
  }
  return out
}

/**
 * 联网搜索
 * - 当 provider / api_key 缺失时，返回 available=false
 * - 当 provider=bocha / tavily / serpapi 时调用对应接口
 */
export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResult> {
  const provider = getProvider()
  const apiKey = getApiKey()
  if (!provider || !apiKey) {
    return {
      available: false,
      query,
      summary: '联网搜索未启用',
      results: [],
      reason: '未配置 WEB_SEARCH_PROVIDER 或 WEB_SEARCH_API_KEY',
    }
  }

  try {
    if (provider === 'bocha') {
      return await bochaSearch(query, maxResults, apiKey)
    } else if (provider === 'tavily') {
      return await tavilySearch(query, maxResults, apiKey)
    } else if (provider === 'serpapi') {
      return await serpApiSearch(query, maxResults, apiKey)
    } else {
      return {
        available: false,
        query,
        summary: '未知搜索服务提供商',
        results: [],
        reason: `不支持的 provider: ${provider}`,
      }
    }
  } catch (err) {
    const msg = (err as Error).message || '搜索服务调用失败'
    logger.error('[web-search] 失败:', msg)
    return {
      available: false,
      query,
      summary: '搜索失败',
      results: [],
      reason: msg,
    }
  }
}

/** Bocha AI 搜索 */
async function bochaSearch(query: string, maxResults: number, apiKey: string): Promise<WebSearchResult> {
  const res = await axios.post(
    'https://api.bochaai.com/v1/web-search',
    {
      query,
      summary: true,
      count: maxResults,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 15000,
    }
  )
  const data = res.data?.data || {}
  const webPages = (data.webPages?.value || []) as Array<{
    name: string
    snippet: string
    url: string
  }>
  return {
    available: true,
    query,
    summary: cleanText(data.summary || '', 1000),
    results: cleanResults(
      webPages.map((p) => ({ title: p.name, snippet: p.snippet, url: p.url }))
    ),
  }
}

/** Tavily 搜索 */
async function tavilySearch(query: string, maxResults: number, apiKey: string): Promise<WebSearchResult> {
  const res = await axios.post(
    'https://api.tavily.com/search',
    {
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
    },
    { timeout: 15000 }
  )
  const data = res.data || {}
  return {
    available: true,
    query,
    summary: cleanText(data.answer || '', 1000),
    results: cleanResults(
      (data.results || []).map((r: any) => ({
        title: r.title,
        snippet: r.content,
        url: r.url,
      }))
    ),
  }
}

/** SerpAPI 搜索 */
async function serpApiSearch(query: string, maxResults: number, apiKey: string): Promise<WebSearchResult> {
  const res = await axios.get('https://serpapi.com/search', {
    params: { api_key: apiKey, q: query, num: maxResults },
    timeout: 15000,
  })
  const data = res.data || {}
  return {
    available: true,
    query,
    summary: cleanText(
      data.answer_box?.answer || data.answer_box?.snippet || '',
      1000
    ),
    results: cleanResults(
      (data.organic_results || []).map((r: any) => ({
        title: r.title,
        snippet: r.snippet,
        url: r.link,
      }))
    ),
  }
}
