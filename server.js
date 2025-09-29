require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const workflowRoutes = require('./routes/workflows');
const userRoutes = require('./routes/users');
const branchRoutes = require('./routes/branches');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', authRoutes);
app.use('/api', reportRoutes);
app.use('/api', workflowRoutes);
app.use('/api', userRoutes);
app.use('/api', branchRoutes);

app.get('/', (req, res) => {
    res.send('Qssun Reports API is running!');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});