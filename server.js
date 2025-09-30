require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// استخدام path.resolve لضمان مسارات مطلقة وموثوقة
const authRoutes = require(path.resolve(__dirname, 'routes/auth.js'));
const reportRoutes = require(path.resolve(__dirname, 'routes/reports.js'));
const userRoutes = require(path.resolve(__dirname, 'routes/users.js'));
const branchRoutes = require(path.resolve(__dirname, 'routes/branches.js'));
const workflowRoutes = require(path.resolve(__dirname, 'routes/workflow.js'));

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', authRoutes);
app.use('/api', reportRoutes);
app.use('/api', userRoutes);
app.use('/api', branchRoutes);
app.use('/api', workflowRoutes);


app.get('/', (req, res) => {
    res.send('Qssun Reports API is running!');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
