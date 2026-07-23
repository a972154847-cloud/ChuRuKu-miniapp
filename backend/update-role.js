const db = require('./dist/db/index.js').default;
db.prepare("UPDATE users SET role = 'admin', updated_at = datetime('now','+8 hours') WHERE id = ?").run(2);
const users = db.prepare('SELECT * FROM users').all();
console.log('当前用户:', JSON.stringify(users, null, 2));