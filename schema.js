const db = require('./db.js');

async function ensureSchema() {
  try {
    const [rows] = await db.query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'allowed_report_types'
    `);
    if (rows && rows[0] && Number(rows[0].cnt) === 0) {
      await db.query(`ALTER TABLE users ADD COLUMN allowed_report_types TEXT NULL`);
      console.log('✅ Added column users.allowed_report_types');
    } else {
      console.log('ℹ️ Column users.allowed_report_types already exists');
    }
  } catch (err) {
    console.error('⚠️ Schema check/add failed:', err.message);
  }
}

module.exports = { ensureSchema };