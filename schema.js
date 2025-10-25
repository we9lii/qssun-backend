const db = require('./db.js');

async function ensureSchema() {
  try {
    // 1) Ensure users.allowed_report_types exists
    const [colCheck] = await db.query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'allowed_report_types'
    `);
    if (colCheck && colCheck[0] && Number(colCheck[0].cnt) === 0) {
      await db.query(`ALTER TABLE users ADD COLUMN allowed_report_types TEXT NULL`);
      console.log('✅ Added column users.allowed_report_types');
    } else {
      console.log('ℹ️ Column users.allowed_report_types already exists');
    }

    // 2) Ensure package_requests table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS package_requests (
        id VARCHAR(32) PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255),
        description TEXT,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(32),
        priority VARCHAR(16),
        status VARCHAR(32),
        progress_percent INT DEFAULT 0,
        customer_location VARCHAR(255),
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Ensured table package_requests exists');

    // 3) Ensure package_attachments table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS package_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        package_id VARCHAR(32) NOT NULL,
        type VARCHAR(32) NOT NULL, -- payment_proof | shipping_doc
        url VARCHAR(1024) NOT NULL,
        file_name VARCHAR(255),
        uploaded_by INT,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(package_id),
        INDEX(uploaded_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Ensured table package_attachments exists');

    // 4) Ensure package_logs table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS package_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        package_id VARCHAR(32) NOT NULL,
        action VARCHAR(64) NOT NULL,
        comment TEXT,
        actor_id INT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(package_id),
        INDEX(actor_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Ensured table package_logs exists');

  } catch (err) {
    console.error('⚠️ Schema check/add failed:', err.message);
  }
}

module.exports = { ensureSchema };