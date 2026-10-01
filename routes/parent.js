const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, requireRole(['Parent', 'Admin']));

// GET /api/parent/dashboard - Ward data for the logged in parent
router.get('/dashboard', (req, res) => {
  const parentId = req.user.id;

  // Look up student(s) linked to this parent via foreign key s.parent_id
  let student = db.prepare(`
    SELECT s.*, c.name as class_name, c.department as class_department, c.section, c.year, c.semester,
           u.name as student_name, u.email as student_email, u.phone as student_phone
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    WHERE s.parent_id = ?
    LIMIT 1
  `).get(parentId);

  // If Admin is viewing or fallback for demo
  if (!student && req.user.role === 'Admin') {
    student = db.prepare(`
      SELECT s.*, c.name as class_name, c.department as class_department, c.section, c.year, c.semester,
             u.name as student_name, u.email as student_email, u.phone as student_phone
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN classes c ON s.class_id = c.id
      LIMIT 1
    `).get();
  }

  if (!student) {
    return res.status(404).json({ error: 'No student linked to this parent account.' });
  }

  // Attendance history
  const attendanceRecords = db.prepare(`
    SELECT * FROM attendance 
    WHERE student_id = ? 
    ORDER BY date DESC, period DESC 
    LIMIT 50
  `).all(student.id);

  const totalPeriods = attendanceRecords.length;
  const presentPeriods = attendanceRecords.filter(a => a.status === 'Present').length;
  const onLeavePeriods = attendanceRecords.filter(a => a.status === 'On Leave').length;
  const absentPeriods = attendanceRecords.filter(a => a.status === 'Absent').length;
  const attendancePercentage = totalPeriods > 0 
    ? Math.round(((presentPeriods + onLeavePeriods) / totalPeriods) * 100) 
    : 100;

  // Fee ledger
  let feeLedger = db.prepare(`
    SELECT * FROM student_fees WHERE student_id = ?
  `).get(student.id);

  if (!feeLedger) {
    feeLedger = { total_fee: 80000, paid_amount: 0, pending_amount: 80000 };
  }

  const paymentHistory = db.prepare(`
    SELECT * FROM fee_payments WHERE student_id = ? ORDER BY id DESC
  `).all(student.id);

  // Permissions submitted by ward
  const permissions = db.prepare(`
    SELECT * FROM permission_requests WHERE student_id = ? ORDER BY id DESC LIMIT 20
  `).all(student.id);

  // Notifications for this parent
  const parentNotifs = db.prepare(`
    SELECT * FROM notifications 
    WHERE user_id = ? 
    ORDER BY id DESC 
    LIMIT 30
  `).all(parentId);

  res.json({
    parent: {
      name: req.user.name,
      username: req.user.username,
      phone: req.user.phone,
      email: req.user.email
    },
    ward: student,
    attendance: {
      percentage: attendancePercentage,
      totalPeriods,
      presentPeriods,
      onLeavePeriods,
      absentPeriods,
      records: attendanceRecords
    },
    fees: {
      ...feeLedger,
      history: paymentHistory
    },
    permissions,
    notifications: parentNotifs
  });
});

module.exports = router;
