const express = require('express');
const db = require('../db');
const router = express.Router();

// POST /api/login
router.post('/login', async (req, res) => {
    const { employeeId, password } = req.body;

    if (!employeeId || !password) {
        return res.status(400).json({ message: 'Employee ID and password are required.' });
    }

    try {
        const [userRows] = await db.query('SELECT * FROM users WHERE username = ?', [employeeId]);
        
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'Employee not found.' });
        }
        
        const user = userRows[0];

        if (user.password !== password) {
            console.warn('Security Warning: Storing and comparing passwords in plain text is insecure. Use a hashing library like bcrypt.');
            return res.status(401).json({ message: 'Incorrect password.' });
        }
        
        let branchName = 'N/A';
        if (user.branch_id) {
            const [branchRows] = await db.query('SELECT name FROM branches WHERE id = ?', [user.branch_id]);
            if (branchRows.length > 0) {
                branchName = branchRows[0].name;
            }
        }
        
        const userForFrontend = {
            id: user.id.toString(),
            employeeId: user.username,
            name: user.full_name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            branch: branchName,
            department: user.department || 'N/A',
            position: user.position || 'N/A',
            joinDate: user.created_at,
            employeeType: user.employee_type || 'Technician',
            hasImportExportPermission: !!user.has_import_export_permission,
            isFirstLogin: !!user.is_first_login,
        };

        res.json(userForFrontend);

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

module.exports = router;