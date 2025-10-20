require('dotenv').config();
const express = require('express');
const cors = require('cors');
const allRoutes = require('./routes');
const db = require('./db.js');
const { initializeFirebase } = require('./routes/firebaseAdmin.js');

const app = express();

// Initialize Firebase Admin SDK
initializeFirebase();

// --- CORS Configuration ---
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://qrs.qssun.solar',
  'http://localhost',
  'capacitor://localhost',
  'https://localhost'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- Health Check Endpoint ---
app.get('/api/health', async (req, res) => {
    const dbStatus = await db.testConnection();
    if (dbStatus.status === 'ok') {
        res.status(200).json({ status: 'ok', message: 'Server is running.', database: dbStatus });
    } else {
        res.status(503).json({ status: 'error', message: 'Server is running, but database connection is failing.', database: dbStatus });
    }
});

// --- Routes ---
app.use('/api', allRoutes);

// --- Root Route ---
app.get('/', (req, res) => {
  res.send('Qssun Reports API is running!');
});

// --- Global Error Handling ---
app.use((err, req, res, next) => {
    console.error('--- UNHANDLED ERROR ---');
    console.error(err.stack);
    res.status(500).json({ 
        message: 'An unexpected internal server error occurred.',
    });
});

// --- Port Binding for Render ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is listening on http://0.0.0.0:${PORT}`);
  console.log(`🌐 Allowed Origins: ${allowedOrigins.join(', ')}`);
});

