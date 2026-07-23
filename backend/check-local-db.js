const sqlite3 = require('better-sqlite3');
const db = sqlite3('./dev.db');
console.log('=== Users ===');
const users = db.prepare('SELECT * FROM users').all();
console.log(JSON.stringify(users, null, 2));
console.log('\n=== Tables ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(JSON.stringify(tables, null, 2));