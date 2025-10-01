const express = require('express');
const router = express.Router();
const db = require('../db.js');

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
            trackingNumber: req.tracking_number,
            estimatedCost: req.estimated_cost,
            actualCost: req.actual_cost,
            supplierInfo: safeJsonParse(req.supplier_info, undefined),
            expectedDeliveryDate: req.expected_delivery_date,
        }));
        res.json(requests);
    } catch (error) {
        console.error('Error fetching workflow requests:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching workflow requests.' });
    }
});

module.exports = router;
