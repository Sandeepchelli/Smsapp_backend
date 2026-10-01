const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Ensure DB is initialized
require('./db');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const cashierRoutes = require('./routes/cashier');
const teacherRoutes = require('./routes/teacher');
const studentRoutes = require('./routes/student');
const parentRoutes = require('./routes/parent');
const notificationRoutes = require('./routes/notifications');
const resultsRoutes = require('./routes/results');
const libraryRoutes = require('./routes/library');
const timetableRoutes = require('./routes/timetable');
const canteenRoutes = require('./routes/canteen');
const usersRoutes = require('./routes/users');
const staffRoutes = require('./routes/staff');
const salaryRoutes = require('./routes/salary');
const noticesRoutes = require('./routes/notices');
const db = require('./db');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON body parser
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Public health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// General Announcements (Authenticated)
app.get('/api/announcements', authenticateToken, (req, res) => {
  const announcements = db.prepare('SELECT * FROM notifications WHERE type = "GENERAL" ORDER BY id DESC').all();
  res.json({ announcements });
});

// Mount modular routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cashier', cashierRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/canteen', canteenRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/notices', noticesRoutes);


// Unmatched API routes fallback to 404 JSON
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Global Error Handling Middleware (including JSON parse errors)
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.setHeader('Content-Type', 'application/json');
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload in request body' });
  }
  res.status(err.status || 500).json({ error: 'Internal server error: ' + (err.message || 'Unknown error') });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` EduSphere – Smart Campus Management System `);
  console.log(` Server active on port ${PORT}                     `);
  console.log(`====================================================`);
});
