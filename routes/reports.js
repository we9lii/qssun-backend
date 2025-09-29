const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/reports - Fetches all reports
router.get('/reports', async (req, res) => {
    try {
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
                if (typeof report.details === 'string') {
                    parsedDetails = JSON.parse(report.details);
                }
            } catch (e) {
                console.error(`Failed to parse details for report ID ${report.id}:`, e);
                parsedDetails = { raw: report.details, error: "Invalid JSON" }; 
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

// POST /api/reports - Creates a new report
router.post('/reports', async (req, res) => {
    const {
        employeeId,
        branch,
        type,
        status,
        details,
    } = req.body;

    if (!employeeId || !type || !details) {
        return res.status(400).json({ message: 'Missing required report data.' });
    }

    try {
        // Find user_id from employeeId (username)
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        const userId = userRows[0].id;

        // Find branch_id from branch name
        const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [branch]);
        if (branchRows.length === 0) {
            return res.status(404).json({ message: 'Branch not found.' });
        }
        const branchId = branchRows[0].id;

        // Prepare the report for insertion
        const newReport = {
            user_id: userId,
            branch_id: branchId,
            report_type: type,
            content: JSON.stringify(details), // Stringify the details object
            status: status,
        };

        // Insert the report and get the new ID
        const [result] = await db.query('INSERT INTO reports SET ?', newReport);
        const newReportId = result.insertId;

        // Fetch the complete report to return to the frontend
        const [createdReportRows] = await db.query(`
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
            WHERE r.id = ?;
        `, [newReportId]);
        
        const createdReport = createdReportRows[0];
        createdReport.details = JSON.parse(createdReport.details);

        res.status(201).json(createdReport);

    } catch (error) {
        console.error('Error creating report:', error);
        res.status(500).json({ message: 'An internal server error occurred while creating the report.' });
    }
});

// DELETE /api/reports/:reportId - Deletes a report
router.delete('/reports/:reportId', async (req, res) => {
    const { reportId } = req.params;
    try {
        await db.query('DELETE FROM reports WHERE id = ?', [reportId]);
        res.status(200).json({ message: 'Report deleted successfully' });
    } catch (error) {
        console.error(`Error deleting report ${reportId}:`, error);
        res.status(500).json({ message: 'Internal server error while deleting report.' });
    }
});


module.exports = router;