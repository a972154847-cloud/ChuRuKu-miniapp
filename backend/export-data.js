const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('./dev.db');

const users = db.prepare('SELECT * FROM users').all();
const categories = db.prepare('SELECT * FROM categories').all();
const equipments = db.prepare('SELECT * FROM equipments').all();
const records = db.prepare('SELECT * FROM records').all();
const photos = db.prepare('SELECT * FROM record_photos').all();

console.log(`Users: ${users.length}`);
console.log(`Categories: ${categories.length}`);
console.log(`Equipments: ${equipments.length}`);
console.log(`Records: ${records.length}`);
console.log(`Photos: ${photos.length}`);

const data = { users, categories, equipments, records, photos };
fs.writeFileSync('./data-export.json', JSON.stringify(data, null, 2));
console.log('Data exported to data-export.json');

db.close();