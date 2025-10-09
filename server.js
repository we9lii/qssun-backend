require('dotenv').config();
const express = require('express');
const cors = require('cors');
const allRoutes = require('./routes');
const db = require('./db.js'); // Import for health check

const app = express();

// --- CORS (Updated configuration for web and mobile) ---
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://qrs.qssun.solar',
  'http://localhost',       // For Capacitor WebView on Android
  'capacitor://localhost'   // Another common origin for Capacitor
];

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
// Increase the body limit to handle large file uploads within JSON payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// --- Health check endpoint (My addition for diagnostics) ---
app.get('/api/health', async (req, res) => {
    console.log('Received health check request.');
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

// --- Global Error Handling Middleware (My addition for robustness) ---
app.use((err, req, res, next) => {
    console.error('--- UNHANDLED ERROR ---');
    console.error(err.stack);
    console.error('-----------------------');
    res.status(500).json({ 
        message: 'An unexpected internal server error occurred.',
    });
});

// --- Port Binding (User's required configuration for Render) ---
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is listening on http://0.0.0.0:${PORT}`);
  console.log(`🌐 Allowed Origins: ${allowedOrigins.join(', ')}`);
});
