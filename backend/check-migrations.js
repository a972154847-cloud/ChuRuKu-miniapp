const db = require('./dist/db/index.js').default;
const migrations = db.prepare('SELECT * FROM _migrations ORDER BY id').all();
console.log('=== Migrations ===');
console.log(JSON.stringify(migrations, null, 2));