const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../db.js');
const { supabase } = require('./supabaseClient.js');

// Setup multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper to upload a file to Supabase
const uploadFileToSupabase = async (file, userId, folder = 'attachments') => {
    const filePath = `public/${folder}/${userId}/${Date.now()}-${file.originalname}`;
    
    const { error } = await supabase.storage
        .from('report-attachments')
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
        });

    if (error) throw error;

    const { data } = supabase.storage
        .from('report-attachments')
        .getPublicUrl(filePath);

    return { url: data.publicUrl, fileName: file.originalname };
};

// Helper to safely parse JSON
const safeJsonParse = (jsonString, defaultValue = {}) => {
    if (!jsonString || typeof jsonString !== 'string') return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Failed to parse JSON content:", e);
        return defaultValue;
    }
};

// GET /api/reports - Fetch all reports
router.get('/reports', async (req, res) => {
    try {
        const query = `
            SELECT 
                r.id, r.user_id, r.report_type, r.content, r.status, r.created_at,
                u.full_name as employee_name, u.department,
                b.name as branch_name
            FROM reports r
            LEFT JOIN users u ON r.user_id = u.id
            LEFT JOIN branches b ON r.branch_id = b.id
            ORDER BY r.created_at DESC
        `;
        const [rows] = await db.query(query);

        const reports = rows.map(row => ({
            id: row.id.toString(),
            employeeId: row.user_id ? row.user_id.toString() : 'N/A',
            employeeName: row.employee_name || 'N/A',
            branch: row.branch_name || 'N/A',
            department: row.department || 'N/A',
            type: row.report_type || 'Inquiry',
            date: row.created_at || new Date().toISOString(),
            status: row.status || 'Pending',
            details: safeJsonParse(row.content, {}),
        }));

        res.json(reports);
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ message: 'Error fetching reports.' });
    }
});

// POST /api/reports - Create a new report with attachments
router.post('/reports', upload.any(), async (req, res) => {
    try {
        if (!req.body.reportData) return res.status(400).json({ message: 'reportData is missing.' });
        
        const reportData = JSON.parse(req.body.reportData);
        let details = reportData.details || {};
        const userId = reportData.employeeId;

        // Handle attachments based on report type
        if (reportData.type === 'Maintenance') {
            const beforeImages = req.files.filter(f => f.fieldname === 'maintenance_beforeImages');
            const afterImages = req.files.filter(f => f.fieldname === 'maintenance_afterImages');
            details.beforeImages = await Promise.all(beforeImages.map(file => uploadFileToSupabase(file, userId, 'maintenance').then(r => r.url)));
            details.afterImages = await Promise.all(afterImages.map(file => uploadFileToSupabase(file, userId, 'maintenance').then(r => r.url)));
        } else if (reportData.type === 'Sales') {
            for (let i = 0; i < details.customers.length; i++) {
                const customerFiles = req.files.filter(f => f.fieldname === `sales_customer_${i}_files`);
                const uploadedFiles = await Promise.all(customerFiles.map(file => uploadFileToSupabase(file, userId, 'sales')));
                details.customers[i].files = uploadedFiles.map((uf, index) => ({ id: `file-${Date.now()}-${index}`, ...uf }));
            }
        } else if (reportData.type === 'Project') {
             for (let i = 0; i < details.updates.length; i++) {
                const updateFiles = req.files.filter(f => f.fieldname === `project_update_${i}_files`);
                const uploadedFiles = await Promise.all(updateFiles.map(file => uploadFileToSupabase(file, userId, 'projects')));
                details.updates[i].files = uploadedFiles;
            }
        }
        
        let branchId = null;
        if (reportData.branch) {
            const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [reportData.branch]);
            if (branchRows.length > 0) branchId = branchRows[0].id;
        }

        const newReportForDb = {
            user_id: userId,
            branch_id: branchId,
            report_type: reportData.type,
            content: JSON.stringify(details),
            status: reportData.status || 'Pending',
        };

        const [result] = await db.query('INSERT INTO reports SET ?', newReportForDb);
        
        // Fetch and return the complete new report object
        const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [result.insertId]);
        const newReport = { ...reportData, id: result.insertId.toString(), date: rows[0].created_at, details: safeJsonParse(rows[0].content) };
        res.status(201).json(newReport);

    } catch (error) {
        console.error('Error creating report:', error);
        res.status(500).json({ message: 'Error creating report.' });
    }
});

// PUT /api/reports/:id - Update a report (including evaluation with files)
router.put('/reports/:id', upload.any(), async (req, res) => {
    const { id } = req.params;
    try {
        if (!req.body.reportData) return res.status(400).json({ message: 'reportData is missing.' });
        const reportData = JSON.parse(req.body.reportData);
        const userId = reportData.employeeId;

        // Handle evaluation files
        if (reportData.evaluation) {
            const evaluationFiles = req.files.filter(f => f.fieldname === 'evaluation_files');
            const uploadedFiles = await Promise.all(evaluationFiles.map(file => uploadFileToSupabase(file, userId, 'evaluations')));
            reportData.evaluation.files = [
                ...(reportData.evaluation.files || []), 
                ...uploadedFiles.map((uf, index) => ({ id: `eval-${Date.now()}-${index}`, ...uf }))
            ];
        }

        const dbPayload = {
            content: JSON.stringify(reportData.details),
            status: reportData.status,
            // Assuming evaluation and modifications are stored in 'content' in a real scenario
            // For now, let's update the whole content blob
        };
        
        // This is a simplified update. A real app might handle merging JSON fields.
        const fullContent = safeJsonParse((await db.query('SELECT content FROM reports WHERE id = ?', [id]))[0][0].content);
        fullContent.evaluation = reportData.evaluation;
        fullContent.modifications = reportData.modifications;
        dbPayload.content = JSON.stringify(fullContent);


        await db.query('UPDATE reports SET ? WHERE id = ?', [dbPayload, id]);
        
        // Fetch and return the updated report
        const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [id]);
        const updatedReport = { ...reportData, details: safeJsonParse(rows[0].content) };
        res.json(updatedReport);

    } catch (error) {
        console.error('Error updating report:', error);
        res.status(500).json({ message: 'Error updating report.' });
    }
});

module.exports = router;
