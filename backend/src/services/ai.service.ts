import crypto from 'crypto'
import fs from 'fs'
import axios from 'axios'
import db from '../db'
import { config } from '../config'
import { logger } from '../utils/logger'

/** AI 图片描述结构 */
export interface ImageDescription {
  type: string
  color: string
  material: string
  suspected_name: string
  confidence: number
}

/** AI 匹配结果项 */
export interface EquipmentMatch {
  id: number
  name: string
  confidence: number
}

/** 器材库列表项（带分类名） */
export interface EquipmentListItem {
  id: number
  name: string
  spec: string | null
  category_id: number
  category_name: string | null
}

/** 文字搜索结果项 */
export interface TextSearchItem {
  id: number
  name: string
  spec: string | null
  category_name: string | null
}

/**
 * 图片哈希缓存：内存 LRU Map<hash, description>，max 100。
 * Map 保持插入顺序，访问时删除再 set 刷新顺序，超限删最早。
 */
const IMAGE_CACHE_MAX = 100
const imageCache = new Map<string, ImageDescription>()

function isUrl(p: string): boolean {
  return /^https?:\/\//i.test(p)
}

/**
 * 计算图片文件的 SHA256 哈希（十六进制）。
 * 保留供测试与本地工具使用；describeImage 已不再走本地文件分支。
 */
export function hashImage(imagePath: string): string {
  const buf = fs.readFileSync(imagePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function cacheGet(hash: string): ImageDescription | undefined {
  const v = imageCache.get(hash)
  if (v) {
    // 刷新 LRU 顺序：删除再重新插入
    imageCache.delete(hash)
    imageCache.set(hash, v)
  }
  return v
}

function cacheSet(hash: string, desc: ImageDescription): void {
  if (imageCache.has(hash)) {
    imageCache.delete(hash)
  }
  imageCache.set(hash, desc)
  while (imageCache.size > IMAGE_CACHE_MAX) {
    const firstKey = imageCache.keys().next().value
    if (firstKey === undefined) break
    imageCache.delete(firstKey)
  }
}

/**
 * 从 AI 返回的文本中提取 JSON。
 * 兼容 ```json 代码块、裸 JSON、前后带说明文字等情况。
 */
function extractJson(text: string): unknown {
  if (!text || typeof text !== 'string') {
    throw new Error('AI 返回内容为空')
  }
  // 1. 优先匹配 ```json ... ``` 或 ``` ... ``` 代码块
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : text

  // 2. 找第一个 { 或 [ 作为 JSON 起点
  const start = candidate.search(/[\[{]/)
  if (start < 0) {
    throw new Error('AI 返回内容无可解析 JSON')
  }
  const sub = candidate.slice(start).trim()

  // 3. 先直接尝试整段解析
  try {
    return JSON.parse(sub)
  } catch {
    // 4. 截到最后一个 } 或 ] 再试
    const lastObj = sub.lastIndexOf('}')
    const lastArr = sub.lastIndexOf(']')
    const last = Math.max(lastObj, lastArr)
    if (last > 0) {
      try {
        return JSON.parse(sub.slice(0, last + 1).trim())
      } catch {
        // 继续抛错
      }
    }
    throw new Error('AI 返回内容 JSON 解析失败')
  }
}

/**
 * P0-3: 判断 hostname 是否为内网/保留 IP
 * 支持 IPv4 常见内网段；hostname 非 IP 时返回 false
 */
function isPrivateIp(hostname: string): boolean {
  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = parseInt(v4[1], 10)
    const b = parseInt(v4[2], 10)
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
    if (a === 127) return true // 127.0.0.0/8 loopback
    if (a === 0) return true // 0.0.0.0/8
    return false
  }
  // IPv6 loopback
  if (hostname === '::1' || hostname === '[::1]') return true
  return false
}

/**
 * P0-3: 校验图片 URL，防止 SSRF 和路径穿越
 * - 只允许 https://（开发环境额外允许 http://localhost）
 * - 禁止访问内网 IP：10.x/172.16-31.x/192.168.x/169.254.x/127.x
 * - 若配置了 llmImageAllowedDomains 白名单，hostname 必须在白名单内
 */
function validateImageUrl(input: string): void {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('非法 URL')
  }

  const protocol = parsed.protocol.toLowerCase()
  const hostname = parsed.hostname.toLowerCase()

  if (protocol === 'https:') {
    // https 始终允许
  } else if (protocol === 'http:') {
    // http 仅开发环境且 localhost 允许
    if (config.nodeEnv !== 'development' || hostname !== 'localhost') {
      throw new Error('仅允许 https:// 协议的图片 URL')
    }
  } else {
    throw new Error('仅允许 http(s) 协议的图片 URL')
  }

  // 内网 IP 检查（防 SSRF）
  if (isPrivateIp(hostname)) {
    throw new Error('禁止访问内网 IP 地址')
  }

  // 域名白名单（若配置）
  if (config.llmImageAllowedDomains.length > 0) {
    if (!config.llmImageAllowedDomains.includes(hostname)) {
      throw new Error(`域名 ${hostname} 不在图片识别白名单内`)
    }
  }
}

/**
 * 调用多模态 AI 描述图片。
 * - P0-3: 只接受 http(s) URL 输入，移除本地文件路径分支（防路径穿越/SSRF）
 * - 调用前先查图片哈希缓存
 * - apiKey 未配置时抛错（路由层捕获后返回 503）
 * - axios 超时 8s
 */
export async function describeImage(imageUrl: string): Promise<ImageDescription> {
  if (!config.ai.apiKey) {
    throw new Error('AI 服务未配置 apiKey')
  }

  // P0-3: 只接受 URL 输入，拒绝本地文件路径
  if (!isUrl(imageUrl)) {
    throw new Error('describeImage 只接受 http(s) URL 输入')
  }
  // P0-3: URL 安全校验（协议白名单 + 内网 IP 禁止 + 域名白名单）
  validateImageUrl(imageUrl)

  const cacheKey = crypto.createHash('sha256').update(imageUrl).digest('hex')

  const cached = cacheGet(cacheKey)
  if (cached) {
    logger.info('[ai] describeImage 命中缓存', cacheKey.slice(0, 8))
    return cached
  }

  const messages = [
    {
      role: 'user' as const,
      content: [
        {
          type: 'text',
          text: '请分析这张消防器材照片，返回 JSON 格式：{type, color, material, suspected_name, confidence}',
        },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ]

  const res = await axios.post(
    `${config.ai.baseUrl}/chat/completions`,
    { model: config.ai.model, messages },
    {
      timeout: 8000,
      headers: { Authorization: `Bearer ${config.ai.apiKey}` },
    }
  )
  const content: string = res.data?.choices?.[0]?.message?.content || ''
  const desc = extractJson(content) as ImageDescription
  cacheSet(cacheKey, desc)
  return desc
}

/**
 * 查询所有启用的器材（带分类名）。
 * 供 matchEquipment / semanticSearch 复用。
 * 直接 SQL 查询，避免与 equipment.service.ts 耦合（Task 4.5 并行开发）。
 */
export function listAllEquipments(): EquipmentListItem[] {
  return db
    .prepare(
      `SELECT e.id, e.name, e.spec, e.category_id, c.name as category_name
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.is_active = 1`
    )
    .all() as EquipmentListItem[]
}

/**
 * 调用 AI 用自然语言描述匹配本地器材库，返回 Top 5。
 * - apiKey 未配置时抛错
 * - axios 超时 8s
 */
export async function matchEquipment(description: string): Promise<EquipmentMatch[]> {
  if (!config.ai.apiKey) {
    throw new Error('AI 服务未配置 apiKey')
  }
  const equipments = listAllEquipments()
  const prompt = `用户描述：${description}。请从以下器材清单中找出最匹配的 5 个，返回 JSON 数组：[{id, name, confidence}]\n器材清单：${JSON.stringify(equipments)}`

  const messages = [{ role: 'user' as const, content: prompt }]

  const res = await axios.post(
    `${config.ai.baseUrl}/chat/completions`,
    { model: config.ai.model, messages },
    {
      timeout: 8000,
      headers: { Authorization: `Bearer ${config.ai.apiKey}` },
    }
  )
  const content: string = res.data?.choices?.[0]?.message?.content || ''
  const parsed = extractJson(content)
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed as EquipmentMatch[]
}

/**
 * 本地 LIKE 文字搜索（降级链第 3 层）。
 * - 关键字为空或纯空白返回空数组
 * - 匹配 name 或 spec，按 name 升序，LIMIT 20
 */
export function textSearch(keyword: string): TextSearchItem[] {
  if (!keyword || !keyword.trim()) return []
  return db
    .prepare(
      `SELECT e.id, e.name, e.spec, c.name as category_name
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.is_active = 1 AND (e.name LIKE ? OR e.spec LIKE ?)
       ORDER BY e.name
       LIMIT 20`
    )
    .all(`%${keyword}%`, `%${keyword}%`) as TextSearchItem[]
}

/** 测试辅助：清空图片缓存（不导出给生产路由使用） */
export function _clearImageCache(): void {
  imageCache.clear()
}

export default {
  hashImage,
  describeImage,
  matchEquipment,
  listAllEquipments,
  textSearch,
}