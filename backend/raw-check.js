const Database = require('better-sqlite3');
const db = new Database('./dev.db');
const records = db.prepare('SELECT COUNT(*) as cnt FROM records').get();
const equipments = db.prepare('SELECT COUNT(*) as cnt FROM equipments').get();
const categories = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
const users = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
console.log(`Records: ${records.cnt}, Equipments: ${equipments.cnt}, Categories: ${categories.cnt}, Users: ${users.cnt}`);
db.close();