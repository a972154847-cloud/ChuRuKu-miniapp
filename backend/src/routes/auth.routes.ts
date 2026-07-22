import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { isWxLoginTimeout, wxLogin, signToken } from '../middlewares/auth'
import { loginOrRegister, devLogin } from '../services/auth.service'
import { writeLog } from '../services/log.service'
import { config } from '../config'

const router = Router()

// P1-11: 登录端点限流，5 req/min per IP
// test 环境跳过限流，避免批量测试触发 429
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === 'test',
  message: { code: 429, message: '登录请求过于频繁，请稍后再试' },
})

/**
 * POST /login 微信登录
 * Body: { code, nickname?, avatar? }
 */
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { code, nickname, avatar } = req.body || {}
  if (!code) {
    res.status(400).json({ code: 400, message: '缺少 code 参数' })
    return
  }
  try {
    const wxResult = await wxLogin(code)
    const user = loginOrRegister(wxResult.openid, { name: nickname, avatar })
    const token = signToken(user)
    res.json({ code: 0, message: 'ok', data: { token, user } })
  } catch (e) {
    const error = e as {
      code?: unknown
      response?: { status?: unknown }
    }
    const timedOut = isWxLoginTimeout(e)
    // 仅输出可诊断的传输元数据，避免 code、token、微信密钥或用户信息进入日志。
    console.error('[auth] wxLogin failed', {
      category: timedOut ? 'timeout' : 'upstream_error',
      axiosCode: typeof error.code === 'string' ? error.code : undefined,
      upstreamStatus:
        typeof error.response?.status === 'number' ? error.response.status : undefined,
    })
    // P1-12: 登录失败写审计日志（user_id=null，记录 IP/UA 便于追溯暴力破解）
    writeLog({
      actorId: null,
      action: 'login_failed',
      entity: 'user',
      entityId: null,
      ip: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    })
    const status = timedOut ? 504 : 502
    res.status(status).json({
      code: status,
      message: timedOut ? '微信登录服务响应较慢，请稍后重试' : '微信登录失败',
    })
  }
})

/**
 * POST /dev-login 开发环境登录（生产环境返回 404，不暴露端点存在）
 * Body: { openid?, name? }
 * P0-2: 强制 role 为 viewer，需要 admin 时手动改 DB
 * 允许 test 环境使用（原有测试依赖 dev-login 获取 token）
 */
router.post('/dev-login', (req: Request, res: Response) => {
  // P0-2: 生产环境直接 404，不暴露端点存在；development/test 环境可用
  if (config.nodeEnv !== 'development' && config.nodeEnv !== 'test') {
    res.status(404).json({ error: 'Not found' })
    return
  }
  // test 环境允许传入 role 以便测试权限控制（development 环境传 role 也会被 devLogin 强制降级为 viewer）
  // V-3 安全修复：test 环境下 role 覆盖需 ?override=true 显式 opt-in
  const { openid, name, role } = req.body || {}
  const allowRoleOverride = req.query.override === 'true'
  try {
    const user = devLogin({
      openid,
      name,
      role,
      allowRoleOverride,
    })
    const token = signToken(user)
    res.json({ code: 0, message: 'ok', data: { token, user } })
  } catch (e) {
    res.status(400).json({ code: 400, message: (e as Error).message })
  }
})

export default router
