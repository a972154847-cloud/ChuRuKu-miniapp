const db = require('./dist/db/index.js').default;
console.log('=== Permissions ===');
console.log(JSON.stringify(db.prepare('SELECT * FROM permissions').all(), null, 2));
console.log('\n=== Role Permissions ===');
console.log(JSON.stringify(db.prepare('SELECT * FROM role_permissions').all(), null, 2));
console.log('\n=== Users ===');
console.log(JSON.stringify(db.prepare('SELECT id, openid, name, role, status FROM users').all(), null, 2));