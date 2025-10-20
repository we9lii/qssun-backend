const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.js');
const reportRoutes = require('./reports.js');
const userRoutes = require('./users.js');
const branchRoutes = require('./branches.js');
const workflowRoutes = require('./workflows.js');
const teamRoutes = require('./teams.js');
const notificationRoutes = require('./notifications.js');
const fcmRoutes = require('./fcm.js'); // For Push Notifications

router.use(authRoutes);
router.use(reportRoutes);
router.use(userRoutes);
router.use(branchRoutes);
router.use(workflowRoutes);
router.use(teamRoutes);
router.use(notificationRoutes);
router.use('/fcm-token', fcmRoutes); // Use the new FCM route

module.exports = router;