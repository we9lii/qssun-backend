const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../db.js');
const { supabase } = require('./supabaseClient.js'); // Corrected path to be relative to the current folder

// تهيئة Multer لتخزين الملفات في الذاكرة بدلاً من القرص
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// دالة مساعد لرفع الملف إلى Supabase
const uploadFileToSupabase = async (file, employeeId) => {
    const filePath = `public/${employeeId}/${Date.now()}-${file.originalname}`;
    
    const { error } = await supabase.storage
        .from('report-attachments')
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
        });

    if (error) {
        throw error;
    }

    const { data } = supabase.storage
        .from('report-attachments')
        .getPublicUrl(filePath);

    return data.publicUrl;
};

// Helper to safely parse JSON
const safeJsonParse = (jsonString, defaultValue) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Failed to parse JSON, returning default value:", e);
        return defaultValue;
    }
};


// GET /api/reports - جلب كل التقارير
router.get('/reports', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM reports ORDER BY date DESC');

        const reports = rows.map(report => ({
            id: report.id.toString(),
            employeeId: report.employee_id || 'N/A',
            employeeName: report.employee_name || 'N/A',
            branch: report.branch || 'N/A',
            department: report.department || 'N/A',
            type: report.type || 'Inquiry',
            date: report.date || new Date().toISOString(),
            status: report.status || 'Pending',
            // Safely parse JSON fields
            details: safeJsonParse(report.details, {}),
            evaluation: safeJsonParse(report.evaluation, undefined),
            modifications: safeJsonParse(report.modifications, []),
        }));

        res.json(reports);
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching reports.' });
    }
});


// POST /api/reports - إنشاء تقرير جديد مع رفع المرفقات إلى Supabase
router.post('/reports', upload.any(), async (req, res) => {
    try {
        if (!req.body.reportData) {
            return res.status(400).json({ message: 'reportData is missing.' });
        }
        
        const reportData = JSON.parse(req.body.reportData);
        const details = reportData.details || {};
        const employeeId = reportData.employeeId;

        if (req.files && req.files.length > 0) {
            const beforeImagesFiles = req.files.filter(f => f.fieldname === 'beforeImages');
            const afterImagesFiles = req.files.filter(f => f.fieldname === 'afterImages');
            
            const beforeImageUrls = await Promise.all(
                beforeImagesFiles.map(file => uploadFileToSupabase(file, employeeId))
            );
            const afterImageUrls = await Promise.all(
                afterImagesFiles.map(file => uploadFileToSupabase(file, employeeId))
            );

            if (reportData.type === 'Maintenance') {
                details.beforeImages = beforeImageUrls;
                details.afterImages = afterImageUrls;
            }
        }

        const newReportForDb = {
            employee_id: reportData.employeeId,
            employee_name: reportData.employeeName,
            branch: reportData.branch,
            department: reportData.department,
            type: reportData.type,
            date: reportData.date,
            status: reportData.status,
            details: JSON.stringify(details),
        };

        const [result] = await db.query('INSERT INTO reports SET ?', newReportForDb);
        const insertId = result.insertId;

        const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [insertId]);

        const createdReport = {
            id: rows[0].id.toString(),
            employeeId: rows[0].employee_id,
            employeeName: rows[0].employee_name,
            branch: rows[0].branch,
            department: rows[0].department,
            type: rows[0].type,
            date: rows[0].date,
            status: rows[0].status,
            details: safeJsonParse(rows[0].details, {}),
            evaluation: safeJsonParse(rows[0].evaluation, undefined),
            modifications: safeJsonParse(rows[0].modifications, []),
        };

        res.status(201).json(createdReport);

    } catch (error) {
        console.error('Error creating report:', error);
        res.status(500).json({ message: 'An internal server error occurred while creating the report.' });
    }
});

// PUT /api/reports/:id - تحديث تقرير موجود (للحقول النصية فقط)
router.put('/reports/:id', async (req, res) => {
    const { id } = req.params;
    const reportUpdates = req.body;

    // لا نسمح بتغيير المعرف أو هوية الموظف
    delete reportUpdates.id;
    delete reportUpdates.employeeId;
    
    const dbPayload = {
        employee_name: reportUpdates.employeeName,
        branch: reportUpdates.branch,
        department: reportUpdates.department,
        type: reportUpdates.type,
        date: reportUpdates.date,
        status: reportUpdates.status,
        details: JSON.stringify(reportUpdates.details),
        evaluation: reportUpdates.evaluation ? JSON.stringify(reportUpdates.evaluation) : null,
        modifications: reportUpdates.modifications ? JSON.stringify(reportUpdates.modifications) : null,
    };

     // إزالة الحقول الفارغة لتجنب الكتابة فوقها بقيم null
    Object.keys(dbPayload).forEach(key => dbPayload[key] === undefined && delete dbPayload[key]);
    
    try {
        const [result] = await db.query('UPDATE reports SET ? WHERE id = ?', [dbPayload, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Report not found.' });
        }

        const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [id]);
        
        const updatedReport = {
            id: rows[0].id.toString(),
            employeeId: rows[0].employee_id,
            employeeName: rows[0].employee_name,
            branch: rows[0].branch,
            department: rows[0].department,
            type: rows[0].type,
            date: rows[0].date,
            status: rows[0].status,
            details: safeJsonParse(rows[0].details, {}),
            evaluation: safeJsonParse(rows[0].evaluation, undefined),
            modifications: safeJsonParse(rows[0].modifications, []),
        };

        res.json(updatedReport);

    } catch(error) {
        console.error('Error updating report:', error);
        res.status(500).json({ message: 'An internal server error occurred while updating the report.' });
    }
});


module.exports = router;