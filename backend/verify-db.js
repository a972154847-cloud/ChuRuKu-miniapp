const fs = require('fs');
const path = require('path');

const dbPath = process.argv[2] || './dev.db';
console.log(`Checking database: ${dbPath}`);
console.log(`File size: ${fs.statSync(dbPath).size} bytes`);

const Database = require('better-sqlite3');
const db = new Database(dbPath);

const records = db.prepare('SELECT COUNT(*) as cnt FROM records').get();
const equipments = db.prepare('SELECT COUNT(*) as cnt FROM equipments').get();
const categories = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
const users = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
const migrations = db.prepare('SELECT COUNT(*) as cnt FROM _migrations').get();

console.log(`Records: ${records.cnt}, Equipments: ${equipments.cnt}, Categories: ${categories.cnt}, Users: ${users.cnt}, Migrations: ${migrations.cnt}`);

const firstCategory = db.prepare('SELECT * FROM categories ORDER BY id LIMIT 1').get();
console.log(`First category: ${JSON.stringify(firstCategory)}`);

db.close();