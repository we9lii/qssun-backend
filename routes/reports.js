/*********************************************************************
 *  reports.js
 *  الموقع: src/routes/reports.js
 *
 *  ما تغير؟
 *   • مسار supabaseClient.js أصبح داخل نفس المجلد (routes).
 *   • إبقاء مسار db.js في جذور src/.
 *   • طباعة المسارات في السجلات لتسهيل الفحص.
 *   • فحص وجود الملفات قبل الـ require لتفادي MODULE_NOT_FOUND.
 *********************************************************************/

const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

/* ── 1️⃣ إعداد مسارات الوحدات ── */
// db.js في الجذر src/
const dbPath = path.resolve(__dirname, '..', 'db.js');
// supabaseClient.js داخل نفس المجلد routes
const supabasePath = path.resolve(__dirname, 'supabaseClient.js');

console.log('🔎 تحميل db من       :', dbPath);
console.log('🔎 تحميل supabase من :', supabasePath);

/* ── تأكّد من وجود الملفات ── */
[dbPath, supabasePath].forEach(p => {
  try {
    fs.accessSync(p, fs.constants.R_OK);
  } catch (e) {
    console.error(`❌ لا يمكن قراءة الملف ${p}. تأكد من وجوده وكتابة اسمه بالحساسيتة للـ case`);
    process.exit(1);
  }
});

/* ── استيراد الوحدات بعد الفحص ── */
const db = require(dbPath);                     // قاعدة البيانات
const { supabase } = require(supabasePath);    // عميل Supabase

/* ── 2️⃣ إعداد Multer (ملفات في الذاكرة) ── */
const storage = multer.memoryStorage();
const upload  = multer({ storage });

/* ── 3️⃣ رفع ملف إلى Supabase ── */
const uploadFileToSupabase = async (file, employeeId) => {
  const filePath = `public/${employeeId}/${Date.now()}-${file.originalname}`;

  const { error } = await supabase.storage
    .from('report-attachments')
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase upload error: ${error.message}`);
  }

  const { data } = supabase.storage
    .from('report-attachments')
    .getPublicUrl(filePath);

  return data.publicUrl;
};

/* ── 4️⃣ مسارات الـ API ─────────────────────────────────────────────── */

/* ---------- GET /api/reports ---------- */
router.get('/reports', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM reports ORDER BY date DESC');

    const reports = rows.map(r => ({
      id: r.id.toString(),
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      branch: r.branch,
      department: r.department,
      type: r.type,
      date: r.date,
      status: r.status,
      details: r.details ? JSON.parse(r.details) : {},
      evaluation: r.evaluation ? JSON.parse(r.evaluation) : undefined,
      modifications: r.modifications ? JSON.parse(r.modifications) : undefined,
    }));

    res.json(reports);
  } catch (err) {
    console.error('❌ Error fetching reports:', err);
    res.status(500).json({ message: 'خطأ داخلي أثناء جلب التقارير.' });
  }
});

/* ---------- POST /api/reports ---------- */
router.post('/reports', upload.any(), async (req, res) => {
  try {
    if (!req.body.reportData) {
      return res.status(400).json({ message: 'حقل reportData مفقود.' });
    }

    const reportData = JSON.parse(req.body.reportData);
    const details    = reportData.details || {};
    const employeeId = reportData.employeeId;

    // رفع المرفقات إن وجدت
    if (req.files && req.files.length > 0) {
      const beforeFiles = req.files.filter(f => f.fieldname === 'beforeImages');
      const afterFiles  = req.files.filter(f => f.fieldname === 'afterImages');

      const beforeUrls = await Promise.all(
        beforeFiles.map(f => uploadFileToSupabase(f, employeeId))
      );
      const afterUrls = await Promise.all(
        afterFiles.map(f => uploadFileToSupabase(f, employeeId))
      );

      if (reportData.type === 'Maintenance') {
        details.beforeImages = beforeUrls;
        details.afterImages  = afterUrls;
      }
    }

    // إدخال السجل في قاعدة البيانات
    const newReport = {
      employee_id:   reportData.employeeId,
      employee_name: reportData.employeeName,
      branch:        reportData.branch,
      department:    reportData.department,
      type:          reportData.type,
      date:          reportData.date,
      status:        reportData.status,
      details:       JSON.stringify(details),
    };

    const [insertResult] = await db.query('INSERT INTO reports SET ?', newReport);
    const insertId = insertResult.insertId;

    const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [insertId]);

    const created = {
      id: rows[0].id.toString(),
      employeeId: rows[0].employee_id,
      employeeName: rows[0].employee_name,
      branch: rows[0].branch,
      department: rows[0].department,
      type: rows[0].type,
      date: rows[0].date,
      status: rows[0].status,
      details: JSON.parse(rows[0].details),
      evaluation: rows[0].evaluation ? JSON.parse(rows[0].evaluation) : undefined,
      modifications: rows[0].modifications ? JSON.parse(rows[0].modifications) : undefined,
    };

    res.status(201).json(created);
  } catch (err) {
    console.error('❌ Error creating report:', err);
    res.status(500).json({ message: 'خطأ داخلي أثناء إنشاء التقرير.' });
  }
});

/* ---------- PUT /api/reports/:id ---------- */
router.put('/reports/:id', async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  // لا يُسمح بتغيير المعرف أو هوية الموظف
  delete updates.id;
  delete updates.employeeId;

  const dbPayload = {
    employee_name: updates.employeeName,
    branch:        updates.branch,
    department:    updates.department,
    type:          updates.type,
    date:          updates.date,
    status:        updates.status,
    details:       updates.details ? JSON.stringify(updates.details) : undefined,
    evaluation:    updates.evaluation ? JSON.stringify(updates.evaluation) : null,
    modifications: updates.modifications ? JSON.stringify(updates.modifications) : null,
  };

  // حذف القيم undefined لتفادي كتابة null في القاعدة
  Object.keys(dbPayload).forEach(k => dbPayload[k] === undefined && delete dbPayload[k]);

  try {
    const [result] = await db.query('UPDATE reports SET ? WHERE id = ?', [dbPayload, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'التقرير غير موجود.' });
    }

    const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [id]);

    const updated = {
      id: rows[0].id.toString(),
      employeeId: rows[0].employee_id,
      employeeName: rows[0].employee_name,
      branch: rows[0].branch,
      department: rows[0].department,
      type: rows[0].type,
      date: rows[0].date,
      status: rows[0].status,
      details: JSON.parse(rows[0].details),
      evaluation: rows[0].evaluation ? JSON.parse(rows[0].evaluation) : undefined,
      modifications: rows[0].modifications ? JSON.parse(rows[0].modifications) : undefined,
    };

    res.json(updated);
  } catch (err) {
    console.error('❌ Error updating report:', err);
    res.status(500).json({ message: 'خطأ داخلي أثناء تعديل التقرير.' });
  }
});

/* ── تصدير الـ router ── */
module.exports = router;
