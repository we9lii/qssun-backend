require('dotenv').config();
const express = require('express');
const cors = require('cors');
const allRoutes = require('./routes'); // Central route handler

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Use the central router
app.use('/api', allRoutes);

app.get('/', (req, res) => {
    res.send('Qssun Reports API is running!');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});