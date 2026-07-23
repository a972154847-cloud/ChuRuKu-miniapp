const db = require('./dist/db/index.js').default;
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
try {
  db.prepare(`INSERT OR REPLACE INTO users (id, openid, name, role, avatar, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    1, 'e2e-test-admin-001', '开发者', 'admin', null, now, now, 'active'
  );
  console.log('用户创建成功');
} catch (e) {
  console.error('创建用户失败:', e.message);
}
const users = db.prepare('SELECT * FROM users').all();
console.log('当前用户:', JSON.stringify(users, null, 2));