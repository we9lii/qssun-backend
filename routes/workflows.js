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
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `qssun_reports/workflows/${employeeId}`,
                use_filename: true,
                unique_filename: true,
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

        const newRequest = {
            id: `REQ-${Date.now().toString().slice(-4)}`,
            user_id: userId,
            title, description, type, priority,
            current_stage_id: 1,
            stage_history: JSON.stringify(stageHistory),
        };

        await db.query('INSERT INTO workflow_requests SET ?', newRequest);
        
        const [rows] = await db.query(`SELECT w.*, u.username as employee_id_username FROM workflow_requests w LEFT JOIN users u ON w.user_id = u.id WHERE w.id = ?`, [newRequest.id]);
        
        const row = rows[0];
        const requestForFrontend = {
            id: row.id,
            title: row.title,
            description: row.description,
            type: row.type,
            priority: row.priority,
            currentStageId: row.current_stage_id,
            creationDate: row.creation_date,
            lastModified: row.last_modified,
            stageHistory: safeJsonParse(row.stage_history, []),
            employeeId: row.employee_id_username,
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

        if (req.files && req.files.length > 0) {
            // This is the new logic to handle file uploads correctly
            const stageHistory = requestData.stageHistory;

            // Go through each history item to find and replace temporary blob URLs from edits
            for (const historyItem of stageHistory) {
                if (Array.isArray(historyItem.documents)) {
                    for (let i = 0; i < historyItem.documents.length; i++) {
                        const doc = historyItem.documents[i];
                        if (doc && doc.url && doc.url.startsWith('blob:')) {
                            // Find the corresponding file uploaded from the frontend
                            const fileToUpload = req.files.find(f => {
                                const [fileDocId] = f.originalname.split('___');
                                return fileDocId === doc.id;
                            });

                            if (fileToUpload) {
                                // Reconstruct original filename and upload
                                const [,,, ...originalNameParts] = fileToUpload.originalname.split('___');
                                const originalName = originalNameParts.join('___');
                                
                                const uploadedFile = await uploadFileToCloudinary({ ...fileToUpload, originalname: originalName }, employeeId);
                                
                                // Replace blob URL with permanent Cloudinary URL
                                historyItem.documents[i] = { ...doc, url: uploadedFile.url, fileName: uploadedFile.fileName, file: undefined };
                            }
                        }
                    }
                }
            }

            // Handle new files being added to the *latest* history item when approving a stage
            const lastHistoryItem = stageHistory[stageHistory.length - 1];
            if (lastHistoryItem) {
                 const newFilesForThisStage = req.files.filter(f => {
                    const [fileDocId] = f.originalname.split('___');
                    // Check if this file is not one of the blobs we just replaced.
                    // New files will have an ID that doesn't exist in the document list yet.
                    return !stageHistory.some(h => h.documents.some(d => d.id === fileDocId));
                });

                const uploadedNewFiles = await Promise.all(newFilesForThisStage.map(async (file) => {
                    const [docId, docType, ...originalNameParts] = file.originalname.split('___');
                    const originalName = originalNameParts.join('___');
                    const uploadedFile = await uploadFileToCloudinary({ ...file, originalname: originalName }, employeeId);
                    return {
                        id: docId,
                        type: docType,
                        uploadDate: new Date().toISOString(),
                        ...uploadedFile
                    };
                }));
                
                if (!lastHistoryItem.documents) lastHistoryItem.documents = [];
                lastHistoryItem.documents.push(...uploadedNewFiles);
            }
        }
        
        const dbPayload = {
            current_stage_id: requestData.currentStageId,
            stage_history: JSON.stringify(requestData.stageHistory),
            last_modified: new Date(),
        };

        const [result] = await db.query('UPDATE workflow_requests SET ? WHERE id = ?', [dbPayload, id]);

        if (result.affectedRows === 0) return res.status(404).json({ message: 'Workflow request not found.'});
        
        const [rows] = await db.query(`SELECT w.*, u.username as employee_id_username FROM workflow_requests w LEFT JOIN users u ON w.user_id = u.id WHERE w.id = ?`, [id]);
        
        const row = rows[0];
        const updatedRequest = {
             id: row.id,
            title: row.title || 'N/A',
            description: row.description || '',
            type: row.type || 'استيراد',
            priority: row.priority || 'منخفضة',
            currentStageId: row.current_stage_id || 1,
            creationDate: row.creation_date || new Date().toISOString(),
            lastModified: row.last_modified || new Date().toISOString(),
            stageHistory: safeJsonParse(row.stage_history, []),
            employeeId: row.employee_id_username,
        };
        res.json(updatedRequest);

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