/**
 * S-3: web-search 结果 XSS 清洗单测
 * 覆盖：cleanText / cleanUrl / cleanResults / 三个 provider 的清洗入口
 */
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'

import axios from 'axios'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

// 在 mock 后再 import，确保服务读取到 mock 后的 axios
import { webSearch } from '../src/services/web-search.service'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  Object.assign(process.env, ORIGINAL_ENV)
})

afterAll(() => {
  Object.assign(process.env, ORIGINAL_ENV)
})

describe('S-3 webSearch: XSS 清洗', () => {
  test('未配置 PROVIDER/API_KEY 时返回 available=false', async () => {
    delete process.env.WEB_SEARCH_PROVIDER
    delete process.env.WEB_SEARCH_API_KEY
    const res = await webSearch('灭火器')
    expect(res.available).toBe(false)
    expect(res.results).toEqual([])
    expect(res.reason).toContain('未配置')
  })

  test('未知 provider 返回 available=false', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'unknown-provider'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    const res = await webSearch('灭火器')
    expect(res.available).toBe(false)
    expect(res.reason).toContain('不支持的 provider')
  })

  test('bocha 搜索结果控制字符被去除', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bocha'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          summary: '干粉灭火器\u0000使用\u0001方法',
          webPages: {
            value: [
              {
                name: '干粉灭火器\u0000A型',
                snippet: '用于扑救\u0002初起火灾\u0003',
                url: 'https://example.com/a',
              },
            ],
          },
        },
      },
    } as any)
    const res = await webSearch('灭火器')
    expect(res.available).toBe(true)
    expect(res.results[0].title).not.toMatch(/[\u0000-\u001f]/)
    // 控制字符被替换为空格，再通过 \s+ 合并为单空格
    expect(res.results[0].title).toBe('干粉灭火器 A型')
    expect(res.results[0].snippet).not.toMatch(/[\u0000-\u001f]/)
    expect(res.summary).not.toMatch(/[\u0000-\u001f]/)
  })

  test('title 超过 200 字符被截断', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bocha'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    const longTitle = 'A'.repeat(500)
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          summary: 'summary',
          webPages: { value: [{ name: longTitle, snippet: 's', url: 'https://example.com' }] },
        },
      },
    } as any)
    const res = await webSearch('x')
    expect(res.results[0].title.length).toBe(200)
  })

  test('snippet 超过 500 字符被截断', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bocha'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    const longSnippet = 'B'.repeat(800)
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          summary: 's',
          webPages: { value: [{ name: 't', snippet: longSnippet, url: 'https://example.com' }] },
        },
      },
    } as any)
    const res = await webSearch('x')
    expect(res.results[0].snippet.length).toBe(500)
  })

  test('javascript: URL 被拒绝（scheme 白名单）', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bocha'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          summary: 's',
          webPages: {
            value: [
              { name: 't', snippet: 's', url: 'javascript:alert(1)' },
              { name: 't2', snippet: 's2', url: 'data:text/html,<script>alert(1)</script>' },
              { name: 't3', snippet: 's3', url: 'vbscript:msgbox(1)' },
              { name: 'safe', snippet: 's4', url: 'https://safe.example.com' },
            ],
          },
        },
      },
    } as any)
    const res = await webSearch('x')
    expect(res.results).toHaveLength(1)
    expect(res.results[0].url).toBe('https://safe.example.com/')
  })

  test('非字符串 / 非法 URL 被丢弃，合法项保留', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bocha'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          summary: 's',
          webPages: {
            value: [
              { name: 123, snippet: null, url: 'not a url' },
              { name: 'valid-title', snippet: 'valid-snippet', url: 'https://valid.com' },
            ],
          },
        },
      },
    } as any)
    const res = await webSearch('x')
    expect(res.results).toHaveLength(1)
    expect(res.results[0].title).toBe('valid-title') // 数字被强转空串 → 但整体被 url 非法丢弃
    expect(res.results[0].snippet).toBe('valid-snippet')
  })

  test('URL 超 2048 字符被截断再校验', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bocha'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    const hugeUrl = 'https://example.com/?q=' + 'A'.repeat(3000)
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          summary: 's',
          webPages: { value: [{ name: 't', snippet: 's', url: hugeUrl }] },
        },
      },
    } as any)
    const res = await webSearch('x')
    expect(res.results[0].url.length).toBeLessThanOrEqual(2048 + 20) // URL 序列化可能略增
  })

  test('Tavily 搜索结果走相同清洗流程', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'tavily'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        answer: '答案\u0000',
        results: [
          { title: 'Tavily\u0001Title', content: 'content\u0002', url: 'javascript:bad' },
          { title: 'safe-title', content: 'safe-content', url: 'https://tavily.example.com' },
        ],
      },
    } as any)
    const res = await webSearch('x')
    expect(res.results).toHaveLength(1)
    expect(res.results[0].title).toBe('safe-title')
    expect(res.results[0].snippet).toBe('safe-content')
    expect(res.summary).not.toMatch(/[\u0000-\u001f]/)
  })

  test('SerpAPI 搜索结果走相同清洗流程', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'serpapi'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        answer_box: { answer: '直接答案\u0007' },
        organic_results: [
          { title: 'Serp\u0008', snippet: 'snip', link: 'javascript:x' },
          { title: 'ok-title', snippet: 'ok-snippet', link: 'https://serp.example.com' },
        ],
      },
    } as any)
    const res = await webSearch('x')
    expect(res.results).toHaveLength(1)
    expect(res.results[0].title).toBe('ok-title')
    expect(res.results[0].snippet).toBe('ok-snippet')
    expect(res.summary).not.toMatch(/[\u0000-\u001f]/)
  })

  test('provider 抛错时返回 available=false 含 reason', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bocha'
    process.env.WEB_SEARCH_API_KEY = 'test-key'
    mockedAxios.post.mockRejectedValueOnce(new Error('upstream timeout'))
    const res = await webSearch('x')
    expect(res.available).toBe(false)
    expect(res.reason).toBe('upstream timeout')
  })
})
