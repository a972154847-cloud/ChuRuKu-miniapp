const http = require('http')

function testUrl(p, token) {
  return new Promise((resolve) => {
    const req = http.get(
      'http://localhost:3000' + p,
      { headers: { Authorization: 'Bearer ' + token } },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, body: d }))
      }
    )
    req.on('error', (e) => resolve({ error: e.message }))
  })
}

function parseTotal(r) {
  if (!r || !r.body) return 'err'
  try {
    return JSON.parse(r.body).data.total
  } catch (e) {
    return 'parse_err'
  }
}

async function main() {
  const loginData = JSON.stringify({ openid: 'dev-openid', name: 'dev', role: 'admin' })
  const token = await new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/dev-login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) },
      },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          try { resolve(JSON.parse(d).data.token) } catch (e) { resolve(null) }
        })
      }
    )
    req.write(loginData)
    req.end()
  })
  console.log('Token:', token ? 'OK' : 'FAIL')
  if (!token) return

  const r1 = await testUrl('/api/records?page=1&pageSize=20', token)
  console.log('all type:', r1.status, parseTotal(r1))

  const r2 = await testUrl('/api/records?type=in&page=1&pageSize=20', token)
  console.log('in:', r2.status, parseTotal(r2))

  const r3 = await testUrl('/api/records?type=out&page=1&pageSize=20', token)
  console.log('out:', r3.status, parseTotal(r3))

  const r4 = await testUrl('/api/records?keyword=test&page=1&pageSize=20', token)
  console.log('keyword:', r4.status, parseTotal(r4))

  const r5 = await testUrl('/api/records?start_date=2026-07-01&end_date=2026-07-31&page=1&pageSize=20', token)
