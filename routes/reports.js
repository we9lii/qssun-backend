// src/routes/reports.js
/*********************************************************************
 *  GET  /api/reports    → إرجاع جميع التقارير
 *  POST /api/reports    → إنشاء تقرير (مع رفع مرفقات إلى Supabase)
 *  PUT  /api/reports/:id → تعديل النص أو الحالة فقط
 *********************************************************************/

const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const path    = require('path');
const db      = require(path.resolve(__dirname, '..', 'db.js'));
const { supabase } = require(path.resolve(__dirname, 'supabaseClient.js'));

/* ---------- Multer (الملفات تُحفظ في الذاكرة) ---------- */
const storage = multer.memoryStorage();
const upload  = multer({ storage });

/* ---------- رفع ملف إلى Supabase ---------- */
const uploadFileToSupabase = async (file, userId) => {
  const filePath = `public/${userId}/${Date.now()}-${file.originalname}`;

  const { error } = await supabase.storage
    .from('report-attachments')
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) throw new Error(`Supabase upload error: ${error.message}`);

  const { data } = supabase.storage.from('report-attachments').getPublicUrl(filePath);
  return data.publicUrl;
};

/* ---------- GET /reports ---------- */
router.get('/reports', async (req, res) => {
  try {
    /* استعلام يطابق الأعمدة الموجودة في جدول `reports` */
    const [rows] = await db.query(`
      SELECT r.id,
             r.user_id        AS employeeId,
             u.full_name      AS employeeName,
             b.name           AS branch,
             r.report_type    AS type,
             r.content        AS details,      -- قد تكون JSON أو نص
             r.status,
             r.created_at     AS date
      FROM reports r
      LEFT JOIN users    u ON r.user_id   = u.id
      LEFT JOIN branches b ON r.branch_id = b.id
      ORDER BY r.created_at DESC
    `);

    const reports = rows.map(r => ({
      id: r.id.toString(),
      employeeId: r.employeeId?.toString() || null,
      employeeName: r.employeeName,
      branch: r.branch || 'N/A',
      type: r.type,
      date: r.date,
      status: r.status,
      // إذا كان `content` يحتوي على JSON صالح نحوله، وإلا نعيده كنص
      details: (() => {
        try { return r.details ? JSON.parse(r.details) : {}; }
        catch (_) { return r.details || {}; }
      })(),
      evaluation: undefined,
      modifications: undefined,
    }));

    res.json(reports);
  } catch (err) {
    console.error('Error fetching reports:', err);   // ستظهر في Render logs
    res.status(500).json({ message: 'Failed to fetch reports' });
  }
});

/* ---------- POST /reports ---------- */
router.post('/reports', upload.any(), async (req, res) => {
  try {
    if (!req.body.reportData) {
      return res.status(400).json({ message: 'reportData is missing.' });
    }

    const reportData = JSON.parse(req.body.reportData);
    const {
      employeeId,      // يتوافق مع `user_id`
      branchId,        // يتوافق مع `branch_id`
      reportType,      // يتوافق مع `report_type`
      status,
      content          // قد يكون نصًا أو كائن JSON
    } = reportData;

    // ---------- رفع مرفقات إذا وجدت ----------
    let finalContent = content;
    if (req.files && req.files.length > 0) {
      const attachmentUrls = await Promise.all(
        req.files.map(file => uploadFileToSupabase(file, employeeId))
      );

      // إذا كان content كائن JSON، نضيف المرفقات داخله
      if (typeof content === 'object' && content !== null) {
        content.attachments = attachmentUrls;
        finalContent = JSON.stringify(content);
      } else {
        // إذا كان نصًا عاديًا نحوله إلى كائن يحتوي على النص + المرفقات
        finalContent = JSON.stringify({ text: content, attachments: attachmentUrls });
      }
    } else if (typeof content === 'object') {
      finalContent = JSON.stringify(content);
    }

    const newReport = {
      user_id:      employeeId,
      branch_id:    branchId,
      report_type:  reportType,
      content:      finalContent,
      status:       status,
    };

    const [result] = await db.query('INSERT INTO reports SET ?', newReport);
    const insertId = result.insertId;

    // ---------- إرجاع التقرير الذي تم إنشاؤه ----------
    const [rows] = await db.query(`
      SELECT r.id,
             r.user_id        AS employeeId,
             u.full_name      AS employeeName,
             b.name           AS branch,
             r.report_type    AS type,
             r.content        AS details,
             r.status,
             r.created_at     AS date
      FROM reports r
      LEFT JOIN users    u ON r.user_id   = u.id
      LEFT JOIN branches b ON r.branch_id = b.id
      WHERE r.id = ?
    `, [insertId]);

    const r = rows[0];
    const created = {
      id: r.id.toString(),
      employeeId: r.employeeId?.toString() || null,
      employeeName: r.employeeName,
      branch: r.branch || 'N/A',
      type: r.type,
      date: r.date,
      status: r.status,
      details: (() => {
        try { return r.details ? JSON.parse(r.details) : {}; }
        catch (_) { return r.details || {}; }
      })(),
    };

    res.status(201).json(created);
  } catch (err) {
    console.error('Error creating report:', err);
    res.status(500).json({ message: 'Failed to create report' });
  }
});

/* ---------- PUT /reports/:id (تحديث النص أو الحالة) ---------- */
router.put('/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { reportType, status, content } = req.body;

  const payload = {
    report_type: reportType,
    status,
    content: typeof content === 'object' ? JSON.stringify(content) : content,
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  try {
    const [result] = await db.query('UPDATE reports SET ? WHERE id = ?', [payload, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Report not found.' });
    }

    // إرجاع التقرير بعد التحديث (نفس استعلام الـ GET)
    const [rows] = await db.query(`
      SELECT r.id,
             r.user_id        AS employeeId,
             u.full_name      AS employeeName,
             b.name           AS branch,
             r.report_type    AS type,
             r.content        AS details,
             r.status,
             r.created_at     AS date
      FROM reports r
      LEFT JOIN users    u ON r.user_id   = u.id
      LEFT JOIN branches b ON r.branch_id = b.id
      WHERE r.id = ?
    `, [id]);

    const r = rows[0];
    const updated = {
      id: r.id.toString(),
      employeeId: r.employeeId?.toString() || null,
      employeeName: r.employeeName,
      branch: r.branch || 'N/A',
      type: r.type,
      date: r.date,
      status: r.status,
      details: (() => {
        try { return r.details ? JSON.parse(r.details) : {}; }
        catch (_) { return r.details || {}; }
      })(),
    };

    res.json(updated);
  } catch (err) {
    console.error('Error updating report:', err);
    res.status(500).json({ message: 'Failed to update report' });
  }
});

module.exports = router;
