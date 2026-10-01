const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// ─── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Get salary record for a user, including computed pending and payment status.
 * Pending = monthly_salary - total_paid (recalculated from actual payments)
 */
function getSalaryRecord(userId) {
  // Get or create salary ledger
  let ledger = db.prepare('SELECT * FROM staff_salaries WHERE user_id = ?').get(userId);
  if (!ledger) return null;

  // Recompute total_paid from actual payment records
  const totalPaidRow = db.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM salary_payments WHERE user_id = ?').get(userId);
  const totalPaid = totalPaidRow ? totalPaidRow.total : 0;

  const pendingAmount = Math.max(0, ledger.monthly_salary - totalPaid);

  let paymentStatus = 'Unpaid';
  if (totalPaid >= ledger.monthly_salary && ledger.monthly_salary > 0) {
    paymentStatus = 'Paid';
  } else if (totalPaid > 0) {
    paymentStatus = 'Partially Paid';
  }

  // Get last payment
  const lastPayment = db.prepare('SELECT * FROM salary_payments WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);

  return {
    ...ledger,
    total_paid: totalPaid,
    pending_amount: pendingAmount,
    payment_status: paymentStatus,
    last_payment_date: lastPayment ? lastPayment.payment_date : null,
    last_payment_amount: lastPayment ? lastPayment.amount_paid : null
  };
}

// ─── ADMIN ROUTES ──────────────────────────────────────────────────────────────

// GET /api/salary/staff-list - Admin: List all staff with salary info
router.get('/staff-list', requireRole(['Admin', 'Cashier']), (req, res) => {
  try {
    const staffRoles = ['Teacher', 'Librarian', 'Cashier', 'Lab Technician', 'Driver', 'Watchman', 'Attender', 'Attendant', 'OfficeStaff', 'Canteen', 'Canteen Staff', 'Library Staff', 'Cleaner', 'Other'];
    
    const users = db.prepare(`
      SELECT u.id, u.name, u.username, u.role, u.post, u.employee_id, u.department, u.profile_photo, u.is_active,
             ss.id as salary_id, ss.monthly_salary, ss.total_paid, ss.updated_at as salary_updated_at
      FROM users u
      LEFT JOIN staff_salaries ss ON u.id = ss.user_id
      WHERE u.role IN (${staffRoles.map(() => '?').join(',')})
      ORDER BY u.role, u.name
    `).all(...staffRoles);

    // Enrich with computed values
    const enriched = users.map(u => {
      const record = u.salary_id ? getSalaryRecord(u.id) : null;
      return {
        ...u,
        monthly_salary: record ? record.monthly_salary : 0,
        total_paid: record ? record.total_paid : 0,
        pending_amount: record ? record.pending_amount : 0,
        payment_status: record ? record.payment_status : 'No Salary Set',
        last_payment_date: record ? record.last_payment_date : null
      };
    });

    res.json({ staff: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff list: ' + err.message });
  }
});

// GET /api/salary/record/:userId - Get salary record for a specific user
router.get('/record/:userId', (req, res) => {
  const requestedUserId = parseInt(req.params.userId, 10);
  const me = req.user;

  // Security: Only Admin/Cashier can view others; others can only view their own
  const canViewAll = me.role === 'Admin' || me.role === 'Cashier';
  const isOwnRecord = me.id === requestedUserId;

  // Students and Parents cannot access salary at all
  if (me.role === 'Student' || me.role === 'Parent') {
    return res.status(403).json({ error: 'Access denied. Students and parents cannot view salary information.' });
  }

  if (!canViewAll && !isOwnRecord) {
    return res.status(403).json({ error: 'Access denied. You can only view your own salary information.' });
  }

  try {
    const user = db.prepare('SELECT id, name, role, post, employee_id, department, profile_photo FROM users WHERE id = ?').get(requestedUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const record = getSalaryRecord(requestedUserId);
    const payments = db.prepare('SELECT * FROM salary_payments WHERE user_id = ? ORDER BY id DESC').all(requestedUserId);

    res.json({ user, salary: record, payments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch salary record: ' + err.message });
  }
});

// GET /api/salary/my - Teacher/Staff view their OWN salary
router.get('/my', (req, res) => {
  const userId = req.user.id;

  if (req.user.role === 'Student' || req.user.role === 'Parent') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  try {
    const record = getSalaryRecord(userId);
    const payments = db.prepare('SELECT * FROM salary_payments WHERE user_id = ? ORDER BY id DESC').all(userId);
    res.json({ salary: record, payments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch salary: ' + err.message });
  }
});

// POST /api/salary/set - Admin: Create or update a staff member's monthly salary
router.post('/set', requireRole(['Admin']), (req, res) => {
  const { userId, monthlySalary } = req.body;

  if (!userId || monthlySalary === undefined || monthlySalary < 0) {
    return res.status(400).json({ error: 'userId and valid monthlySalary are required.' });
  }

  try {
    const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Ensure no student/parent salary record can be created
    if (user.role === 'Student' || user.role === 'Parent') {
      return res.status(400).json({ error: 'Cannot set salary for students or parents.' });
    }

    // Recompute total_paid from actual payments
    const totalPaidRow = db.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM salary_payments WHERE user_id = ?').get(userId);
    const totalPaid = totalPaidRow ? totalPaidRow.total : 0;

    db.prepare(`
      INSERT INTO staff_salaries (user_id, monthly_salary, total_paid)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        monthly_salary = excluded.monthly_salary,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, parseFloat(monthlySalary), totalPaid);

    const record = getSalaryRecord(userId);
    res.json({ message: `Monthly salary for ${user.name} set to ₹${parseFloat(monthlySalary).toLocaleString('en-IN')}.`, salary: record });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set salary: ' + err.message });
  }
});

// POST /api/salary/pay - Cashier/Admin: Record a salary payment
router.post('/pay', requireRole(['Admin', 'Cashier']), (req, res) => {
  const { userId, salaryMonth, totalSalary, amountPaid, paymentDate, paymentMethod, transactionRef, notes } = req.body;
  const cashierId = req.user.id;
  const cashierName = req.user.name;

  if (!userId || !salaryMonth || !amountPaid || !paymentDate) {
    return res.status(400).json({ error: 'userId, salaryMonth, amountPaid, and paymentDate are required.' });
  }

  const payAmount = parseFloat(amountPaid);
  if (isNaN(payAmount) || payAmount <= 0) {
    return res.status(400).json({ error: 'Amount paid must be a positive number.' });
  }

  try {
    const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.role === 'Student' || user.role === 'Parent') {
      return res.status(400).json({ error: 'Cannot record salary payments for students or parents.' });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Ensure salary ledger exists
      const existingLedger = db.prepare('SELECT id FROM staff_salaries WHERE user_id = ?').get(userId);
      if (!existingLedger) {
        db.prepare(`
          INSERT INTO staff_salaries (user_id, monthly_salary, total_paid)
          VALUES (?, ?, 0)
        `).run(userId, parseFloat(totalSalary) || payAmount);
      } else if (totalSalary) {
        db.prepare(`UPDATE staff_salaries SET monthly_salary = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(parseFloat(totalSalary), userId);
      }

      // 2. Insert payment record (never overwrite - append only)
      db.prepare(`
        INSERT INTO salary_payments (user_id, salary_month, total_salary, amount_paid, payment_date, payment_method, transaction_ref, notes, cashier_id, cashier_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        salaryMonth,
        parseFloat(totalSalary) || 0,
        payAmount,
        paymentDate,
        paymentMethod || 'Cash',
        transactionRef || null,
        notes || null,
        cashierId,
        cashierName
      );

      // 3. Recompute and update total_paid in salary ledger
      const totalPaidRow = db.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM salary_payments WHERE user_id = ?').get(userId);
      db.prepare('UPDATE staff_salaries SET total_paid = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(totalPaidRow.total, userId);

      db.exec('COMMIT;');

      const record = getSalaryRecord(userId);
      const payments = db.prepare('SELECT * FROM salary_payments WHERE user_id = ? ORDER BY id DESC').all(userId);

      // Notify the staff member
      try {
        const ledger = db.prepare('SELECT monthly_salary FROM staff_salaries WHERE user_id = ?').get(userId);
        const msg = `Salary Payment Received\n₹${payAmount.toLocaleString('en-IN')} credited for ${salaryMonth}.\nMethod: ${paymentMethod || 'Cash'}\nProcessed by: ${cashierName}`;
        db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)').run(
          userId, `Salary Payment: ₹${payAmount.toLocaleString('en-IN')} Credited`, msg, 'GENERAL'
        );
      } catch (e) {}

      res.json({
        message: `Salary payment of ₹${payAmount.toLocaleString('en-IN')} recorded for ${user.name}.`,
        salary: record,
        payments
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    console.error('Salary payment error:', err);
    res.status(500).json({ error: 'Failed to record salary payment: ' + err.message });
  }
});

// GET /api/salary/payments/:userId - Get all payment history for a user
router.get('/payments/:userId', (req, res) => {
  const requestedUserId = parseInt(req.params.userId, 10);
  const me = req.user;

  if (me.role === 'Student' || me.role === 'Parent') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const canViewAll = me.role === 'Admin' || me.role === 'Cashier';
  const isOwnRecord = me.id === requestedUserId;

  if (!canViewAll && !isOwnRecord) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  try {
    const payments = db.prepare('SELECT * FROM salary_payments WHERE user_id = ? ORDER BY id DESC').all(requestedUserId);
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment history: ' + err.message });
  }
});

// GET /api/salary/summary - Admin: Summary stats for salary management
router.get('/summary', requireRole(['Admin', 'Cashier']), (req, res) => {
  try {
    const totalStaffWithSalary = db.prepare('SELECT COUNT(*) as count FROM staff_salaries').get().count;
    const totalMonthlySalary = db.prepare('SELECT COALESCE(SUM(monthly_salary), 0) as total FROM staff_salaries').get().total;
    const totalPaid = db.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM salary_payments').get().total;
    const totalPending = Math.max(0, totalMonthlySalary - Math.min(totalPaid, totalMonthlySalary));

    res.json({ totalStaffWithSalary, totalMonthlySalary, totalPaid, totalPending });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch salary summary: ' + err.message });
  }
});

module.exports = router;
