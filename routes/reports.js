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
const uploadFileToCloudinary = (file, uploadedById, folder) => {
    return new Promise((resolve, reject) => {
        const publicId = file.originalname.split('.').slice(0, -1).join('.').trim();
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `qssun_reports/${folder}/${uploadedById}`,
                public_id: publicId,
                resource_type: 'auto'
            },
            (error, result) => {
                if (error) return reject(error);
                if (result) resolve({ url: result.secure_url, fileName: file.originalname, id: result.public_id, uploadedBy: uploadedById });
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
        r.id, r.user_id, r.report_type, r.content, r.status, r.created_at, r.evaluation, r.modifications,
        r.assigned_team_id, r.project_workflow_status, r.adminNotes, r.branch_id,
        u.full_name as employee_name, u.department, u.username as employee_id_username, u.role as user_role,
        b.name as branch_name
    FROM reports r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN branches b ON r.branch_id = b.id
`;

const formatReportForFrontend = (reportRow, requestingUser = null) => {
    const details = safeJsonParse(reportRow.content, {});

    // Attachment Permission Logic
    if (requestingUser && requestingUser.role === 'TeamLead' && reportRow.report_type === 'Project' && details.updates) {
        details.updates.forEach(update => {
            if (update.files && Array.isArray(update.files)) {
                update.files = update.files.filter(file => String(file.uploadedBy) === requestingUser.id);
            }
        });
    }

    return {
        id: reportRow.id.toString(),
        employeeId: reportRow.employee_id_username || 'N/A',
        employeeName: reportRow.employee_name || 'N/A',
        branch: reportRow.branch_name || 'N/A',
        department: reportRow.department || 'N/A',
        type: reportRow.report_type,
        date: reportRow.created_at ? new Date(reportRow.created_at).toISOString() : new Date().toISOString(),
        status: reportRow.status,
        details: details,
        evaluation: safeJsonParse(reportRow.evaluation, undefined),
        modifications: safeJsonParse(reportRow.modifications, []),
        assignedTeamId: reportRow.assigned_team_id ? reportRow.assigned_team_id.toString() : undefined,
        projectWorkflowStatus: reportRow.project_workflow_status || undefined,
        adminNotes: safeJsonParse(reportRow.adminNotes, []),
    };
};

// GET /api/reports
router.get('/reports', async (req, res) => {
    try {
        const [rows] = await db.query(`${fullReportQuery} ORDER BY r.created_at DESC`);
        
        const requestingUser = { 
            id: req.headers['x-user-id'], 
            role: req.headers['x-user-role'] 
        };
        
        const reports = rows.map(row => formatReportForFrontend(row, requestingUser.id && requestingUser.role ? requestingUser : null));
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
                details.beforeImages = await Promise.all(beforeImages.map(file => uploadFileToCloudinary(file, userId, 'maintenance')));
                details.afterImages = await Promise.all(afterImages.map(file => uploadFileToCloudinary(file, userId, 'maintenance')));
            } else if (reportData.type === 'Sales') {
                 for (let i = 0; i < details.customers.length; i++) {
                    const customerFiles = req.files.filter(f => f.fieldname === `sales_customer_${i}_files`);
                    if (customerFiles.length > 0) {
                        details.customers[i].files = await Promise.all(customerFiles.map(file => uploadFileToCloudinary(file, userId, 'sales')));
                    }
                }
            } else if (reportData.type === 'Project') {
                for (let i = 0; i < details.updates.length; i++) {
                    const updateFiles = req.files.filter(f => f.fieldname === `project_update_${i}_files`);
                    if (updateFiles.length > 0) {
                        if (!details.updates[i].files) details.updates[i].files = [];
                        const uploadedFiles = await Promise.all(updateFiles.map(file => uploadFileToCloudinary(file, userId, 'projects')));
                        details.updates[i].files.push(...uploadedFiles);
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
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        const userId = userRows[0]?.id || null;

        // Handle file uploads for updates
         if (req.files && req.files.length > 0 && userId) {
            // Sales file updates
            if (reportData.type === 'Sales' && details.customers) {
                for (const file of req.files.filter(f => f.fieldname.startsWith('sales_customer_'))) {
                    const cIndex = parseInt(file.fieldname.split('_')[2]);
                    if (details.customers[cIndex]) {
                        if (!details.customers[cIndex].files) details.customers[cIndex].files = [];
                        const uploadedFile = await uploadFileToCloudinary(file, userId, 'sales');
                        details.customers[cIndex].files.push(uploadedFile);
                    }
                }
            }
            // Project file updates
            if (reportData.type === 'Project' && details.updates) {
                for (const file of req.files.filter(f => f.fieldname.startsWith('project_update_'))) {
                    const uIndex = parseInt(file.fieldname.split('_')[2]);
                    if (details.updates[uIndex]) {
                        if (!details.updates[uIndex].files) details.updates[uIndex].files = [];
                        const uploadedFile = await uploadFileToCloudinary(file, userId, 'projects');
                        details.updates[uIndex].files.push(uploadedFile);
                    }
                }
            }
            // Evaluation file updates
            const evaluationFiles = req.files.filter(f => f.fieldname === 'evaluation_files');
            if (evaluationFiles.length > 0 && reportData.evaluation) {
                if (!reportData.evaluation.files) reportData.evaluation.files = [];
                 const uploadedFiles = await Promise.all(evaluationFiles.map(file => uploadFileToCloudinary(file, userId, 'evaluations')));
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
            adminNotes: JSON.stringify(reportData.adminNotes || []),
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
        res.status(500).json({ message: error.message || 'An internal server error occurred while updating the report.' });
    }
});

// POST /api/reports/:id/add-exception - Add an exception to a project report
router.post('/reports/:id/add-exception', upload.array('files'), async (req, res) => {
    const { id } = req.params;
    const { comment, employeeId } = req.body;
    try {
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) return res.status(404).json({ message: 'User not found for exception.' });
        const userId = userRows[0].id;

        const [reportRows] = await db.query('SELECT * FROM reports WHERE id = ?', [id]);
        if (reportRows.length === 0) {
            return res.status(404).json({ message: 'Project report not found.' });
        }
        const report = reportRows[0];
        const details = safeJsonParse(report.content);

        if (report.report_type !== 'Project') {
            return res.status(400).json({ message: 'Exceptions can only be added to Project reports.' });
        }

        let uploadedFiles = [];
        if (req.files && req.files.length > 0) {
            uploadedFiles = await Promise.all(req.files.map(file => uploadFileToCloudinary(file, userId, 'projects/exceptions')));
        }
        
        const newException = {
            id: `exc-${Date.now()}`,
            comment,
            files: uploadedFiles,
            timestamp: new Date().toISOString(),
            uploadedBy: userId,
        };

        if (!details.exceptions) {
            details.exceptions = [];
        }
        details.exceptions.push(newException);

        await db.query('UPDATE reports SET content = ? WHERE id = ?', [JSON.stringify(details), id]);

        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.status(200).json(formatReportForFrontend(rows[0]));

    } catch (error) {
        console.error(`Error in POST /api/reports/${id}/add-exception:`, error);
        res.status(500).json({ message: error.message || 'An internal server error occurred while adding the exception.' });
    }
});


// POST /api/reports/:id/confirm-stage - A dedicated endpoint for project stage updates
router.post('/reports/:id/confirm-stage', upload.array('files'), async (req, res) => {
    const { id } = req.params;
    const { stageId, comment, employeeId } = req.body;

    if (!stageId || !employeeId) {
        return res.status(400).json({ message: 'stageId and employeeId are required.' });
    }

    try {
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
        const userId = userRows[0].id;

        const [reportRows] = await db.query('SELECT * FROM reports WHERE id = ?', [id]);
        if (reportRows.length === 0) {
            return res.status(404).json({ message: 'Project report not found.' });
        }
        const report = reportRows[0];
        const details = safeJsonParse(report.content);

        if (report.report_type !== 'Project' || !details.updates) {
            return res.status(400).json({ message: 'This action is only for Project reports.' });
        }
        
        let uploadedFiles = [];
        if (req.files && req.files.length > 0) {
            uploadedFiles = await Promise.all(req.files.map(file => uploadFileToCloudinary(file, userId, 'projects')));
        }
        
        const updatedReportPayload = {};

        // Handle virtual and real stages
        switch (stageId) {
            case 'concreteWorks':
                const stageIndex = details.updates.findIndex(u => u.id === 'concreteWorks');
                if (stageIndex !== -1) {
                    details.updates[stageIndex] = {
                        ...details.updates[stageIndex],
                        completed: true,
                        timestamp: new Date().toISOString(),
                        comment: comment || details.updates[stageIndex].comment,
                        files: [...(details.updates[stageIndex].files || []), ...uploadedFiles],
                    };
                    updatedReportPayload.content = JSON.stringify(details);
                    updatedReportPayload.project_workflow_status = 'ConcreteWorksDone';
                }
                break;

            case 'technicalCompletion':
                const installationStageIndex = details.updates.findIndex(u => u.id === 'installationComplete');
                if (installationStageIndex !== -1) {
                    details.updates[installationStageIndex].completed = true;
                    details.updates[installationStageIndex].timestamp = new Date().toISOString();
                    details.updates[installationStageIndex].comment = comment;
                    details.updates[installationStageIndex].files = uploadedFiles;
                }
                delete details.completionProof; // Clean up old field
                updatedReportPayload.content = JSON.stringify(details);
                updatedReportPayload.project_workflow_status = 'TechnicallyCompleted';
                break;
            
            case 'deliveryHandover_signed':
                const handoverIndex = details.updates.findIndex(u => u.id === 'deliveryHandover');
                if (handoverIndex !== -1 && uploadedFiles.length > 0) {
                    if (!details.updates[handoverIndex].files) {
                        details.updates[handoverIndex].files = [];
                    }
                    // Add the signed doc, assuming it's the second file
                    details.updates[handoverIndex].files[1] = uploadedFiles[0];
                    updatedReportPayload.content = JSON.stringify(details);
                }
                break;

            case 'workflowDocs':
                details.workflowDocs = [...(details.workflowDocs || []), ...uploadedFiles];
                updatedReportPayload.content = JSON.stringify(details);
                // Status remains FinishingWorks, so no status update here.
                break;
                
            default:
                return res.status(400).json({ message: `Stage action '${stageId}' is not recognized.` });
        }
        
        await db.query('UPDATE reports SET ? WHERE id = ?', [updatedReportPayload, id]);
        const [rows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.status(200).json(formatReportForFrontend(rows[0]));

    } catch (error) {
        console.error(`Error in POST /api/reports/${id}/confirm-stage:`, error);
        res.status(500).json({ message: error.message || 'An internal server error occurred while updating the project stage.' });
    }
});

// --- NEW ADMIN NOTES ENDPOINTS (Robust Transactional Implementation) ---

// POST /api/reports/:id/notes - Add a new admin note
router.post('/reports/:id/notes', async (req, res) => {
    const { id } = req.params;
    const { content, authorId, authorName } = req.body;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [reportRows] = await connection.query('SELECT adminNotes FROM reports WHERE id = ? FOR UPDATE', [id]);
        if (reportRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Report not found.' });
        }

        const report = reportRows[0];
        const adminNotes = safeJsonParse(report.adminNotes, []);
        
        const newNote = {
            id: `note-${Date.now()}`,
            authorId,
            authorName,
            content,
            timestamp: new Date().toISOString(),
            replies: [],
            readBy: [authorId],
        };
        adminNotes.push(newNote);

        await connection.query('UPDATE reports SET adminNotes = ? WHERE id = ?', [JSON.stringify(adminNotes), id]);
        
        await connection.commit();

        const [updatedReportRows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.status(200).json(formatReportForFrontend(updatedReportRows[0]));

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`Error adding note to report ${id}:`, error);
        res.status(500).json({ message: 'Failed to add note.' });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/reports/:id/notes/:noteId/reply - Add a reply to a note
router.post('/reports/:id/notes/:noteId/reply', async (req, res) => {
    const { id, noteId } = req.params;
    const { content, authorId, authorName } = req.body;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [reportRows] = await connection.query('SELECT adminNotes FROM reports WHERE id = ? FOR UPDATE', [id]);
        if (reportRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Report not found.' });
        }
        
        const report = reportRows[0];
        const adminNotes = safeJsonParse(report.adminNotes, []);
        const noteIndex = adminNotes.findIndex(note => note.id === noteId);

        if (noteIndex === -1) {
            await connection.rollback();
            return res.status(404).json({ message: "Note not found." });
        }

        const newReply = {
            id: `reply-${Date.now()}`,
            authorId,
            authorName,
            content,
            timestamp: new Date().toISOString(),
        };
        adminNotes[noteIndex].replies.push(newReply);

        await connection.query('UPDATE reports SET adminNotes = ? WHERE id = ?', [JSON.stringify(adminNotes), id]);
        
        await connection.commit();
        
        const [updatedReportRows] = await db.query(`${fullReportQuery} WHERE r.id = ?`, [id]);
        res.status(200).json(formatReportForFrontend(updatedReportRows[0]));

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`Error adding reply to note ${noteId}:`, error);
        res.status(500).json({ message: 'Failed to add reply.' });
    } finally {
        if (connection) connection.release();
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


module.exports = router;