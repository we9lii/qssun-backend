const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/reports
router.get('/reports', async (req, res) => {
    try {
        // This query joins reports with users and branches to get all necessary info
        // and formats the column names to match the frontend's camelCase convention.
        const query = `
            SELECT 
                r.id,
                u.username AS employeeId,
                u.full_name AS employeeName,
                b.name AS branch,
                u.department,
                r.report_type AS type,
                r.created_at AS date,
                r.status,
                r.report_data AS details
            FROM reports r
            JOIN users u ON r.user_id = u.id
            JOIN branches b ON r.branch_id = b.id
            ORDER BY r.created_at DESC;
        `;
        
        const [rows] = await db.query(query);

        // The 'details' column is stored as a JSON string in MySQL.
        // We need to parse it into an object for each report.
        const reports = rows.map(report => ({
            ...report,
            details: typeof report.details === 'string' ? JSON.parse(report.details) : report.details
        }));

        res.json(reports);

    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching reports.' });
    }
});

module.exports = router;
