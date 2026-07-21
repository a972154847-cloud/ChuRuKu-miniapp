/**
 * 生成自签名 HTTPS 证书（开发环境用）
 * 包含 SAN：192.168.101.65、localhost、127.0.0.1
 *
 * 使用方法：node scripts/gen-cert.js
 * 输出文件：certs/cert.pem、certs/key.pem
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CERT_DIR = path.resolve(__dirname, '..', 'certs')
const CERT_FILE = path.join(CERT_DIR, 'cert.pem')
const KEY_FILE = path.join(CERT_DIR, 'key.pem')

// 确保输出目录存在
if (!fs.existsSync(CERT_DIR)) {
  fs.mkdirSync(CERT_DIR, { recursive: true })
}

// 1. 生成 RSA 私钥
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

// 2. 构造证书请求（CSR）信息
// 使用 Node.js 内置的 X509 证书生成能力（Node 19+ 支持 crypto.X509Certificate）
// 由于 Node 24 的 crypto 模块不直接提供 createX509，我们用 asn1 手工构造
// 更简单的方式：使用 openssl 命令行（Node 自带 openssl 但不暴露 CLI）

// 实际方案：用 Node 的 crypto.sign + 手工构造 ASN.1 太复杂
// 改用 selfsigned 包（无需安装，纯 JS 实现）
try {
  // 动态 require selfsigned（如果已安装）
  const selfsigned = require('selfsigned')
  const attrs = [
    { name: 'commonName', value: '192.168.101.65' },
    { name: 'organizationName', value: 'Dev Local' }
  ]
  const sanDomains = ['192.168.101.65', 'localhost', '127.0.0.1', '::1']
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: sanDomains.map((v) => {
          if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
            return { type: 7, ip: v } // IP
          }
          if (v.includes(':')) {
            return { type: 6, ip: v } // IPv6
          }
          return { type: 2, value: v } // DNS
        })
      },
      { name: 'basicConstraints', cA: false },
      {
        name: 'keyUsage',
        keyCertSign: false,
        digitalSignature: true,
        keyEncipherment: true
      },
      { name: 'extKeyUsage', serverAuth: true }
    ]
  })
  fs.writeFileSync(CERT_FILE, pems.cert, { mode: 0o644 })
  fs.writeFileSync(KEY_FILE, pems.private, { mode: 0o600 })
  console.log('✅ 证书生成成功（selfsigned）：')
  console.log('   证书：', CERT_FILE)
  console.log('   私钥：', KEY_FILE)
  console.log('   SAN：', sanDomains.join(', '))
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('⚠️  selfsigned 未安装，尝试用 openssl 命令行生成...')
    const { execSync } = require('child_process')
    try {
      // 用 openssl 配置文件方式生成（带 SAN）
      const confFile = path.join(CERT_DIR, 'openssl.cnf')
      const conf = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no
[req_distinguished_name]
CN = 192.168.101.65
O = Dev Local
[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[alt_names]
DNS.1 = 192.168.101.65
DNS.2 = localhost
IP.1 = 192.168.101.65
IP.2 = 127.0.0.1
IP.3 = ::1
`.trim()
      fs.writeFileSync(confFile, conf)

      const opensslBin = process.env.OPENSSL_BIN || 'openssl'
      execSync(`"${opensslBin}" req -x509 -newkey rsa:2048 -nodes -keyout "${KEY_FILE}" -out "${CERT_FILE}" -days 3650 -config "${confFile}" -extensions v3_req`, { stdio: 'inherit' })
      console.log('✅ 证书生成成功（openssl）：')
      console.log('   证书：', CERT_FILE)
      console.log('   私钥：', KEY_FILE)
    } catch (e2) {
      console.error('❌ openssl 命令也失败：', e2.message)
      console.error('请手动安装 mkcert 或 openssl，或运行：npm install selfsigned')
      process.exit(1)
    }
  } else {
    console.error('❌ 生成证书失败：', e)
    process.exit(1)
  }
}
