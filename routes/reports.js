const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/reports
router.get('/reports', async (req, res) => {
    try {
        // This query joins reports with users and branches to get all necessary info.
        // It provides a static 'N/A' value for 'department' to prevent query failure,
        // as this column does not exist in the 'users' table.
        const query = `
            SELECT 
                r.id,
                u.username AS employeeId,
                u.full_name AS employeeName,
                b.name AS branch,
                'N/A' AS department,
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
        const reports = rows.map(report => {
            let parsedDetails = report.details;
            try {
                if (typeof report.details === 'string') {
                    parsedDetails = JSON.parse(report.details);
                }
            } catch (e) {
                console.error(`Failed to parse details for report ID ${report.id}:`, e);
                // Keep details as is or set to an empty object if parsing fails
                parsedDetails = report.details; 
            }
            return {
                ...report,
                details: parsedDetails
            };
        });

        res.json(reports);

    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching reports.' });
    }
});

module.exports = router;
