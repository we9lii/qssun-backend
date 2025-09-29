const express = require('express');
const db = require('../db');
const router = express.Router();

// Helper to map DB record to frontend format
const mapDbToApp = (dbRecord) => {
    let history = dbRecord.stage_history;
    try {
        if (typeof history === 'string') {
            history = JSON.parse(history);
        }
    } catch(e) { console.error('Error parsing stage history', e); }

    return {
        id: dbRecord.id,
        title: dbRecord.title,
        description: dbRecord.description,
        type: dbRecord.type,
        priority: dbRecord.priority,
        currentStageId: dbRecord.current_stage_id,
        creationDate: dbRecord.creation_date,
        lastModified: dbRecord.last_modified,
        stageHistory: history,
        // Joined fields
        employeeName: dbRecord.employeeName,
    };
};

// GET /api/workflows
router.get('/workflows', async (req, res) => {
    try {
        const query = `
            SELECT 
                w.*,
                u.full_name AS employeeName
            FROM workflow_requests w
            JOIN users u ON w.user_id = u.id
            ORDER BY w.creation_date DESC;
        `;
        const [rows] = await db.query(query);
        res.json(rows.map(mapDbToApp));
    } catch (error) {
        console.error('Error fetching workflow requests:', error);
        res.status(500).json({ message: 'Internal server error while fetching workflows.' });
    }
});

// POST /api/workflows
router.post('/workflows', async (req, res) => {
    const { id, title, description, type, priority, currentStageId, stageHistory, employeeId } = req.body;

    if (!id || !title || !type || !priority || !employeeId) {
        return res.status(400).json({ message: 'Missing required fields for workflow request.' });
    }

    try {
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'Associated user not found.' });
        }
        const userId = userRows[0].id;

        const newRequest = {
            id,
            user_id: userId,
            title,
            description,
            type,
            priority,
            current_stage_id: currentStageId,
            stage_history: JSON.stringify(stageHistory),
        };

        await db.query('INSERT INTO workflow_requests SET ?', newRequest);

        // Fetch the created request to return it with all details
        const [createdRows] = await db.query(`
            SELECT 
                w.*,
                u.full_name AS employeeName
            FROM workflow_requests w
            JOIN users u ON w.user_id = u.id
            WHERE w.id = ?;
        `, [id]);

        res.status(201).json(mapDbToApp(createdRows[0]));

    } catch (error) {
        console.error('Error creating workflow request:', error);
        res.status(500).json({ message: 'Internal server error while creating workflow.' });
    }
});

// PUT /api/workflows/:requestId - Updates a workflow request
router.put('/workflows/:requestId', async (req, res) => {
    const { requestId } = req.params;
    const { currentStageId, stageHistory } = req.body;

    if (!currentStageId || !stageHistory) {
        return res.status(400).json({ message: 'Missing required fields for update.' });
    }

    try {
        const updatePayload = {
            current_stage_id: currentStageId,
            stage_history: JSON.stringify(stageHistory),
        };

        await db.query('UPDATE workflow_requests SET ? WHERE id = ?', [updatePayload, requestId]);

        res.status(200).json({ message: 'Workflow updated successfully.' });

    } catch (error) {
        console.error(`Error updating workflow request ${requestId}:`, error);
        res.status(500).json({ message: 'Internal server error while updating workflow.' });
    }
});

// DELETE /api/workflows/:requestId - Deletes a workflow request
router.delete('/workflows/:requestId', async (req, res) => {
    const { requestId } = req.params;
    try {
        await db.query('DELETE FROM workflow_requests WHERE id = ?', [requestId]);
        res.status(200).json({ message: 'Workflow request deleted successfully' });
    } catch (error) {
        console.error(`Error deleting workflow request ${requestId}:`, error);
        res.status(500).json({ message: 'Internal server error while deleting workflow request.' });
    }
});

module.exports = router;
