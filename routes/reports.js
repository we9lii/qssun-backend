const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/reports
router.get('/reports', async (req, res) => {
    try {
        // CONFIRMED: The correct column name for report details is 'content'.
        // This query now reads from `r.content` and renames it to `details` for the frontend.
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
                r.content AS details
            FROM reports r
            JOIN users u ON r.user_id = u.id
            JOIN branches b ON r.branch_id = b.id
            ORDER BY r.created_at DESC;
        `;
        
        const [rows] = await db.query(query);

        const reports = rows.map(report => {
            let parsedDetails = report.details;
            try {
                // The 'details' (originally 'content') column is stored as a JSON string.
                // We need to parse it into an object for each report.
                if (typeof report.details === 'string') {
                    parsedDetails = JSON.parse(report.details);
                }
            } catch (e) {
                console.error(`Failed to parse details for report ID ${report.id}:`, e);
                // If parsing fails, return an object with the raw string to avoid crashing.
                parsedDetails = { raw: report.details }; 
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
