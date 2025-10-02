const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require('multer');
const { cloudinary } = require('../cloudinary.js');
const streamifier = require('streamifier');

// Setup multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper to upload a file to Cloudinary
const uploadFileToCloudinary = (file, employeeId) => {
    return new Promise((resolve, reject) => {
        const publicId = file.originalname.split('.').slice(0, -1).join('.');
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `qssun_reports/workflows/${employeeId}`,
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

// Helper to safely parse JSON.
const safeJsonParse = (json, defaultValue) => {
    if (typeof json !== 'string') return defaultValue;
    try {
        return JSON.parse(json);
    } catch (e) {
        return defaultValue;
    }
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

        const requests = rows.map(req => ({
            id: req.id,
            title: req.title || 'N/A',
            description: req.description || '',
            type: req.type || 'استيراد',
            priority: req.priority || 'منخفضة',
            currentStageId: req.current_stage_id || 1,
            creationDate: req.creation_date || new Date().toISOString(),
            lastModified: req.last_modified || new Date().toISOString(),
            stageHistory: safeJsonParse(req.stage_history, []),
            employeeId: req.employee_id_username,
        }));
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

        const newRequestForDb = {
            id: `REQ-${Date.now().toString().slice(-4)}`,
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
        
        // Construct the response directly to avoid read-after-write issues.
        const requestForFrontend = {
            id: newRequestForDb.id,
            title,
            description,
            type,
            priority,
            currentStageId: 1,
            creationDate: now.toISOString(),
            lastModified: now.toISOString(),
            stageHistory: stageHistory, // Send the original object back
            employeeId: employeeId,
        };
        res.status(201).json(requestForFrontend);

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
                
                // Find the correct history item to add the document to.
                // This logic correctly handles both new approvals and edits of past stages.
                let itemFound = false;
                for(let i = stageHistory.length - 1; i >= 0; i--) {
                    if (!stageHistory[i].documents.find(d => d.id === docId)) {
                        stageHistory[i].documents.push(newDocument);
                        itemFound = true;
                        break;
                    }
                }
                if (!itemFound) {
                    console.warn(`Could not find a history item to attach document ${docId}`);
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

        // Remove any keys that are undefined so they don't overwrite existing data in the DB
        Object.keys(dbPayload).forEach(key => dbPayload[key] === undefined && delete dbPayload[key]);

        const [result] = await db.query('UPDATE workflow_requests SET ? WHERE id = ?', [dbPayload, id]);

        if (result.affectedRows === 0) return res.status(404).json({ message: 'Workflow request not found.'});
        
        // Construct the response directly from the data we just processed
        const updatedRequestForFrontend = {
            ...requestData,
            stageHistory: stageHistory, // Send the modified history object back
            lastModified: now.toISOString(),
        };
        res.json(updatedRequestForFrontend);

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