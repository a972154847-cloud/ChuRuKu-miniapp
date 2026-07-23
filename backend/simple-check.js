const Database = require('better-sqlite3');
const db = new Database('/opt/app/dev.db');
const c = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
console.log('CATEGORIES:', c.cnt);
const r = db.prepare('SELECT COUNT(*) as cnt FROM records').get();
console.log('RECORDS:', r.cnt);
const e = db.prepare('SELECT COUNT(*) as cnt FROM equipments').get();
console.log('EQUIPMENTS:', e.cnt);
db.close();