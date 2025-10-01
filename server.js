require('dotenv').config();
const express = require('express');
const cors = require('cors');
const allRoutes = require('./routes'); // Central route handler

const app = express();

// CORS Configuration
const corsOptions = {
  origin: 'https://qrs.qssun.solar', // Allow only your frontend to access
  optionsSuccessStatus: 200 // For legacy browser support
};

// Middleware
app.use(cors(corsOptions));
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
