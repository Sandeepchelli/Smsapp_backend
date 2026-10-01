const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, requireRole(['Student', 'Admin']));

// Helper to get student record for current user
function getStudentByUserId(userId) {
  return db.prepare(`
    SELECT s.*, c.name as class_name, c.department as class_department, c.section, c.year as class_year, c.semester as class_semester,
           u.name as student_name, u.email as student_email, u.phone as student_phone,
           p.name as parent_name, p.phone as parent_phone
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    LEFT JOIN users p ON s.parent_id = p.id
    WHERE s.user_id = ?
  `).get(userId);
}

// 1. GET /api/student/dashboard
router.get('/dashboard', (req, res) => {
  const student = getStudentByUserId(req.user.id);
  if (!student) {
    return res.status(404).json({ error: 'Student record not found.' });
  }

  // Attendance stats
  const attendanceRecords = db.prepare(`
    SELECT * FROM attendance 
    WHERE student_id = ? 
    ORDER BY date DESC, period DESC 
    LIMIT 100
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

  // Permission requests
  const permissions = db.prepare(`
    SELECT * FROM permission_requests WHERE student_id = ? ORDER BY id DESC LIMIT 20
  `).all(student.id);

  res.json({
    student,
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
    permissions
  });
});

// 2. POST /api/student/leave-request
router.post('/leave-request', (req, res) => {
  const student = getStudentByUserId(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const { date, startPeriod, endPeriod, reason, notes } = req.body;
  if (!date || !reason) {
    return res.status(400).json({ error: 'Date and Reason are required.' });
  }

  const stmt = db.prepare(`
    INSERT INTO permission_requests (
      student_id, type, date, start_period, end_period, reason, notes,
      teacher_approval, principal_approval, final_status
    ) VALUES (?, 'LEAVE', ?, ?, ?, ?, ?, 'PENDING', 'PENDING', 'PENDING')
  `);

  const result = stmt.run(
    student.id,
    date,
    startPeriod ? parseInt(startPeriod, 10) : 1,
    endPeriod ? parseInt(endPeriod, 10) : 7,
    reason,
    notes || ''
  );

  // Notify assigned teachers of this class
  const teachers = db.prepare(`
    SELECT DISTINCT teacher_id FROM teacher_assignments WHERE class_id = ?
  `).all(student.class_id);

  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (?, ?, ?, 'LEAVE_REQUEST')
  `);

  for (const t of teachers) {
    insertNotif.run(
      t.teacher_id,
      `New Leave Request: ${student.student_name}`,
      `Student ${student.student_name} (${student.class_name}, Roll ${student.roll_no}) submitted a leave request for ${date}.\nReason: ${reason}`
    );
  }

  res.status(201).json({
    message: 'Leave request submitted successfully. Awaiting Teacher and Principal review.',
    requestId: result.lastInsertRowid
  });
});

// 3. POST /api/student/outing-request
router.post('/outing-request', (req, res) => {
  const student = getStudentByUserId(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const { date, leavingTime, expectedReturnTime, destination, reason, notes } = req.body;
  if (!date || !leavingTime || !expectedReturnTime || !destination || !reason) {
    return res.status(400).json({ error: 'All outing fields are required.' });
  }

  const stmt = db.prepare(`
    INSERT INTO permission_requests (
      student_id, type, date, leaving_time, expected_return_time, destination, reason, notes,
      teacher_approval, principal_approval, final_status
    ) VALUES (?, 'OUTING', ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', 'PENDING')
  `);

  const result = stmt.run(
    student.id,
    date,
    leavingTime,
    expectedReturnTime,
    destination,
    reason,
    notes || ''
  );

  // Notify teachers
  const teachers = db.prepare(`
    SELECT DISTINCT teacher_id FROM teacher_assignments WHERE class_id = ?
  `).all(student.class_id);

  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (?, ?, ?, 'OUTING_REQUEST')
  `);

  for (const t of teachers) {
    insertNotif.run(
      t.teacher_id,
      `New Outing Request: ${student.student_name}`,
      `Student ${student.student_name} requested outing permission for ${date} from ${leavingTime} to ${expectedReturnTime} to ${destination}.\nReason: ${reason}`
    );
  }

  res.status(201).json({
    message: 'Outing request submitted successfully. Awaiting Teacher and Principal review.',
    requestId: result.lastInsertRowid
  });
});

// 4. GET /api/student/permissions - History
router.get('/permissions', (req, res) => {
  const student = getStudentByUserId(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const list = db.prepare(`
    SELECT * FROM permission_requests WHERE student_id = ? ORDER BY id DESC
  `).all(student.id);

  res.json({ permissions: list });
});

module.exports = router;
