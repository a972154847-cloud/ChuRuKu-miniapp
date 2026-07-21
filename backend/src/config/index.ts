/** 根据 provider 返回默认的对话模型（function calling 文本模型） */
function defaultChatModel(provider: string): string {
  switch (provider) {
    case 'deepseek':
      return 'deepseek-chat'
    case 'openai':
      return 'gpt-4o-mini'
    case 'bigmodel':
      return 'glm-4-flash'
    case 'qwen':
    default:
      return 'qwen-plus'
  }
}

/** 根据 provider 返回默认的 baseUrl */
function defaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'deepseek':
      return 'https://api.deepseek.com/v1'
    case 'openai':
      return 'https://api.openai.com/v1'
    case 'bigmodel':
      return 'https://open.bigmodel.cn/api/coding/paas/v4'
    case 'qwen':
    default:
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  }
}

const AI_PROVIDER = process.env.AI_PROVIDER || 'qwen' // qwen | deepseek | openai | bigmodel

/**
 * JWT_SECRET 启动校验：
 * - 生产环境必须显式配置且长度 >= 32 字符，否则直接 throw（拒绝启动）
 * - 开发环境允许回退到弱默认值，但 console.warn 警告
 */
function resolveJwtSecret(): string {
  const raw = process.env.JWT_SECRET || ''
  const isProd = (process.env.NODE_ENV || 'development') === 'production'
  if (isProd) {
    if (!raw || raw.length < 32) {
      throw new Error(
        '[config] 生产环境必须配置 JWT_SECRET 环境变量且长度 >= 32 字符'
      )
    }
    return raw
  }
  if (!raw) {
    console.warn(
      '[config] 警告：JWT_SECRET 未配置，使用弱默认值。生产环境必须配置强随机串（>= 32 字符）'
    )
    return 'dev-secret-change-me'
  }
  return raw
}

/** 解析逗号分隔字符串为去重、去空白后的数组 */
function parseList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  )
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || './dev.db',
  jwtSecret: resolveJwtSecret(),
  // P1-10: accessToken 有效期缩短为 2h；refreshToken 7d（refresh 端点留待下轮）
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  // P1-14: CORS 白名单，逗号分隔；默认仅允许本地开发域名
  corsOrigins: parseList(process.env.CORS_ORIGINS || 'http://localhost:3000'),
  // P0-3: AI 图片描述允许的域名白名单，逗号分隔；空数组表示允许所有 https 域名
  llmImageAllowedDomains: parseList(process.env.LLM_IMAGE_ALLOWED_DOMAINS || ''),
  wxAppId: process.env.WX_APP_ID || '',
  wxAppSecret: process.env.WX_APP_SECRET || '',
  ai: {
    provider: AI_PROVIDER,
    baseUrl: process.env.AI_BASE_URL || defaultBaseUrl(AI_PROVIDER),
    apiKey: process.env.AI_API_KEY || '',
    // 对话/function calling 用文本模型；若用户显式指定 AI_CHAT_MODEL 优先使用
    chatModel: process.env.AI_CHAT_MODEL || defaultChatModel(AI_PROVIDER),
    // 视觉识别模型（旧配置兼容）
    model: process.env.AI_MODEL || 'qwen-vl-max',
  },
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  lowStockThreshold: parseInt(process.env.LOW_STOCK_THRESHOLD || '5', 10),
}

export default config