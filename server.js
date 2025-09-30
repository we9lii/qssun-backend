require('dotenv').config();
const express = require('express');
const cors = require('cors');

console.log("Loading routes...");
const authRoutes = require('./routes/auth.js');
console.log("-> auth.js loaded.");
const reportRoutes = require('./routes/reports.js');
console.log("-> reports.js loaded.");
const userRoutes = require('./routes/users.js');
console.log("-> users.js loaded.");
const branchRoutes = require('./routes/branches.js');
console.log("-> branches.js loaded.");
const workflowRoutes = require('./routes/workflow.js');
console.log("-> workflow.js loaded.");
console.log("All routes loaded successfully.");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', authRoutes);
app.use('/api', reportRoutes);
app.use('/api', userRoutes);
app.use('/api', branchRoutes);
app.use('/api', workflowsRoutes);


app.get('/', (req, res) => {
    res.send('Qssun Reports API is running!');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});