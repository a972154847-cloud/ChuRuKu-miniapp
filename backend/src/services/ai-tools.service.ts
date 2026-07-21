/**
 * AI 工具服务：把现有业务 API 封装成 function calling 工具
 * 大模型根据用户意图调用相应工具，实现 AI 辅助进出库和查找器材
 */
import db from '../db'
import { listCategoriesTree } from './category.service'
import { createRecord, listRecords, attachPhotos } from './record.service'
import { webSearch } from './web-search.service'
import type { LlmTool } from './llm.service'

/** 工具执行上下文（包含当前用户信息） */
export interface ToolContext {
  userId: number
  userRole: string
  userName: string
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean
  data?: any
  message?: string
}

/** 工具定义列表（OpenAI function calling 格式） */
export const AI_TOOLS: LlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_equipments',
      description: '查询器材库存列表，支持按名称关键字搜索。返回器材名称、规格、分类、当前库存量。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '器材名称关键字（可选，不传则返回全部）',
          },
          page: { type: 'number', description: '页码，默认1' },
          pageSize: { type: 'number', description: '每页数量，默认20' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_categories',
      description: '查询器材分类树（一级分类 + 二级子分类）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_records',
      description: '查询出入库记录，支持按类型、关键字、时间范围筛选。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['in', 'out'],
            description: '记录类型：in=入库，out=出库（可选）',
          },
          keyword: { type: 'string', description: '器材名称关键字（可选）' },
          start_date: { type: 'string', description: '开始日期 YYYY-MM-DD（可选）' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
          page: { type: 'number', description: '页码，默认1' },
          pageSize: { type: 'number', description: '每页数量，默认20' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_inbound_record',
      description: '创建入库记录（增加库存）。需要器材名称和数量。如果器材不存在会自动创建。可以附加照片 URL 列表（最多 3 张产品图）。',
      parameters: {
        type: 'object',
        properties: {
          equipment_name: { type: 'string', description: '器材名称' },
          quantity: { type: 'number', description: '入库数量（正整数）' },
          remark: { type: 'string', description: '备注（可选）' },
          photo_urls: {
            type: 'array',
            items: { type: 'string' },
            description: '器材照片 URL 列表（可选，最多 3 张）',
          },
        },
        required: ['equipment_name', 'quantity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索信息。当用户询问外部知识（如消防标准、器材规格、技术参数等）时使用，返回搜索结果摘要。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_outbound_record',
      description: '创建出库记录（减少库存）。需要器材名称和数量。库存不足会失败。',
      parameters: {
        type: 'object',
        properties: {
          equipment_name: { type: 'string', description: '器材名称' },
          quantity: { type: 'number', description: '出库数量（正整数）' },
          recipient: { type: 'string', description: '领用人' },
          purpose: { type: 'string', description: '用途（可选）' },
          expected_return_at: { type: 'string', description: '预计归还日期 YYYY-MM-DD（可选）' },
        },
        required: ['equipment_name', 'quantity', 'recipient'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_equipment_stock',
      description: '查询单个器材的当前库存。通过器材名称精确或模糊匹配。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '器材名称（支持模糊匹配）' },
        },
        required: ['name'],
      },
    },
  },
]

/** 根据器材名称查找器材（精确或 LIKE 匹配） */
function findEquipmentByName(name: string): any[] {
  return db
    .prepare(
      `SELECT e.*, c.name as category_name,
       COALESCE((SELECT SUM(CASE WHEN r.type='in' THEN r.quantity ELSE -r.quantity END)
                 FROM records r WHERE r.equipment_id = e.id), 0) AS current_stock
       FROM equipments e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.name LIKE ?
       ORDER BY e.name ASC
       LIMIT 10`
    )
    .all(`%${name}%`) as any[]
}

/**
 * 执行工具调用
 * @param toolName 工具名称
 * @param argsJson 参数 JSON 字符串
 * @param ctx 执行上下文
 */
export async function executeTool(
  toolName: string,
  argsJson: string,
  ctx: ToolContext
): Promise<ToolResult> {
  let args: any = {}
  try {
    args = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return { success: false, message: '工具参数 JSON 解析失败' }
  }

  try {
    switch (toolName) {
      case 'list_equipments': {
        const keyword = args.keyword as string | undefined
        const page = Number(args.page) || 1
        const pageSize = Number(args.pageSize) || 20
        const where: string[] = []
        const params: unknown[] = []
        if (keyword) {
          where.push('e.name LIKE ?')
          params.push(`%${keyword}%`)
        }
        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''
        const list = db
          .prepare(
            `SELECT e.id, e.name, e.spec, c.name as category_name,
             COALESCE((SELECT SUM(CASE WHEN r.type='in' THEN r.quantity ELSE -r.quantity END)
                       FROM records r WHERE r.equipment_id = e.id), 0) AS current_stock
             FROM equipments e
             LEFT JOIN categories c ON e.category_id = c.id
             ${whereClause}
             ORDER BY e.name ASC
             LIMIT ? OFFSET ?`
          )
          .all(...params, pageSize, (page - 1) * pageSize) as any[]
        return {
          success: true,
          data: { list, page, pageSize, total: list.length },
        }
      }

      case 'list_categories': {
        const tree = listCategoriesTree()
        return { success: true, data: tree }
      }

      case 'search_records': {
        const result = listRecords({
          type: args.type,
          keyword: args.keyword,
          start_date: args.start_date,
          end_date: args.end_date,
          page: Number(args.page) || 1,
          pageSize: Number(args.pageSize) || 20,
        })
        return { success: true, data: result }
      }

      case 'create_inbound_record': {
        const name = String(args.equipment_name || '').trim()
        const quantity = parseInt(String(args.quantity), 10)
        if (!name) return { success: false, message: '器材名称不能为空' }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { success: false, message: '入库数量必须是正整数' }
        }
        // createRecord 会根据 equipment_name 自动查找或创建器材
        const record = createRecord(
          {
            equipment_name: name,
            type: 'in',
            quantity,
            name_source: 'manual',
            remark: args.remark ? String(args.remark) : null,
          },
          ctx.userId
        )
        // 关联照片（可选，最多 3 张）
        const photoUrls = Array.isArray(args.photo_urls)
          ? (args.photo_urls as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0).slice(0, 3)
          : []
        if (photoUrls.length > 0) {
          try {
            attachPhotos(
              record.id,
              photoUrls.map((url, idx) => ({ url, kind: 'product', sort_order: idx }))
            )
          } catch (photoErr) {
            return {
              success: true,
              data: { record, message: `已为「${name}」入库 ${quantity} 件（照片关联失败：${(photoErr as Error).message}）` },
            }
          }
        }
        return {
          success: true,
          data: { record, message: `已为「${name}」入库 ${quantity} 件${photoUrls.length > 0 ? `（含 ${photoUrls.length} 张照片）` : ''}` },
        }
      }

      case 'web_search': {
        const query = String(args.query || '').trim()
        if (!query) return { success: false, message: '搜索关键词不能为空' }
        const result = await webSearch(query)
        if (!result.available) {
          return {
            success: false,
            message: '联网搜索功能未启用（请在后端 .env 中配置搜索 API Key）',
          }
        }
        return {
          success: true,
          data: {
            query,
            summary: result.summary,
            results: result.results.slice(0, 5).map((r) => ({
              title: r.title,
              snippet: r.snippet,
              url: r.url,
            })),
          },
        }
      }

      case 'create_outbound_record': {
        const name = String(args.equipment_name || '').trim()
        const quantity = parseInt(String(args.quantity), 10)
        const recipient = String(args.recipient || '').trim()
        if (!name) return { success: false, message: '器材名称不能为空' }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { success: false, message: '出库数量必须是正整数' }
        }
        if (!recipient) return { success: false, message: '领用人不能为空' }
        // 查找器材（模糊匹配）；多于一个匹配时要求用户精确指定
        const matches = db
          .prepare('SELECT id, name FROM equipments WHERE name LIKE ? ORDER BY name ASC LIMIT 10')
          .all(`%${name}%`) as { id: number; name: string }[]
        if (matches.length === 0) {
          return { success: false, message: `未找到名称包含「${name}」的器材` }
        }
        if (matches.length > 1) {
          return {
            success: false,
            message: `找到 ${matches.length} 个匹配器材，请精确指定：${matches.map((m) => m.name).join(', ')}`,
          }
        }
        const equip = matches[0]
        // 检查库存
        const stock = (
          db
            .prepare(
              `SELECT COALESCE(SUM(CASE WHEN type='in' THEN quantity ELSE -quantity END), 0) as s
               FROM records WHERE equipment_id = ?`
            )
            .get(equip.id) as { s: number }
        ).s
        if (stock < quantity) {
          return {
            success: false,
            message: `「${equip.name}」库存不足：当前 ${stock} 件，需出库 ${quantity} 件`,
          }
        }
        // createRecord 使用 equipment_name 精确匹配，这里传 equip.name
        const record = createRecord(
          {
            equipment_name: equip.name,
            type: 'out',
            quantity,
            name_source: 'manual',
            recipient,
            purpose: args.purpose ? String(args.purpose) : null,
            expected_return_at: args.expected_return_at
              ? String(args.expected_return_at)
              : null,
          },
          ctx.userId
        )
        return {
          success: true,
          data: { record, message: `已从「${equip.name}」出库 ${quantity} 件给 ${recipient}` },
        }
      }

      case 'get_equipment_stock': {
        const name = String(args.name || '').trim()
        if (!name) return { success: false, message: '器材名称不能为空' }
        const list = findEquipmentByName(name)
        if (list.length === 0) {
          return { success: false, message: `未找到名称包含「${name}」的器材` }
        }
        return {
          success: true,
          data: list.map((e) => ({
            id: e.id,
            name: e.name,
            spec: e.spec,
            category: e.category_name,
            current_stock: e.current_stock,
          })),
        }
      }

      default:
        return { success: false, message: `未知工具: ${toolName}` }
    }
  } catch (err) {
    return {
      success: false,
      message: `工具执行失败: ${(err as Error).message}`,
    }
  }
}