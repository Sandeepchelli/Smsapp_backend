const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, requireRole(['Cashier', 'Admin']));

// 1. GET /api/cashier/students - Search students by Name, Roll No, or Department
router.get('/students', (req, res) => {
  const { search } = req.query;
  let query = `
    SELECT s.id as student_id, s.roll_no, s.department, s.year, s.semester,
           u.id as user_id, u.name as student_name, u.email as student_email, u.phone as student_phone,
           c.name as class_name, c.section,
           p.name as parent_name, p.phone as parent_phone,
           sf.total_fee, sf.paid_amount, sf.pending_amount
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    LEFT JOIN users p ON s.parent_id = p.id
    LEFT JOIN student_fees sf ON s.id = sf.student_id
    WHERE 1=1
  `;
  const params = [];

  if (search && search.trim()) {
    query += ` AND (u.name LIKE ? OR s.roll_no LIKE ? OR s.department LIKE ? OR c.name LIKE ?)`;
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term);
  }

  query += ` ORDER BY u.name ASC LIMIT 50`;

  const students = db.prepare(query).all(...params);
  res.json({ students });
});

// 2. GET /api/cashier/student-fee/:studentId - Full fee details & payment history
router.get('/student-fee/:studentId', (req, res) => {
  const studentId = req.params.studentId;

  const student = db.prepare(`
    SELECT s.id as student_id, s.roll_no, s.department, s.year, s.semester,
           u.name as student_name, u.phone as student_phone, u.email as student_email,
           c.name as class_name,
           p.name as parent_name, p.phone as parent_phone
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    LEFT JOIN users p ON s.parent_id = p.id
    WHERE s.id = ?
  `).get(studentId);

  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  // Get or initialize fee record
  let fee = db.prepare(`SELECT * FROM student_fees WHERE student_id = ?`).get(studentId);
  if (!fee) {
    db.prepare(`
      INSERT INTO student_fees (student_id, department, year, semester, total_fee, paid_amount, pending_amount)
      VALUES (?, ?, ?, ?, 80000, 0, 80000)
    `).run(studentId, student.department, student.year, student.semester);
    fee = db.prepare(`SELECT * FROM student_fees WHERE student_id = ?`).get(studentId);
  }

  // Always enforce formula: Pending Amount = Total Fee - Total Paid Amount
  const calculatedPending = Math.max(0, fee.total_fee - fee.paid_amount);

  // Get payment history
  const payments = db.prepare(`
    SELECT * FROM fee_payments 
    WHERE student_id = ? 
    ORDER BY id DESC
  `).all(studentId);

  res.json({
    student,
    fee: {
      ...fee,
      pending_amount: calculatedPending
    },
    payments
  });
});

// 3. POST /api/cashier/payment - Record a new payment and update fee ledger
router.post('/payment', (req, res) => {
  const { studentId, amount, paymentMethod = 'Cash', notes = '' } = req.body;
  const cashierId = req.user.id;
  const cashierName = req.user.name;

  if (!studentId || !amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid studentId and positive payment amount are required.' });
  }

  const payAmount = parseFloat(amount);

  const student = db.prepare(`
    SELECT s.*, u.name as student_name, s.user_id as student_user_id, p.id as parent_user_id
    FROM students s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN users p ON s.parent_id = p.id
    WHERE s.id = ?
  `).get(studentId);

  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  let fee = db.prepare(`SELECT * FROM student_fees WHERE student_id = ?`).get(studentId);
  if (!fee) {
    db.prepare(`
      INSERT INTO student_fees (student_id, department, year, semester, total_fee, paid_amount, pending_amount)
      VALUES (?, ?, ?, ?, 80000, 0, 80000)
    `).run(studentId, student.department, student.year, student.semester);
    fee = db.prepare(`SELECT * FROM student_fees WHERE student_id = ?`).get(studentId);
  }

  const currentPending = fee.total_fee - fee.paid_amount;
  if (payAmount > currentPending) {
    return res.status(400).json({
      error: `Payment amount (₹${payAmount.toLocaleString()}) exceeds the total pending balance (₹${currentPending.toLocaleString()}).`
    });
  }

  // Calculate new amounts using the exact formula
  const newPaid = fee.paid_amount + payAmount;
  const newPending = fee.total_fee - newPaid;
  const receiptNo = `REC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const paymentDate = new Date().toISOString().split('T')[0];

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Update student fee ledger
    db.prepare(`
      UPDATE student_fees
      SET paid_amount = ?, pending_amount = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newPaid, newPending, fee.id);

    // 2. Create payment transaction record
    const insertPayment = db.prepare(`
      INSERT INTO fee_payments (
        student_id, fee_id, amount, payment_date, payment_method, receipt_no, cashier_id, cashier_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPayment.run(
      studentId,
      fee.id,
      payAmount,
      paymentDate,
      paymentMethod,
      receiptNo,
      cashierId,
      cashierName
    );

    // 3. Notify Student and Parent of payment receipt
    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, 'FEE_UPDATE')
    `);

    const notifMsg = `Payment of ₹${payAmount.toLocaleString()} received successfully via ${paymentMethod}.\nReceipt: ${receiptNo}\nUpdated Paid: ₹${newPaid.toLocaleString()} | Remaining Pending: ₹${newPending.toLocaleString()}`;
    
    // Notify student
    insertNotif.run(student.user_id, 'Fee Payment Receipt Generated', notifMsg);

    // Notify linked parent
    if (student.parent_id) {
      insertNotif.run(student.parent_id, `Fee Payment Received: ${student.student_name}`, notifMsg);
    }

    db.exec('COMMIT;');

    res.json({
      message: `Payment of ₹${payAmount.toLocaleString()} recorded successfully!`,
      receiptNo,
      totalFee: fee.total_fee,
      paidAmount: newPaid,
      pendingAmount: newPending
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('Error saving payment:', err);
    res.status(500).json({ error: 'Failed to process payment: ' + err.message });
  }
});

// 4. GET /api/cashier/stats - Overview metrics
router.get('/stats', (req, res) => {
  const totalCollected = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM fee_payments`).get().total;
  const totalPending = db.prepare(`SELECT COALESCE(SUM(pending_amount), 0) as total FROM student_fees`).get().total;
  const totalTransactions = db.prepare(`SELECT COUNT(*) as count FROM fee_payments`).get().count;

  res.json({
    totalCollected,
    totalPending,
    totalTransactions
  });
});

// 5. GET /api/cashier/fees - List student fees
router.get('/fees', (req, res) => {
  const fees = db.prepare(`
    SELECT sf.*, u.name as student_name, s.roll_no, c.name as class_name
    FROM student_fees sf
    JOIN students s ON sf.student_id = s.id
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
  `).all();
  res.json({ fees });
});

module.exports = router;
