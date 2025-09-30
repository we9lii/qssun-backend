require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth.js');
const reportRoutes = require('./routes/reports.js');
const userRoutes = require('./routes/users.js');
const branchRoutes = require('./routes/branches.js');
const workflowRoutes = require('./routes/workflow.js');

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