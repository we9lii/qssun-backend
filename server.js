require('dotenv').config();
const express = require('express');
const cors = require('cors');
const allRoutes = require('./routes'); // Central route handler

const app = express();

// --- CORS Configuration ---
// تأكد من إزالة المسافات الزائدة في الـ origin
const allowedOrigin = process.env.FRONTEND_URL || 'https://qrs.qssun.solar';

const corsOptions = {
  origin: allowedOrigin.trim(), // تنظيف أي مسافات زائدة
  optionsSuccessStatus: 200, // دعم المتصفحات القديمة
};

// --- Middleware ---
app.use(cors(corsOptions));
app.use(express.json()); // لتحليل JSON من الطلبات

// --- Routes ---
app.use('/api', allRoutes);

// --- Root Route ---
app.get('/', (req, res) => {
  res.status(200).send('✅ Qssun Reports API is running successfully!');
});

// --- Port Binding (مهم جدًا لـ Render) ---
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is now live on http://0.0.0.0:${PORT}`);
  console.log(`🌐 Frontend allowed: ${corsOptions.origin}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});