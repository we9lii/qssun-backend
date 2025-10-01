const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require('multer');
const { supabase } = require('./supabaseClient.js');

// Setup multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper to upload a file to Supabase
const uploadFileToSupabase = async (file, employeeId) => {
    // Encode the original filename to handle Arabic characters and spaces safely
    const encodedName = encodeURIComponent(file.originalname);
    const filePath = `public/workflows/${employeeId}/${Date.now()}-${encodedName}`;
    
    const { error } = await supabase.storage
        .from('report-attachments')
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
        });

    if (error) throw error;

    const { data } = supabase.storage
        .from('report-attachments')
        .getPublicUrl(filePath);

    return { url: data.publicUrl, fileName: file.originalname };
};

// Helper to safely parse JSON. Now handles non-string inputs silently.
const safeJsonParse = (json, defaultValue) => {
    if (typeof json !== 'string') {
        return defaultValue;
    }
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
            employeeId: req.employee_id_username, // Add the creator's employeeId
        }));
        res.json(requests);
    } catch (error) {
        console.error('Error fetching workflow requests:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// PUT /api/workflow-requests/:id
router.put('/workflow-requests/:id', upload.any(), async (req, res) => {
    const { id } = req.params;
    try {
        if (!req.body.requestData) return res.status(400).json({ message: 'requestData is missing.' });
        
        const requestData = JSON.parse(req.body.requestData);
        // This employeeId now comes reliably from the frontend, which got it from the GET request
        const employeeId = requestData.employeeId; 

        if (!employeeId) {
            return res.status(400).json({ message: 'Employee ID is missing from the request.' });
        }

        if (req.files && req.files.length > 0) {
            const lastHistoryItem = requestData.stageHistory[requestData.stageHistory.length - 1];
            
            for (const file of req.files) {
                 const nameParts = file.originalname.split('___');
                if (nameParts.length !== 3) {
                    console.warn(`Skipping file with invalid name format: ${file.originalname}`);
                    continue;
                }
                const [docId, docType, originalName] = nameParts;
                const uploadedFile = await uploadFileToSupabase({ ...file, originalname: originalName }, employeeId);
                
                const document = {
                    id: docId,
                    type: docType,
                    uploadDate: new Date().toISOString(),
                    ...uploadedFile
                };
                
                if (lastHistoryItem) {
                    if (!lastHistoryItem.documents) lastHistoryItem.documents = [];
                    lastHistoryItem.documents.push(document);
                }
            }
        }
        
        const dbPayload = {
            current_stage_id: requestData.currentStageId,
            stage_history: JSON.stringify(requestData.stageHistory),
            last_modified: new Date(),
        };

        await db.query('UPDATE workflow_requests SET ? WHERE id = ?', [dbPayload, id]);
        
        // Fetch the updated record to return the most current state
        const [rows] = await db.query(`
            SELECT w.*, u.username as employee_id_username
            FROM workflow_requests w
            LEFT JOIN users u ON w.user_id = u.id
            WHERE w.id = ?
        `, [id]);
        
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


module.exports = router;