const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../db.js');
const { cloudinary } = require('../cloudinary.js');
const streamifier = require('streamifier');

// Setup multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper to upload a file to Cloudinary
const uploadFileToCloudinary = (file, employeeId, folder) => {
    return new Promise((resolve, reject) => {
        const publicId = file.originalname.split('.').slice(0, -1).join('.').trim();
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `qssun_reports/${folder}/${employeeId}`,
                public_id: publicId,
                resource_type: 'auto'
            },
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

// Full report select query for reuse
const fullReportQuery = `
    SELECT 
        r.id, r.user_id, r.report_type, r.content, r.status, r.created_at, r.assigned_team_id, r.project_workflow_status,
        u.full_name as employee_name, u.department, u.username as employee_id_username,
        b.name as branch_name,
        t.name as assigned_team_name
    FROM reports r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN branches b ON r.branch_id = b.id
    LEFT JOIN technical_teams t ON r.assigned_team_id = t.id
`;

const mapReportForFrontend = (row) => ({
    id: row.id.toString(),
    employeeId: row.employee_id_username || 'N/A',
    employeeName: row.employee_name || 'N/A',
    branch: row.branch_name || 'N/A',
    department: row.department || 'N/A',
    type: row.report_type || 'Inquiry',
    date: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    status: row.status || 'Pending',
    details: safeJsonParse(row.content, {}),
    assignedTeamId: row.assigned_team_id?.toString() || undefined,
    assignedTeamName: row.assigned_team_name || undefined,
    projectWorkflowStatus: row.project_workflow_status || 'Draft',
});


// GET /api/reports - Fetch all reports
router.get('/reports', async (req, res) => {
    try {
        const query = `${fullReportQuery} ORDER BY r.created_at DESC`;
        const [rows] = await db.query(query);
        const reports = rows.map(mapReportForFrontend);
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
                details.updates[i].files = uploadedFiles.map((uf, index) => ({ id: `proj-${Date.now()}-${index}`, ...uf }));
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
            assigned_team_id: reportData.assignedTeamId || null,
            project_workflow_status: reportData.projectWorkflowStatus || 'Draft',
        };

        const [result] = await db.query('INSERT INTO reports SET ?', newReportForDb);
        
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [result.insertId]);
        const newReport = mapReportForFrontend(rows[0]);
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

        // Start with new details from frontend. This has the updated steps.
        let details = reportData.details || {};

        // Handle file uploads and merge them.
        if (reportData.type === 'Project') {
            for (let i = 0; i < details.updates.length; i++) {
                const updateFiles = req.files.filter(f => f.fieldname === `project_update_${i}_files`);
                const uploadedFiles = await Promise.all(updateFiles.map(file => uploadFileToCloudinary(file, employeeId, 'projects')));
                const newFileObjects = uploadedFiles.map((uf, index) => ({ id: `proj-${Date.now()}-${index}`, ...uf }));
                
                // Combine existing files (sent back by frontend) with newly uploaded ones.
                details.updates[i].files = [...(details.updates[i].files || []), ...newFileObjects];
            }
        } else if (reportData.type === 'Sales') {
             for (let i = 0; i < details.customers.length; i++) {
                const customerFiles = req.files.filter(f => f.fieldname === `sales_customer_${i}_files`);
                const uploadedFiles = await Promise.all(customerFiles.map(file => uploadFileToCloudinary(file, employeeId, 'sales')));
                const newFileObjects = uploadedFiles.map((uf, index) => ({ id: `file-${Date.now()}-${index}`, ...uf }));

                details.customers[i].files = [...(details.customers[i].files || []), ...newFileObjects];
            }
        }

        if (reportData.evaluation) {
            const evaluationFiles = req.files.filter(f => f.fieldname === 'evaluation_files');
            const uploadedFiles = await Promise.all(evaluationFiles.map(file => uploadFileToCloudinary(file, employeeId, 'evaluations')));
            
            const newFileObjects = uploadedFiles.map((uf, index) => ({ id: `eval-${Date.now()}-${index}`, ...uf }));
            
            details.evaluation = reportData.evaluation;
            details.evaluation.files = [...(reportData.evaluation.files || []), ...newFileObjects];
        }

        // Add modifications log.
        details.modifications = reportData.modifications;
        
        const dbPayload = {
            content: JSON.stringify(details), // The content IS the fully updated details object.
            status: reportData.status,
            assigned_team_id: reportData.assignedTeamId || null,
            project_workflow_status: reportData.projectWorkflowStatus,
        };
        
        await db.query('UPDATE reports SET ? WHERE id = ?', [dbPayload, id]);
        
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        const updatedReportForFrontend = mapReportForFrontend(rows[0]);

        res.json(updatedReportForFrontend);

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

// POST /api/reports/:id/accept-team - Team lead accepts a project
router.post('/reports/:id/accept-team', async (req, res) => {
    const { id } = req.params;
    try {
        const [reportRows] = await db.query('SELECT project_workflow_status FROM reports WHERE id = ?', [id]);
        if (reportRows.length === 0) return res.status(404).json({ message: 'Report not found.' });
        if (reportRows[0].project_workflow_status !== 'PendingTeamAcceptance') {
            return res.status(400).json({ message: 'Project is not awaiting team acceptance.' });
        }
        await db.query('UPDATE reports SET project_workflow_status = ? WHERE id = ?', ['InProgress', id]);
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.json(mapReportForFrontend(rows[0]));
    } catch (error) {
        console.error('Error accepting project:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// POST /api/reports/:id/confirm-concrete - Team lead confirms concrete works
router.post('/reports/:id/confirm-concrete', upload.array('concreteFiles'), async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body;
    const files = req.files;

    try {
        const [reportRows] = await db.query('SELECT content, user_id, project_workflow_status FROM reports WHERE id = ?', [id]);
        if (reportRows.length === 0) return res.status(404).json({ message: 'Report not found.' });
        
        if (reportRows[0].project_workflow_status !== 'InProgress') {
            return res.status(400).json({ message: 'Project is not in the correct stage to confirm concrete works.' });
        }

        const [userRows] = await db.query('SELECT username FROM users WHERE id = ?', [reportRows[0].user_id]);
        const employeeId = userRows[0]?.username || 'unknown';

        const uploadedFiles = await Promise.all(
            files.map(file => uploadFileToCloudinary(file, employeeId, `projects/${id}/concrete`))
        );
        const newFileObjects = uploadedFiles.map(uf => ({ id: `concrete-${Date.now()}-${Math.random()}`, ...uf }));

        const details = safeJsonParse(reportRows[0].content, {});
        
        if (!Array.isArray(details.updates)) { // Robustness check
            details.updates = [];
        }

        const concreteUpdateIndex = details.updates.findIndex((u) => u.id === 'concreteWorks');

        if (concreteUpdateIndex > -1) {
            details.updates[concreteUpdateIndex].completed = true;
            details.updates[concreteUpdateIndex].timestamp = new Date().toISOString();
            details.updates[concreteUpdateIndex].files = [...(details.updates[concreteUpdateIndex].files || []), ...newFileObjects];
            details.updates[concreteUpdateIndex].comment = comment; // Save the comment
        } else {
            details.updates.push({
                id: 'concreteWorks',
                label: 'إنتهاء اعمال الخرسانة',
                completed: true,
                timestamp: new Date().toISOString(),
                files: newFileObjects,
                comment: comment
            });
        }


        await db.query('UPDATE reports SET content = ?, project_workflow_status = ? WHERE id = ?', [
            JSON.stringify(details),
            'ConcreteWorksDone',
            id
        ]);
        
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.json(mapReportForFrontend(rows[0]));

    } catch (error) {
        console.error('Error confirming concrete works:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// POST /api/reports/:id/confirm-second-payment - Employee confirms second payment
router.post('/reports/:id/confirm-second-payment', async (req, res) => {
    const { id } = req.params;

    try {
        const [reportRows] = await db.query('SELECT content, project_workflow_status FROM reports WHERE id = ?', [id]);
        if (reportRows.length === 0) return res.status(404).json({ message: 'Report not found.' });

        const report = reportRows[0];
        if (report.project_workflow_status !== 'ConcreteWorksDone') {
            return res.status(400).json({ message: 'Project is not awaiting second payment confirmation.' });
        }

        const details = safeJsonParse(report.content, {});
        
        if (!Array.isArray(details.updates)) { // Robustness check
            details.updates = [];
        }

        const secondPaymentIndex = details.updates.findIndex((u) => u.id === 'secondPayment');
        if (secondPaymentIndex > -1) {
            details.updates[secondPaymentIndex].completed = true;
            details.updates[secondPaymentIndex].timestamp = new Date().toISOString();
        }

        await db.query('UPDATE reports SET content = ?, project_workflow_status = ? WHERE id = ?', [
            JSON.stringify(details),
            'FinishingWorks',
            id
        ]);
        
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.json(mapReportForFrontend(rows[0]));

    } catch (error) {
        console.error('Error confirming second payment:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// POST /api/reports/:id/complete-project - Team lead completes the project
router.post('/reports/:id/complete-project', upload.array('completionFiles'), async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body;
    const files = req.files;

    try {
        const [reportRows] = await db.query('SELECT content, user_id, project_workflow_status FROM reports WHERE id = ?', [id]);
        if (reportRows.length === 0) return res.status(404).json({ message: 'Report not found.' });
        if (reportRows[0].project_workflow_status !== 'FinishingWorks') {
            return res.status(400).json({ message: 'Project is not in the finishing stage.' });
        }
        
        const [userRows] = await db.query('SELECT username FROM users WHERE id = ?', [reportRows[0].user_id]);
        const employeeId = userRows[0]?.username || 'unknown';

        const uploadedFiles = await Promise.all(
            files.map(file => uploadFileToCloudinary(file, employeeId, `projects/${id}/completion`))
        );
        const newFileObjects = uploadedFiles.map(uf => ({ id: `completion-${Date.now()}-${Math.random()}`, ...uf }));

        const details = safeJsonParse(reportRows[0].content, {});
        
        if (!Array.isArray(details.updates)) { // Robustness check
            details.updates = [];
        }

        const deliveryUpdateIndex = details.updates.findIndex((u) => u.id === 'deliveryHandover');

        if (deliveryUpdateIndex > -1) {
            details.updates[deliveryUpdateIndex].completed = true;
            details.updates[deliveryUpdateIndex].timestamp = new Date().toISOString();
            details.updates[deliveryUpdateIndex].files = [...(details.updates[deliveryUpdateIndex].files || []), ...newFileObjects];
            details.updates[deliveryUpdateIndex].comment = comment; // Save the comment
        } else {
            details.updates.push({
                id: 'deliveryHandover',
                label: 'ارسال محضر تسليم الأعمال',
                completed: true,
                timestamp: new Date().toISOString(),
                files: newFileObjects,
                comment: comment,
            });
        }

        await db.query('UPDATE reports SET content = ?, project_workflow_status = ? WHERE id = ?', [
            JSON.stringify(details),
            'Completed',
            id
        ]);
        
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.json(mapReportForFrontend(rows[0]));

    } catch (error) {
        console.error('Error completing project:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// POST /api/reports/:id/finalize-handover - Employee finalizes and archives the project
router.post('/reports/:id/finalize-handover', async (req, res) => {
    const { id } = req.params;

    try {
        const [reportRows] = await db.query('SELECT content, project_workflow_status FROM reports WHERE id = ?', [id]);
        if (reportRows.length === 0) return res.status(404).json({ message: 'Report not found.' });

        const report = reportRows[0];
        if (report.project_workflow_status !== 'Completed') {
            return res.status(400).json({ message: 'Project is not yet completed by the technical team.' });
        }

        const details = safeJsonParse(report.content, {});
        
        if (!Array.isArray(details.updates)) { // Robustness check
            details.updates = [];
        }
        
        const handoverIndex = details.updates.findIndex((u) => u.id === 'deliveryHandover');
        if (handoverIndex > -1) {
            details.updates[handoverIndex].completed = true;
            details.updates[handoverIndex].timestamp = new Date().toISOString();
        }

        await db.query('UPDATE reports SET content = ?, project_workflow_status = ?, status = ? WHERE id = ?', [
            JSON.stringify(details),
            'Archived',
            'Approved', // Final status update for the report
            id
        ]);
        
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.json(mapReportForFrontend(rows[0]));

    } catch (error) {
        console.error('Error finalizing project handover:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});


module.exports = router;