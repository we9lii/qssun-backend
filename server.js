require('dotenv').config();
const express = require('express');
const cors = require('cors');
const allRoutes = require('./routes');

const app = express();

// --- CORS ---
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'https://qrs.qssun.solar',
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// --- Routes ---
app.use('/api', allRoutes);

// --- Root Route ---
app.get('/', (req, res) => {
  res.send('Qssun Reports API is running!');
});

// --- Port Binding (ضروري لـ Render) ---
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is listening on http://0.0.0.0:${PORT}`);
  console.log(`🌐 Frontend: ${corsOptions.origin}`);
});