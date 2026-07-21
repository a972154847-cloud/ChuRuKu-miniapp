/**
 * 公共工具函数 — 消除路由/服务层重复定义
 */

/** 安全解析整数，非法值返回默认值 */
export function toInt(v: unknown, def: number): number {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : def
}

/** 安全转字符串，空值/空白返回 undefined */
export function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s || undefined
}

/** pageSize 夹紧到 [1, 100] 区间，避免恶意传入超大值拖慢分页查询 */
export function safePageSize(v: unknown, def: number): number {
  const n = toInt(v, def)
  return Math.min(Math.max(n, 1), 100)
}
