/*********************************************************************
 *  auth.js
 *  الموقع: src/routes/auth.js
 *
 *  ما تغير؟
 *   • مسار db.js أصبح مطلقاً (path.resolve) مثلما فعلنا في reports.js.
 *   • تم إضافة تعليقات توضيحية وتعريفات للخطوات داخل الـ login.
 *   • توجيه التحذير عندما تكون كلمة المرور غير مشفّرة.
 *   • إرجاع كائن المستخدم للواجهة الأمامية مع حذف الحقول غير المطلوبة.
 *********************************************************************/

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

/* ── 1️⃣ إعداد مسار db.js ── */
// db.js موجود في جذر src/ (../db.js من داخل routes/)
const dbPath = path.resolve(__dirname, '..', 'db.js');
console.log('🔎 تحميل db من auth.js :', dbPath);

/* تأكّد من وجود الملف قبل الـ require لتفادي MODULE_NOT_FOUND */
try {
  fs.accessSync(dbPath, fs.constants.R_OK);
} catch (e) {
  console.error(`❌ لا يمكن قراءة الملف ${dbPath}. تأكد من وجوده وكتابة اسمه بالحساسيات الخاصة بحروف الملفات.`);
  process.exit(1);
}

/* الآن استورد قاعدة البيانات */
const db = require(dbPath);

/* ── 2️⃣ مسار POST /api/login ── */
router.post('/login', async (req, res) => {
  const { employeeId, password } = req.body;

  // -------- خطوة 0: التحقق من وجود القيم ----------
  if (!employeeId || !password) {
    return res.status(400).json({ message: 'Employee ID and password are required.' });
  }

  try {
    // -------- خطوة 1: جلب المستخدم بواسطة الـ employeeId  ----------
    const [userRows] = await db.query(
      'SELECT * FROM users WHERE username = ?',
      [employeeId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const user = userRows[0];

    // -------- خطوة 2: مقارنة كلمة المرور ----------
    // ملاحظة أمان: في الإنتاج يجب تخزين كلمة المرور مشفّرة (bcrypt, argon2 …)
    if (user.password !== password) {
      console.warn(
        `⚠️  محاولة تسجيل دخول فاشلة للـ employeeId=${employeeId} – كلمة مرور غير صحيحة.`
      );
      return res.status(401).json({ message: 'Incorrect password.' });
    }

    // -------- خطوة 3: الحصول على اسم الفرع (branch) ----------
    let branchName = 'N/A';
    if (user.branch_id) {
      const [branchRows] = await db.query(
        'SELECT name FROM branches WHERE id = ?',
        [user.branch_id]
      );
      if (branchRows.length > 0) {
        branchName = branchRows[0].name;
      }
    }

    // -------- خطوة 4: تكوين كائن المستخدم للواجهة الأمامية ----------
    const userForFrontend = {
      id:               user.id.toString(),
      employeeId:       user.username,
      name:             user.full_name,
      email:            user.email,
      phone:            user.phone,
      role:             user.role,                // Admin / Employee إلخ
      branch:           branchName,
      department:       user.department   || 'N/A',
      position:         user.position     || 'N/A',
      joinDate:         user.created_at,
      employeeType:     user.employee_type || 'Technician',
      hasImportExportPermission: !!user.has_import_export_permission,
      isFirstLogin:    !!user.is_first_login,
    };

    // لا نعيد الحقول الحساسة (مثل password, reset_token …)
    res.json(userForFrontend);

  } catch (err) {
    // -------- معالجة الأخطاء العامة ----------
    console.error('❌ Login error:', err);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});

/* ── تصدير الـ router ── */
module.exports = router;
