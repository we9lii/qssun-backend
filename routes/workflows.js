const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require('multer');
const { supabase } = require('./supabaseClient.js');

// Setup multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper to upload a file to Supabase
const uploadFileToSupabase = async (file, userId) => {
    const filePath = `public/workflows/${userId}/${Date.now()}-${file.originalname}`;
    
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

// Helper to safely parse JSON
const safeJsonParse = (jsonString, defaultValue) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Failed to parse JSON in workflow, returning default value:", e);
        return defaultValue;
    }
};

// GET /api/workflow-requests
router.get('/workflow-requests', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM workflow_requests ORDER BY creation_date DESC');
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
        const userId = requestData.stageHistory.find(h => h.processor)?.processor || 'system';

        if (req.files && req.files.length > 0) {
            // Find the most recent history item to attach files to
            const lastHistoryItem = requestData.stageHistory[requestData.stageHistory.length - 1];
            
            for (const file of req.files) {
                const [docId, docType, originalName] = file.originalname.split('___');
                const uploadedFile = await uploadFileToSupabase({ ...file, originalname: originalName }, userId);
                
                const document = {
                    id: docId,
                    type: docType,
                    uploadDate: new Date().toISOString(),
                    ...uploadedFile
                };
                
                if (lastHistoryItem) {
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
        
        // Fetch and return the complete updated request
        const [rows] = await db.query('SELECT * FROM workflow_requests WHERE id = ?', [id]);
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
        };

        res.json(updatedRequest);

    } catch (error) {
        console.error('Error updating workflow request:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});


module.exports = router;