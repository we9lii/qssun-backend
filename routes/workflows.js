const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require('multer');
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
const uploadFileToCloudinary = (file, employeeId) => {
    return new Promise((resolve, reject) => {
        const resourceType = getResourceType(file.mimetype);

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `qssun_reports/workflows/${employeeId}`,
                // These options are crucial: they preserve the original filename and extension in the URL.
                use_filename: true,
                unique_filename: false,
                overwrite: true, // Allow overwriting files with the same name
                resource_type: resourceType
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                if (result) {
                    // The URL from Cloudinary is now used directly, relying on the account settings.
                    // The manual 'fl_inline' modification has been removed.
                    resolve({ url: result.secure_url, fileName: file.originalname });
                } else {
                    reject(new Error("Cloudinary upload failed without an error object."));
                }
            }
        );
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
};

// Helper to safely parse JSON.
const safeJsonParse = (json, defaultValue) => {
    if (typeof json !== 'string') return defaultValue;
    try {
        return JSON.parse(json);
    } catch (e) {
        return defaultValue;
    }
};

// Helper function to build the full request object for the frontend from a DB row
const buildRequestForFrontend = (dbRow) => {
    if (!dbRow) return null;
    return {
        id: dbRow.id,
        title: dbRow.title || 'N/A',
        description: dbRow.description || '',
        type: dbRow.type || 'استيراد',
        priority: dbRow.priority || 'منخفضة',
        currentStageId: dbRow.current_stage_id || 1,
        creationDate: dbRow.creation_date || new Date().toISOString(),
        lastModified: dbRow.last_modified || new Date().toISOString(),
        stageHistory: safeJsonParse(dbRow.stage_history, []),
        employeeId: dbRow.employee_id_username,
    };
};


// GET /api/workflow-requests
router.get('/workflow-requests', async (req, res) => {
    try {
        const query = `
            SELECT w.*, u.username as employee_id_username
            FROM workflow_requests w
            LEFT JOIN users u ON w.user_id = u.id
            ORDER BY w.creation_date DESC
        `;
        const [rows] = await db.query(query);

        const requests = rows.map(buildRequestForFrontend);
        res.json(requests);
    } catch (error) {
        console.error('Error fetching workflow requests:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// POST /api/workflow-requests - Create a new request
router.post('/workflow-requests', async (req, res) => {
    const { title, description, type, priority, employeeId, stageHistory } = req.body;
    try {
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
        
        const userId = userRows[0].id;
        const now = new Date();
        const generatedId = `REQ-${Date.now().toString().slice(-4)}`;

        const newRequestForDb = {
            id: generatedId,
            user_id: userId,
            title,
            description,
            type,
            priority,
            current_stage_id: 1,
            stage_history: JSON.stringify(stageHistory),
            creation_date: now,
            last_modified: now,
        };

        await db.query('INSERT INTO workflow_requests SET ?', newRequestForDb);
        
        // Fetch the newly created record to ensure data integrity in the response
        const query = `
            SELECT w.*, u.username as employee_id_username
            FROM workflow_requests w
            LEFT JOIN users u ON w.user_id = u.id
            WHERE w.id = ?
        `;
        const [newRows] = await db.query(query, [generatedId]);

        res.status(201).json(buildRequestForFrontend(newRows[0]));

    } catch (error) {
        console.error('Error creating workflow request:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// PUT /api/workflow-requests/:id - Update an existing request
router.put('/workflow-requests/:id', upload.any(), async (req, res) => {
    const { id } = req.params;
    try {
        if (!req.body.requestData) return res.status(400).json({ message: 'requestData is missing.' });
        
        const requestData = JSON.parse(req.body.requestData);
        const employeeId = requestData.employeeId; 

        if (!employeeId) return res.status(400).json({ message: 'Employee ID is missing.' });

        const now = new Date();
        let stageHistory = requestData.stageHistory || [];

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                 const nameParts = file.originalname.split('___');
                if (nameParts.length !== 3) {
                    console.warn(`Skipping file with invalid name format: ${file.originalname}`);
                    continue;
                }
                const [docId, docType, originalName] = nameParts;
                const uploadedFile = await uploadFileToCloudinary({ ...file, originalname: originalName }, employeeId);
                
                const newDocument = {
                    id: docId,
                    type: docType,
                    uploadDate: new Date().toISOString(),
                    ...uploadedFile
                };
                
                let documentPlaced = false;
                // Try to find and update an existing document placeholder by ID. This handles edits.
                for (const historyItem of stageHistory) {
                    if (!historyItem.documents) continue;
                    const docIndex = historyItem.documents.findIndex(d => d.id === docId);
                    if (docIndex > -1) {
                        historyItem.documents[docIndex] = { ...historyItem.documents[docIndex], ...newDocument };
                        documentPlaced = true;
                        break;
                    }
                }
                // If not placed, it must be a new document for the latest stage. This handles new stage approvals.
                if (!documentPlaced && stageHistory.length > 0) {
                    const latestHistoryItem = stageHistory[stageHistory.length - 1];
                    if (!latestHistoryItem.documents) latestHistoryItem.documents = [];
                    latestHistoryItem.documents.push(newDocument);
                }
            }
        }
        
        const dbPayload = {
            title: requestData.title,
            description: requestData.description,
            priority: requestData.priority,
            current_stage_id: requestData.currentStageId,
            stage_history: JSON.stringify(stageHistory),
            last_modified: now,
        };

        const [result] = await db.query('UPDATE workflow_requests SET ? WHERE id = ?', [dbPayload, id]);

        if (result.affectedRows === 0) return res.status(404).json({ message: 'Workflow request not found.'});
        
        // Fetch the updated record from the DB to return the true persisted state
        const query = `
            SELECT w.*, u.username as employee_id_username
            FROM workflow_requests w
            LEFT JOIN users u ON w.user_id = u.id
            WHERE w.id = ?
        `;
        const [updatedRows] = await db.query(query, [id]);
        
        res.json(buildRequestForFrontend(updatedRows[0]));

    } catch (error) {
        console.error('Error updating workflow request:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// DELETE /api/workflow-requests/:id - Delete a request
router.delete('/workflow-requests/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM workflow_requests WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Workflow request not found.' });
        }
        res.status(200).json({ message: 'Workflow request deleted successfully.' });
    } catch (error) {
        console.error('Error deleting workflow request:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});


module.exports = router;