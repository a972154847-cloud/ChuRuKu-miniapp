import 'dotenv/config'
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import app from './app'
import { config } from './config'
import { runMigrations } from './db/migrate'

runMigrations()

// HTTPS 证书配置（微信小程序基础库 3.8.7+ 禁止加载 HTTP 图片）
// 证书由 mkcert 生成，已将本地 CA 安装到系统信任存储
const certDir = path.resolve(__dirname, '..', 'certs')
const certFile = path.join(certDir, 'cert.pem')
const keyFile = path.join(certDir, 'key.pem')
const hasCerts = fs.existsSync(certFile) && fs.existsSync(keyFile)

/**
 * P1-13 安全修复：
 * - 生产环境必须 HTTPS，证书不存在直接 throw（拒绝启动）
 * - 但若有 BEHIND_PROXY=true 环境变量（如 Docker + Nginx 反代），则允许 HTTP
 * - 开发环境允许回退到 HTTP，但 warn 提示
 * - 启动时打印实际协议和端口
 */
const behindProxy = process.env.BEHIND_PROXY === 'true' || process.env.BEHIND_PROXY === '1'

if (config.nodeEnv === 'production') {
  if (!hasCerts) {
    if (behindProxy) {
      // Docker + Nginx 反代场景，后端跑内部 HTTP
      console.log('[server] 生产环境（反向代理模式），使用 HTTP')
      app.listen(config.port, '0.0.0.0', () => {
      console.log(`HTTP Server running on http://0.0.0.0:${config.port}`)
    })
    } else {
      throw new Error(
        '[server] 生产环境必须配置 HTTPS 证书（certs/cert.pem、certs/key.pem）或设置 BEHIND_PROXY=true'
      )
    }
  } else {
    const httpsOptions = {
      cert: fs.readFileSync(certFile),
      key: fs.readFileSync(keyFile),
    }
    https.createServer(httpsOptions, app).listen(config.port, () => {
      console.log(`HTTPS Server running on https://localhost:${config.port}`)
    })
  }
} else if (hasCerts) {
  const httpsOptions = {
    cert: fs.readFileSync(certFile),
    key: fs.readFileSync(keyFile),
  }
  // HTTPS 服务（微信小程序图片加载需要）
  https.createServer(httpsOptions, app).listen(config.port, '0.0.0.0', () => {
      console.log(`HTTPS Server running on https://0.0.0.0:${config.port}`)
    })
    http.createServer(app).listen(config.port + 1, '0.0.0.0', () => {
      console.log(`HTTP Server running on http://0.0.0.0:${config.port + 1}`)
    })
  } else {
    console.warn('⚠️  未找到 HTTPS 证书（certs/cert.pem、certs/key.pem），回退到 HTTP')
    console.warn('   微信小程序基础库 3.8.7+ 禁止加载 HTTP 图片，请运行：node scripts/gen-cert.js')
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`HTTP Server running on http://0.0.0.0:${config.port}`)
    })
  }