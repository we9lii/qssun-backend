const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.js');
const reportRoutes = require('./reports.js');
const userRoutes = require('./users.js');
const branchRoutes = require('./branches.js');
const workflowsRoutes = require('./workflows.js'); // Corrected file name

router.use(authRoutes);
router.use(reportRoutes);
router.use(userRoutes);
router.use(branchRoutes);
router.use(workflowsRoutes); // Using the correct routes

module.exports = router;