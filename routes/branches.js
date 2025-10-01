const express = require('express');
const router = express.Router();
const db = require('../db.js');

// GET /api/branches
router.get('/branches', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM branches ORDER BY created_at DESC');
        const branches = rows.map(branch => ({
            id: branch.id.toString(),
            name: branch.name || 'N/A',
            location: branch.location || 'N/A',
            phone: branch.phone || 'N/A',
            manager: branch.manager_name || 'N/A',
            creationDate: branch.created_at || new Date().toISOString(),
        }));
        res.json(branches);
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching branches.' });
    }
});

module.exports = router;
