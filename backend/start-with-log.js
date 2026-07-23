const fs = require('fs');
const path = require('path');

const dbPath = './dev.db';
console.log(`[DEBUG] Before start: file exists=${fs.existsSync(dbPath)}, size=${fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0}`);

const Database = require('better-sqlite3');
const db = new Database(dbPath);
const categories = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
const migrations = db.prepare('SELECT COUNT(*) as cnt FROM _migrations').get();
console.log(`[DEBUG] Before start: categories=${categories.cnt}, migrations=${migrations.cnt}`);
db.close();

require('./dist/server.js');