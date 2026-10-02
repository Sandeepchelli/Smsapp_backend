const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/users/profile
 * Retrieves the complete role-specific profile for the currently logged-in user.
 * Strictly adheres to privacy: only returns the logged-in user's own data.
 */
router.get('/profile', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;

  try {
    const user = db.prepare(`
      SELECT id, name, username, role, post, email, phone, employee_id,
             profile_photo, department, is_active, created_at
      FROM users
      WHERE id = ?
    `).get(userId);

    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    let roleData = {};

    if (role === 'Student') {
      const student = db.prepare(`
        SELECT s.id as student_id, s.roll_no, s.department as student_dept,
               s.year, s.semester, c.id as class_id, c.name as class_name, c.section,
               p.id as parent_user_id, p.name as parent_name, p.phone as parent_phone,
               p.email as parent_email, p.post as parent_relation
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN users p ON s.parent_id = p.id
        WHERE s.user_id = ?
      `).get(userId);

      if (student) {
        // Attendance summary
        const attStats = db.prepare(`
          SELECT 
            COUNT(*) as total_periods,
            SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present_periods,
            SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) as absent_periods
          FROM attendance
          WHERE student_id = ?
        `).get(student.student_id);

        const total = attStats?.total_periods || 0;
        const present = attStats?.present_periods || 0;
        const percentage = total > 0 ? Math.round((present / total) * 100) : 100;

        // Cumulative GPA from semester results
        const gpaData = db.prepare(`
          SELECT AVG(grade_points) as cgpa, COUNT(*) as courses_count
          FROM semester_results
          WHERE student_id = ?
        `).get(student.student_id);

        // Fee summary
        const feeData = db.prepare(`
          SELECT total_fee, paid_amount, pending_amount
          FROM student_fees
          WHERE student_id = ?
        `).get(student.student_id);

        roleData = {
          studentId: student.student_id,
          rollNo: student.roll_no,
          className: student.class_name,
          section: student.section,
          year: student.year,
          semester: student.semester,
          department: student.student_dept || user.department,
          parent: {
            name: student.parent_name || 'Not Linked',
            phone: student.parent_phone || 'N/A',
            email: student.parent_email || 'N/A',
            relation: student.parent_relation || 'Parent / Guardian'
          },
          attendanceRate: percentage,
          cgpa: gpaData?.cgpa ? Number(gpaData.cgpa).toFixed(2) : 'N/A',
          fees: feeData || { total_fee: 0, paid_amount: 0, pending_amount: 0 }
        };
      }
    } else if (role === 'Parent') {
      const parent = db.prepare(`
        SELECT s.id as student_id, s.roll_no, u.name as student_name,
               u.profile_photo as student_photo, c.name as class_name,
               s.department as student_dept, s.year, s.semester
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE s.parent_id = ?
      `).get(userId);

      roleData = {
        relationship: user.post || 'Parent / Guardian',
        ward: parent ? {
          studentId: parent.student_id,
          name: parent.student_name,
          rollNo: parent.roll_no,
          className: parent.class_name,
          department: parent.student_dept,
          year: parent.year,
          semester: parent.semester,
          photo: parent.student_photo
        } : null
      };
    } else if (role === 'Teacher') {
      const assignments = db.prepare(`
        SELECT ta.id as assignment_id, c.id as class_id, c.name as class_name,
               s.id as subject_id, s.name as subject_name, s.code as subject_code
        FROM teacher_assignments ta
        JOIN classes c ON ta.class_id = c.id
        JOIN subjects s ON ta.subject_id = s.id
        WHERE ta.teacher_id = ?
        ORDER BY c.name, s.name
      `).all(userId);

      // Attendance statistics for the teacher
      const myAtt = db.prepare(`
        SELECT 
          COUNT(*) as total_days,
          SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present_days,
          SUM(CASE WHEN status = 'Leave' THEN 1 ELSE 0 END) as leave_days
        FROM teacher_attendance
        WHERE teacher_id = ?
      `).get(userId);

      roleData = {
        employeeId: user.employee_id || 'N/A',
        department: user.department || 'N/A',
        assignments,
        assignedClassesCount: new Set(assignments.map(a => a.class_id)).size,
        assignedSubjectsCount: assignments.length,
        attendanceStats: myAtt || { total_days: 0, present_days: 0, leave_days: 0 }
      };
    } else if (role === 'Admin') {
      // General institute metadata for the admin
      const stats = {
        totalStudents: db.prepare("SELECT COUNT(*) as count FROM students").get()?.count || 0,
        totalTeachers: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'Teacher'").get()?.count || 0,
        totalClasses: db.prepare("SELECT COUNT(*) as count FROM classes").get()?.count || 0
      };

      roleData = {
        adminId: user.employee_id || 'PRIN-001',
        privileges: 'Full Administrative Authority (Admissions, Faculty, Academics, Finance, Canteen, Library)',
        systemStats: stats
      };
    }

    res.json({
      user,
      roleData
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile: ' + err.message });
  }
});

/**
 * PUT /api/users/profile
 * Allows users to update their editable personal info (phone, email, profile_photo).
 * Strictly forbids updating academic/administrative fields (role, roll_no, class_id, etc.).
 */
router.put('/profile', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { email, phone, profilePhoto } = req.body;

  try {
    db.prepare(`
      UPDATE users
      SET email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          profile_photo = COALESCE(?, profile_photo),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(email ? email.trim() : null, phone ? phone.trim() : null, profilePhoto || null, userId);

    const updated = db.prepare(`
      SELECT id, name, username, role, post, email, phone, employee_id, profile_photo, department
      FROM users
      WHERE id = ?
    `).get(userId);

    res.json({
      message: 'Profile information updated successfully.',
      user: updated
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile: ' + err.message });
  }
});

/**
 * POST /api/users/change-password
 * Verifies current password and updates to new password with bcrypt hash.
 */
router.post('/change-password', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  try {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isMatch = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect current password. Please try again.' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newHash, userId);

    res.json({ message: 'Password changed successfully! Please use your new password next time you sign in.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password: ' + err.message });
  }
});

/**
 * GET /api/users/settings
 * Retrieves user preferences.
 */
router.get('/settings', authenticateToken, (req, res) => {
  const userId = req.user.id;

  try {
    let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
    if (!settings) {
      db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
      settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
    }

    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings: ' + err.message });
  }
});

/**
 * PUT /api/users/settings
 * Updates user preferences (theme, language, alerts).
 */
router.put('/settings', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const {
    emailAlerts,
    smsAlerts,
    attendanceAlerts,
    feeReminders,
    resultNotifications,
    canteenUpdates,
    theme,
    language,
    twoFactorEnabled
  } = req.body;

  try {
    // Ensure row exists
    const exists = db.prepare('SELECT id FROM user_settings WHERE user_id = ?').get(userId);
    if (!exists) {
      db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
    }

    db.prepare(`
      UPDATE user_settings
      SET email_alerts = COALESCE(?, email_alerts),
          sms_alerts = COALESCE(?, sms_alerts),
          attendance_alerts = COALESCE(?, attendance_alerts),
          fee_reminders = COALESCE(?, fee_reminders),
          result_notifications = COALESCE(?, result_notifications),
          canteen_updates = COALESCE(?, canteen_updates),
          theme = COALESCE(?, theme),
          language = COALESCE(?, language),
          two_factor_enabled = COALESCE(?, two_factor_enabled),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      emailAlerts !== undefined ? (emailAlerts ? 1 : 0) : null,
      smsAlerts !== undefined ? (smsAlerts ? 1 : 0) : null,
      attendanceAlerts !== undefined ? (attendanceAlerts ? 1 : 0) : null,
      feeReminders !== undefined ? (feeReminders ? 1 : 0) : null,
      resultNotifications !== undefined ? (resultNotifications ? 1 : 0) : null,
      canteenUpdates !== undefined ? (canteenUpdates ? 1 : 0) : null,
      theme || null,
      language || null,
      twoFactorEnabled !== undefined ? (twoFactorEnabled ? 1 : 0) : null,
      userId
    );

    const updated = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
    res.json({ message: 'Settings saved successfully.', settings: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings: ' + err.message });
  }
});

module.exports = router;
