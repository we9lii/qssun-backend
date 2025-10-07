const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.js');
const reportRoutes = require('./reports.js');
const userRoutes = require('./users.js');
const branchRoutes = require('./branches.js');
const workflowsRoutes = require('./workflows.js');
const teamsRoutes = require('./teams.js');

router.use(authRoutes);
router.use(reportRoutes);
router.use(userRoutes);
router.use(branchRoutes);
router.use(workflowsRoutes);
router.use(teamsRoutes);

module.exports = router;
