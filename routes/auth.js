const express = require('express');
const router = express.Router();
const db = require('../db.js');

// POST /api/login
router.post('/login', async (req, res) => {
    const { employeeId, password } = req.body;

    if (!employeeId || !password) {
        return res.status(400).json({ message: 'Employee ID and password are required.' });
    }

    try {
        // 1. Find the user by username (which is the employeeId)
        const [userRows] = await db.query('SELECT * FROM users WHERE username = ?', [employeeId]);
        
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'Employee not found.' });
        }
        
        const user = userRows[0];

        // 2. Check the password (in a real app, use bcrypt.compare)
        if (user.password !== password) {
            console.warn('Security Warning: Storing and comparing passwords in plain text is insecure. Use a hashing library like bcrypt.');
            return res.status(401).json({ message: 'Incorrect password.' });
        }
        
        // 3. Get the branch name
        let branchName = 'N/A';
        if (user.branch_id) {
            const [branchRows] = await db.query('SELECT name FROM branches WHERE id = ?', [user.branch_id]);
            if (branchRows.length > 0) {
                branchName = branchRows[0].name;
            }
        }
        
        // 4. Construct the user object for the frontend
        // FIX: Ensure the role is capitalized ('Admin', 'Employee') to match frontend expectations.
        const role = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Employee';

        const userForFrontend = {
            id: user.id.toString(),
            employeeId: user.username || 'N/A',
            name: user.full_name || 'N/A',
            email: user.email || 'N/A',
            phone: user.phone || 'N/A',
            role: role, 
            branch: branchName,
            department: user.department || 'N/A',
            position: user.position || 'N/A',
            joinDate: user.created_at || new Date().toISOString(),
            employeeType: user.employee_type || 'Technician',
            hasImportExportPermission: !!user.has_import_export_permission,
        };

        res.json(userForFrontend);

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

module.exports = router;