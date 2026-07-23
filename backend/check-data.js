const db = require('./dist/db/index.js').default;

console.log('=== Records ===');
const records = db.prepare('SELECT * FROM records').all();
console.log(`Count: ${records.length}`);
records.slice(0, 5).forEach(r => console.log(JSON.stringify(r)));

console.log('\n=== Equipments ===');
const equipments = db.prepare('SELECT * FROM equipments').all();
console.log(`Count: ${equipments.length}`);
equipments.slice(0, 5).forEach(e => console.log(JSON.stringify(e)));

console.log('\n=== Categories ===');
const categories = db.prepare('SELECT * FROM categories').all();
console.log(`Count: ${categories.length}`);
categories.forEach(c => console.log(JSON.stringify(c)));

console.log('\n=== Record Photos ===');
const photos = db.prepare('SELECT * FROM record_photos').all();
console.log(`Count: ${photos.length}`);

console.log('\n=== Logs ===');
const logs = db.prepare('SELECT * FROM logs').all();
console.log(`Count: ${logs.length}`);
logs.slice(0, 5).forEach(l => console.log(JSON.stringify(l)));