const express = require('express');
const router = express.Router();
const db = require('../db.js');

// GET /api/workflow-requests
router.get('/workflow-requests', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM workflow_requests ORDER BY creation_date DESC');
        const requests = rows.map(req => ({
            id: req.id,
            title: req.title,
            description: req.description,
            type: req.type,
            priority: req.priority,
            currentStageId: req.current_stage_id,
            creationDate: req.creation_date,
            lastModified: req.last_modified,
            stageHistory: req.stage_history ? JSON.parse(req.stage_history) : [],
            trackingNumber: req.tracking_number,
            estimatedCost: req.estimated_cost,
            actualCost: req.actual_cost,
            supplierInfo: req.supplier_info ? JSON.parse(req.supplier_info) : undefined,
            expectedDeliveryDate: req.expected_delivery_date,
        }));
        res.json(requests);
    } catch (error) {
        console.error('Error fetching workflow requests:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching workflow requests.' });
    }
});

module.exports = router;
