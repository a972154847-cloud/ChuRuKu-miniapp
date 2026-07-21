import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { config } from './config'
import { notFound, errorHandler } from './middlewares/error'

import authRoutes from './routes/auth.routes'
import usersRoutes from './routes/users.routes'
import recordsRoutes from './routes/records.routes'
import equipmentsRoutes from './routes/equipments.routes'
import categoriesRoutes from './routes/categories.routes'
import aiRoutes from './routes/ai.routes'
import uploadRoutes from './routes/upload.routes'
import dashboardRoutes from './routes/dashboard.routes'
import logsRoutes from './routes/logs.routes'

const app = express()

// 基础中间件
app.use(helmet())
// P1-14: CORS 白名单校验，不再使用通配符 *
app.use(
  cors({
    origin: (origin, callback) => {
      // 允许同源请求（无 Origin 头，如服务器端请求或小程序直连）
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
  })
)
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// P1-11: 全局速率限制，100 req/min per IP，应用在所有 /api 路由前
// test 环境跳过限流，避免批量测试触发 429
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === 'test',
  message: { code: 429, message: '请求过于频繁，请稍后再试' },
})
app.use('/api', globalLimiter)

// 静态文件（图片/视频等）
// 添加跨域头，确保小程序 Image 组件能从局域网 IP 加载图片
// P0-5: 添加 X-Content-Type-Options: nosniff 防止浏览器 MIME 嗅探
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  },
  express.static(config.uploadDir, {
    maxAge: '7d',
    immutable: true,
  })
)

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({
    code: 0,
    message: 'ok',
    data: { status: 'up', time: new Date().toISOString() },
  })
})

// 路由挂载（全部前缀 /api）
app.use('/api/auth', authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/records', recordsRoutes)
app.use('/api/equipments', equipmentsRoutes)
app.use('/api/categories', categoriesRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/logs', logsRoutes)

// 错误处理
app.use(notFound)
app.use(errorHandler)

export default app