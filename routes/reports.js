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
                if (error) return reject(error);
                if (result) resolve({ url: result.secure_url, fileName: file.originalname });
                else reject(new Error("Cloudinary upload failed without an error object."));
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

const formatReportForFrontend = (reportRow) => {
    return {
        id: reportRow.id.toString(),
        employeeId: reportRow.employee_id_username || 'N/A',
        employeeName: reportRow.employee_name || 'N/A',
        branch: reportRow.branch_name || 'N/A',
        department: reportRow.department || 'N/A',
        type: reportRow.report_type,
        date: reportRow.created_at ? new Date(reportRow.created_at).toISOString() : new Date().toISOString(),
        status: reportRow.status,
        details: safeJsonParse(reportRow.content, {}),
        evaluation: safeJsonParse(reportRow.evaluation, undefined),
        modifications: safeJsonParse(reportRow.modifications, []),
        assignedTeamId: reportRow.assigned_team_id ? reportRow.assigned_team_id.toString() : undefined,
        assignedTeamName: reportRow.assigned_team_name,
        projectWorkflowStatus: reportRow.project_workflow_status,
    };
};

// GET /api/reports
router.get('/reports', async (req, res) => {
    try {
        const [rows] = await db.query(`${fullReportQuery} ORDER BY r.created_at DESC`);
        const reports = rows.map(formatReportForFrontend);
        res.json(reports);
    } catch (error) {
        console.error('Error in GET /api/reports:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching reports.' });
    }
});


// POST /api/reports - Create a new report
router.post('/reports', upload.any(), async (req, res) => {
    try {
        if (!req.body.reportData) {
            return res.status(400).json({ message: 'reportData is missing from the request body.' });
        }
        const reportData = JSON.parse(req.body.reportData);
        const { employeeId, branch, details } = reportData;

        // Find user and branch IDs
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
        const userId = userRows[0].id;

        const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [branch]);
        if (branchRows.length === 0) return res.status(404).json({ message: 'Branch not found.' });
        const branchId = branchRows[0].id;
        
        // Handle file uploads based on report type
        if (req.files && req.files.length > 0) {
            if (reportData.type === 'Maintenance') {
                const beforeImages = req.files.filter(f => f.fieldname === 'maintenance_beforeImages');
                const afterImages = req.files.filter(f => f.fieldname === 'maintenance_afterImages');
                details.beforeImages = await Promise.all(beforeImages.map(file => uploadFileToCloudinary(file, employeeId, 'maintenance')));
                details.afterImages = await Promise.all(afterImages.map(file => uploadFileToCloudinary(file, employeeId, 'maintenance')));
            } else if (reportData.type === 'Sales') {
                 for (let i = 0; i < details.customers.length; i++) {
                    const customerFiles = req.files.filter(f => f.fieldname === `sales_customer_${i}_files`);
                    if (customerFiles.length > 0) {
                        details.customers[i].files = await Promise.all(customerFiles.map(file => uploadFileToCloudinary(file, employeeId, 'sales')));
                    }
                }
            } else if (reportData.type === 'Project') {
                for (let i = 0; i < details.updates.length; i++) {
                    const updateFiles = req.files.filter(f => f.fieldname === `project_update_${i}_files`);
                     if (updateFiles.length > 0) {
                        details.updates[i].files = await Promise.all(updateFiles.map(file => uploadFileToCloudinary(file, employeeId, 'projects')));
                    }
                }
            }
        }

        const newReport = {
            user_id: userId,
            branch_id: branchId,
            report_type: reportData.type,
            content: JSON.stringify(details),
            status: reportData.status,
            assigned_team_id: reportData.assignedTeamId || null,
            project_workflow_status: reportData.projectWorkflowStatus || null,
        };

        const [result] = await db.query('INSERT INTO reports SET ?', newReport);
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [result.insertId]);
        
        res.status(201).json(formatReportForFrontend(rows[0]));

    } catch (error) {
        console.error('Error in POST /api/reports:', error);
        console.error('Received reportData:', req.body.reportData);
        console.error('Received files:', req.files ? req.files.map(f => f.originalname) : 'No files');
        res.status(500).json({ message: 'An internal server error occurred while creating the report.' });
    }
});


// PUT /api/reports/:id - Update a report
router.put('/reports/:id', upload.any(), async (req, res) => {
    const { id } = req.params;
    try {
        if (!req.body.reportData) {
            return res.status(400).json({ message: 'reportData is missing.' });
        }
        const reportData = JSON.parse(req.body.reportData);
        const { employeeId, details } = reportData;

        // Handle file uploads for updates
         if (req.files && req.files.length > 0) {
            // Project file updates
            const projectUpdateFiles = req.files.filter(f => f.fieldname.startsWith('project_update_'));
            if (projectUpdateFiles.length > 0 && details.updates) {
                for (const file of projectUpdateFiles) {
                    const uIndex = parseInt(file.fieldname.split('_')[2]);
                    if (details.updates[uIndex]) {
                        if (!details.updates[uIndex].files) details.updates[uIndex].files = [];
                        const uploadedFile = await uploadFileToCloudinary(file, employeeId, 'projects');
                        details.updates[uIndex].files.push(uploadedFile);
                    }
                }
            }
            // Sales file updates
            const salesFiles = req.files.filter(f => f.fieldname.startsWith('sales_customer_'));
            if (salesFiles.length > 0 && details.customers) {
                for (const file of salesFiles) {
                    const cIndex = parseInt(file.fieldname.split('_')[2]);
                    if (details.customers[cIndex]) {
                        if (!details.customers[cIndex].files) details.customers[cIndex].files = [];
                        const uploadedFile = await uploadFileToCloudinary(file, employeeId, 'sales');
                        details.customers[cIndex].files.push(uploadedFile);
                    }
                }
            }
            // Evaluation file updates
            const evaluationFiles = req.files.filter(f => f.fieldname === 'evaluation_files');
            if (evaluationFiles.length > 0 && reportData.evaluation) {
                if (!reportData.evaluation.files) reportData.evaluation.files = [];
                 const uploadedFiles = await Promise.all(evaluationFiles.map(file => uploadFileToCloudinary(file, employeeId, 'evaluations')));
                 reportData.evaluation.files.push(...uploadedFiles);
            }
        }
        
        const updatedReport = {
            content: JSON.stringify(details),
            status: reportData.status,
            modifications: JSON.stringify(reportData.modifications || []),
            evaluation: JSON.stringify(reportData.evaluation || null),
            assigned_team_id: reportData.assignedTeamId || null,
            project_workflow_status: reportData.projectWorkflowStatus || null,
        };

        const [result] = await db.query('UPDATE reports SET ? WHERE id = ?', [updatedReport, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Report not found.' });
        }

        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.json(formatReportForFrontend(rows[0]));

    } catch (error) {
        console.error(`Error in PUT /api/reports/${id}:`, error);
        console.error('Received reportData:', req.body.reportData);
        console.error('Received files:', req.files ? req.files.map(f => f.originalname) : 'No files');
        res.status(500).json({ message: 'An internal server error occurred while updating the report.' });
    }
});


// DELETE /api/reports/:id
router.delete('/reports/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM reports WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Report not found.' });
        }
        res.status(200).json({ message: 'Report deleted successfully.' });
    } catch (error) {
        console.error(`Error in DELETE /api/reports/${id}:`, error);
        res.status(500).json({ message: 'An internal server error occurred while deleting the report.' });
    }
});


// --- Project Workflow Endpoints ---

const updateProjectWorkflow = async (res, reportId, newStatus, updateData = {}) => {
    try {
        const setClauses = ['project_workflow_status = ?'];
        const values = [newStatus];

        if (updateData.content) {
            setClauses.push('content = ?');
            values.push(updateData.content);
        }

        values.push(reportId);

        const sql = `UPDATE reports SET ${setClauses.join(', ')} WHERE id = ?`;

        const [result] = await db.query(sql, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Project report not found.' });
        }
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [reportId]);
        res.json(formatReportForFrontend(rows[0]));
    } catch (error) {
        console.error(`Error in updateProjectWorkflow for report ${reportId} to status ${newStatus}:`, error);
        res.status(500).json({ message: 'An internal server error occurred during project workflow update.' });
    }
};

router.post('/reports/:id/accept-team', async (req, res) => {
    await updateProjectWorkflow(res, req.params.id, 'InProgress');
});

router.post('/reports/:id/confirm-second-payment', async (req, res) => {
    await updateProjectWorkflow(res, req.params.id, 'FinishingWorks');
});

router.post('/reports/:id/finalize-handover', async (req, res) => {
    await updateProjectWorkflow(res, req.params.id, 'Archived');
});

// Endpoints with file uploads and comments
const workflowUpdateWithFiles = async (req, res, newStatus, updateId, fileFolder) => {
    const { id } = req.params;
    const { comment } = req.body;

    try {
        const [reportRows] = await db.query('SELECT r.content, u.username as employee_id FROM reports r LEFT JOIN users u on r.user_id = u.id WHERE r.id = ?', [id]);
        if (reportRows.length === 0) return res.status(404).json({ message: 'Report not found.' });
        
        const content = safeJsonParse(reportRows[0].content);
        const employeeId = reportRows[0].employee_id;

        const updateIndex = content.updates.findIndex(u => u.id === updateId);
        if (updateIndex === -1) return res.status(400).json({ message: `Update step '${updateId}' not found.` });

        const uploadedFiles = await Promise.all(
            req.files.map(file => uploadFileToCloudinary(file, employeeId, fileFolder))
        );

        content.updates[updateIndex] = {
            ...content.updates[updateIndex],
            completed: true,
            timestamp: new Date().toISOString(),
            comment: comment || '',
            files: uploadedFiles,
        };

        await updateProjectWorkflow(res, id, newStatus, { content: JSON.stringify(content) });

    } catch (error) {
        console.error(`Error in workflowUpdateWithFiles for report ${id}, status ${newStatus}:`, error);
        console.error('Received comment:', req.body.comment);
        console.error('Received files:', req.files ? req.files.map(f => f.originalname) : 'No files');
        res.status(500).json({ message: 'An internal server error occurred during project file update.' });
    }
};

router.post('/reports/:id/confirm-concrete', upload.array('concreteFiles'), async (req, res) => {
    await workflowUpdateWithFiles(req, res, 'ConcreteWorksDone', 'concreteWorks', 'concrete');
});

router.post('/reports/:id/complete-project', upload.array('completionFiles'), async (req, res) => {
     await workflowUpdateWithFiles(req, res, 'Completed', 'deliveryHandover', 'completion');
});


module.exports = router;