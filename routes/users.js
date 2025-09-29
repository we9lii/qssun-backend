const express = require('express');
const db = require('../db');
const router = express.Router();

// Helper to map DB record (snake_case) to App User object (camelCase)
const mapDataToUser = (data) => {
    if (!data) return data;
    return {
        id: data.id.toString(),
        employeeId: data.username,
        name: data.full_name,
        email: data.email,
        phone: data.phone,
        role: data.role.charAt(0).toUpperCase() + data.role.slice(1),
        branch: data.branch_name, // Assumes a join or separate query
        department: data.department || 'N/A',
        position: data.position || 'N/A',
        joinDate: data.created_at,
        employeeType: data.employee_type || 'Technician',
        hasImportExportPermission: !!data.has_import_export_permission,
        isFirstLogin: !!data.is_first_login,
    };
};


// GET /api/users - Fetches all users with their branch names
router.get('/users', async (req, res) => {
    try {
        const query = `
            SELECT 
                u.*,
                b.name AS branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            ORDER BY u.created_at DESC;
        `;
        const [users] = await db.query(query);
        res.json(users.map(mapDataToUser));
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Internal server error while fetching users.' });
    }
});

// POST /api/users - Creates a new user
router.post('/users', async (req, res) => {
    const { name, employeeId, email, phone, password, branch, department, position, employeeType, hasImportExportPermission, role } = req.body;

    if (!name || !employeeId || !email || !password || !branch || !role) {
        return res.status(400).json({ message: 'Missing required fields for new user.' });
    }

    try {
        const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [branch]);
        if (branchRows.length === 0) {
            return res.status(404).json({ message: `Branch '${branch}' not found.` });
        }
        const branchId = branchRows[0].id;

        const newUser = {
            username: employeeId,
            password, // In a real app, this should be hashed
            email,
            full_name: name,
            phone,
            role: role.toLowerCase(),
            branch_id: branchId,
            department,
            position,
            employee_type: employeeType,
            has_import_export_permission: hasImportExportPermission,
            is_active: 1,
            is_first_login: true,
        };

        const [result] = await db.query('INSERT INTO users SET ?', newUser);
        
        const [createdUserRows] = await db.query(`
            SELECT u.*, b.name as branch_name 
            FROM users u 
            LEFT JOIN branches b ON u.branch_id = b.id 
            WHERE u.id = ?
        `, [result.insertId]);

        res.status(201).json(mapDataToUser(createdUserRows[0]));
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ message: 'Internal server error while creating user.' });
    }
});

// PUT /api/users/:userId - Updates an existing user
router.put('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    const { name, employeeId, email, phone, branch, department, position, employeeType, hasImportExportPermission, role } = req.body;

    try {
        const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [branch]);
        if (branchRows.length === 0) {
            return res.status(404).json({ message: `Branch '${branch}' not found.` });
        }
        const branchId = branchRows[0].id;
        
        const updatedUser = {
            username: employeeId,
            email,
            full_name: name,
            phone,
            role: role.toLowerCase(),
            branch_id: branchId,
            department,
            position,
            employee_type: employeeType,
            has_import_export_permission: hasImportExportPermission,
        };

        await db.query('UPDATE users SET ? WHERE id = ?', [updatedUser, userId]);
        
        const [updatedUserRows] = await db.query(`
            SELECT u.*, b.name as branch_name 
            FROM users u 
            LEFT JOIN branches b ON u.branch_id = b.id 
            WHERE u.id = ?
        `, [userId]);

        res.status(200).json(mapDataToUser(updatedUserRows[0]));
    } catch (error) {
        console.error(`Error updating user ${userId}:`, error);
        res.status(500).json({ message: 'Internal server error while updating user.' });
    }
});


// DELETE /api/users/:userId - Deletes a user
router.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        // You might want to check for related records before deleting
        await db.query('DELETE FROM users WHERE id = ?', [userId]);
        res.status(200).json({ message: 'User deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting user ${userId}:`, error);
        res.status(500).json({ message: 'Internal server error while deleting user.' });
    }
});


module.exports = router;