const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('/opt/app/dev.db');
const data = JSON.parse(fs.readFileSync('/opt/app/data-export.json', 'utf-8'));

db.pragma('foreign_keys = OFF');

console.log('Importing users...');
db.prepare('DELETE FROM users').run();
const insertUser = db.prepare('INSERT INTO users (id, openid, name, role, avatar, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
data.users.forEach(u => {
  insertUser.run(u.id, u.openid, u.name, u.role, u.avatar, u.created_at, u.updated_at, u.status || 'active');
});

console.log('Importing categories...');
db.prepare('DELETE FROM categories').run();
const insertCategory = db.prepare('INSERT INTO categories (id, parent_id, code, name, level, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
data.categories.forEach(c => {
  insertCategory.run(c.id, c.parent_id, c.code, c.name, c.level, c.sort_order, c.created_at);
});

console.log('Importing equipments...');
db.prepare('DELETE FROM equipments').run();
const insertEquipment = db.prepare('INSERT INTO equipments (id, name, category_id, spec, image_url, scrap_years, threshold, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
data.equipments.forEach(e => {
  insertEquipment.run(e.id, e.name, e.category_id, e.spec, e.image_url, e.scrap_years, e.threshold, e.is_active, e.created_at, e.updated_at);
});

console.log('Importing records...');
db.prepare('DELETE FROM records').run();
const insertRecord = db.prepare('INSERT INTO records (id, equipment_id, type, quantity, operator_id, produced_at, location_photo_url, ai_source, name_source, recipient, purpose, expected_return_at, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
data.records.forEach(r => {
  insertRecord.run(r.id, r.equipment_id, r.type, r.quantity, r.operator_id, r.produced_at, r.location_photo_url, r.ai_source, r.name_source, r.recipient, r.purpose, r.expected_return_at, r.remark, r.created_at, r.updated_at);
});

console.log('Importing record_photos...');
db.prepare('DELETE FROM record_photos').run();
const insertPhoto = db.prepare('INSERT INTO record_photos (id, record_id, url, kind, annotation_json, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
data.photos.forEach(p => {
  insertPhoto.run(p.id, p.record_id, p.url, p.kind || 'product', p.annotation_json, p.sort_order || 0, p.created_at);
});

db.pragma('foreign_keys = ON');
db.close();

console.log('Data import completed!');