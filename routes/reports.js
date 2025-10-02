const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../db.js');
const { cloudinary } = require('../cloudinary.js');
const streamifier = require('streamifier');

// Setup multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const getResourceType = (mimetype) => {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    // Correctly classify PDFs and other documents as 'raw'
    return 'raw';
};

// Helper to upload a file to Cloudinary
const uploadFileToCloudinary = (file, employeeId, folder) => {
    return new Promise((resolve, reject) => {
        const resourceType = getResourceType(file.mimetype);
        
        const uploadOptions = {
            folder: `qssun_reports/${folder}/${employeeId}`,
            use_filename: true,
            unique_filename: false,
            overwrite: true, 
            resource_type: resourceType
        };

        // If it's a raw file (like a PDF), add a transformation flag
        // to tell Cloudinary to serve it for inline viewing.
        if (resourceType === 'raw') {
            uploadOptions.transformation = 'fl_inline';
        }

        const uploadStream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                if (result) {
                    resolve({ url: result.secure_url, fileName: file.originalname });
                } else {
                    reject(new Error("Cloudinary upload failed without an error object."));
                }
            }
        );
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
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
                u.full_name as employee_name, u.department, u.username as employee_id_username,
                b.name as branch_name
            FROM reports r
            LEFT JOIN users u ON r.user_id = u.id
            LEFT JOIN branches b ON r.branch_id = b.id
            ORDER BY r.created_at DESC
        `;
        const [rows] = await db.query(query);

        const reports = rows.map(row => ({
            id: row.id.toString(),
            employeeId: row.employee_id_username || 'N/A',
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
        const employeeId = reportData.employeeId;

        if (reportData.type === 'Maintenance') {
            const beforeImages = req.files.filter(f => f.fieldname === 'maintenance_beforeImages');
            const afterImages = req.files.filter(f => f.fieldname === 'maintenance_afterImages');
            details.beforeImages = await Promise.all(beforeImages.map(file => uploadFileToCloudinary(file, employeeId, 'maintenance')));
            details.afterImages = await Promise.all(afterImages.map(file => uploadFileToCloudinary(file, employeeId, 'maintenance')));
        } else if (reportData.type === 'Sales') {
            details.customers = details.customers || [];
            for (let i = 0; i < details.customers.length; i++) {
                const customerFiles = req.files.filter(f => f.fieldname === `sales_customer_${i}_files`);
                const uploadedFiles = await Promise.all(customerFiles.map(file => uploadFileToCloudinary(file, employeeId, 'sales')));
                details.customers[i].files = uploadedFiles.map((uf, index) => ({ id: `file-${Date.now()}-${index}`, ...uf }));
            }
        } else if (reportData.type === 'Project') {
             details.updates = details.updates || [];
             for (let i = 0; i < details.updates.length; i++) {
                const updateFiles = req.files.filter(f => f.fieldname === `project_update_${i}_files`);
                const uploadedFiles = await Promise.all(updateFiles.map(file => uploadFileToCloudinary(file, employeeId, 'projects')));
                details.updates[i].files = uploadedFiles;
            }
        }
        
        let branchId = null;
        if (reportData.branch) {
            const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [reportData.branch]);
            if (branchRows.length > 0) branchId = branchRows[0].id;
        }

        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        const userId = userRows[0].id;

        const newReportForDb = {
            user_id: userId,
            branch_id: branchId,
            report_type: reportData.type,
            content: JSON.stringify(details),
            status: reportData.status || 'Pending',
        };

        const [result] = await db.query('INSERT INTO reports SET ?', newReportForDb);
        
        const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [result.insertId]);
        const newReport = { 
            ...reportData, 
            id: result.insertId.toString(), 
            date: rows[0].created_at, 
            details: safeJsonParse(rows[0].content) 
        };
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
        const employeeId = reportData.employeeId;

        const [existingRows] = await db.query('SELECT content FROM reports WHERE id = ?', [id]);
        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Report not found.' });
        }
        const fullContent = safeJsonParse(existingRows[0].content, {});

        if (reportData.evaluation) {
            const evaluationFiles = req.files.filter(f => f.fieldname === 'evaluation_files');
            const uploadedFiles = await Promise.all(evaluationFiles.map(file => uploadFileToCloudinary(file, employeeId, 'evaluations')));
            fullContent.evaluation = reportData.evaluation;
            fullContent.evaluation.files = [
                ...(fullContent.evaluation.files || []), 
                ...uploadedFiles.map((uf, index) => ({ id: `eval-${Date.now()}-${index}`, ...uf }))
            ];
        }
        
        fullContent.modifications = reportData.modifications;

        const dbPayload = {
            content: JSON.stringify(fullContent),
            status: reportData.status,
        };
        
        await db.query('UPDATE reports SET ? WHERE id = ?', [dbPayload, id]);
        
        const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [id]);
        const updatedReport = { 
            ...reportData, 
            details: safeJsonParse(rows[0].content) 
        };
        res.json(updatedReport);

    } catch (error) {
        console.error('Error updating report:', error);
        res.status(500).json({ message: 'Error updating report.' });
    }
});

// DELETE /api/reports/:id - Delete a report
router.delete('/reports/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM reports WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Report not found.' });
        }
        res.status(200).json({ message: 'Report deleted successfully.' });
    } catch (error) {
        console.error('Error deleting report:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

module.exports = router;