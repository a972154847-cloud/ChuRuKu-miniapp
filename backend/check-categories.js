const Database = require('better-sqlite3');
const db = new Database('/opt/app/dev.db');
console.log('Categories count:', db.prepare('SELECT COUNT(*) as cnt FROM categories').get());
console.log('First 5 categories:', db.prepare('SELECT name FROM categories ORDER BY id LIMIT 5').all());
db.close();