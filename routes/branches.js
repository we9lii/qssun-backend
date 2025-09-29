const express = require('express');
const db = require('../db');
const router = express.Router();

const mapDbToApp = (dbRecord) => ({
    id: dbRecord.id.toString(),
    name: dbRecord.name,
    location: dbRecord.location,
    phone: dbRecord.phone,
    manager: dbRecord.manager_name,
    creationDate: dbRecord.created_at,
});

// GET /api/branches
router.get('/branches', async (req, res) => {
    try {
        const [branches] = await db.query('SELECT * FROM branches ORDER BY created_at DESC');
        res.json(branches.map(mapDbToApp));
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).json({ message: 'Internal server error while fetching branches.' });
    }
});

// POST /api/branches
router.post('/branches', async (req, res) => {
    const { name, location, phone, manager } = req.body;
    if (!name || !location) {
        return res.status(400).json({ message: 'Branch name and location are required.' });
    }
    try {
        const newBranch = {
            name,
            location,
            phone,
            manager_name: manager,
        };
        const [result] = await db.query('INSERT INTO branches SET ?', newBranch);
        const [createdBranch] = await db.query('SELECT * FROM branches WHERE id = ?', [result.insertId]);
        res.status(201).json(mapDbToApp(createdBranch[0]));
    } catch (error) {
        console.error('Error creating branch:', error);
        res.status(500).json({ message: 'Internal server error while creating branch.' });
    }
});

// PUT /api/branches/:branchId
router.put('/branches/:branchId', async (req, res) => {
    const { branchId } = req.params;
    const { name, location, phone, manager } = req.body;
    try {
        const updatedBranch = {
            name,
            location,
            phone,
            manager_name: manager,
        };
        await db.query('UPDATE branches SET ? WHERE id = ?', [updatedBranch, branchId]);
        const [refetchedBranch] = await db.query('SELECT * FROM branches WHERE id = ?', [branchId]);
        res.status(200).json(mapDbToApp(refetchedBranch[0]));
    } catch (error) {
        console.error(`Error updating branch ${branchId}:`, error);
        res.status(500).json({ message: 'Internal server error while updating branch.' });
    }
});

// DELETE /api/branches/:branchId
router.delete('/branches/:branchId', async (req, res) => {
    const { branchId } = req.params;
    try {
        // Add check here if any users are assigned to this branch before deleting
        await db.query('DELETE FROM branches WHERE id = ?', [branchId]);
        res.status(200).json({ message: 'Branch deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting branch ${branchId}:`, error);
        res.status(500).json({ message: 'Internal server error while deleting branch.' });
    }
});


module.exports = router;
