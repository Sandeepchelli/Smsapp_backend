const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, requireRole(['Teacher', 'Admin']));

// 1. GET /api/teacher/assignments - Classes and subjects assigned to this teacher
router.get('/assignments', (req, res) => {
  const teacherId = req.user.id;
  const isSuperAdmin = req.user.role === 'Admin';

  let assignments;
  if (isSuperAdmin) {
    // Admin can view all assignments or select any
    assignments = db.prepare(`
      SELECT ta.id as assignment_id, c.id as class_id, c.name as class_name, c.department, c.section, c.year, c.semester,
             s.id as subject_id, s.code as subject_code, s.name as subject_name,
             u.id as teacher_id, u.name as teacher_name
      FROM teacher_assignments ta
      JOIN classes c ON ta.class_id = c.id
      JOIN subjects s ON ta.subject_id = s.id
      JOIN users u ON ta.teacher_id = u.id
      ORDER BY c.name, s.name
    `).all();
  } else {
    assignments = db.prepare(`
      SELECT ta.id as assignment_id, c.id as class_id, c.name as class_name, c.department, c.section, c.year, c.semester,
             s.id as subject_id, s.code as subject_code, s.name as subject_name,
             u.id as teacher_id, u.name as teacher_name
      FROM teacher_assignments ta
      JOIN classes c ON ta.class_id = c.id
      JOIN subjects s ON ta.subject_id = s.id
      JOIN users u ON ta.teacher_id = u.id
      WHERE ta.teacher_id = ?
      ORDER BY c.name, s.name
    `).all(teacherId);
  }

  res.json({ assignments });
});

// 2. GET /api/teacher/class-students - ALL students belonging to the chosen class
router.get('/class-students', (req, res) => {
  const { classId, subjectId, date, period } = req.query;

  if (!classId) {
    return res.status(400).json({ error: 'classId is required.' });
  }

  // Fetch all students belonging to this class
  const students = db.prepare(`
    SELECT s.id as student_id, s.roll_no, s.department, s.year, s.semester,
           u.id as user_id, u.name as student_name, u.email as student_email, u.phone as student_phone,
           p.id as parent_id, p.name as parent_name, p.phone as parent_phone
    FROM students s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN users p ON s.parent_id = p.id
    WHERE s.class_id = ?
    ORDER BY CAST(s.roll_no AS INTEGER), u.name
  `).all(classId);

  // If date & period & subject are specified, check existing attendance and approved leaves
  const enrichedStudents = students.map((stud) => {
    let currentStatus = null;
    let remarks = '';
    let hasApprovedLeave = false;
    let leaveReason = '';

    if (subjectId && date && period) {
      // Check existing attendance record
      const attRecord = db.prepare(`
        SELECT status, remarks FROM attendance 
        WHERE student_id = ? AND subject_id = ? AND date = ? AND period = ?
      `).get(stud.student_id, subjectId, date, parseInt(period, 10));

      if (attRecord) {
        currentStatus = attRecord.status;
        remarks = attRecord.remarks || '';
      }

      // Check approved leave for this date & period
      const approvedLeave = db.prepare(`
        SELECT * FROM permission_requests
        WHERE student_id = ? AND type = 'LEAVE' AND date = ? 
          AND final_status = 'APPROVED'
          AND (start_period IS NULL OR (start_period <= ? AND end_period >= ?))
      `).get(stud.student_id, date, parseInt(period, 10), parseInt(period, 10));

      if (approvedLeave) {
        hasApprovedLeave = true;
        leaveReason = approvedLeave.reason;
        if (!currentStatus) {
          currentStatus = 'On Leave';
        }
      }
    }

    return {
      ...stud,
      currentStatus: currentStatus || 'Present', // default to Present if unmarked
      remarks,
      hasApprovedLeave,
      leaveReason
    };
  });

  res.json({ students: enrichedStudents });
});

// 3. POST /api/teacher/attendance - Save attendance & automatically notify linked parents for absences
router.post('/attendance', (req, res) => {
  const { classId, subjectId, date, period, attendanceList } = req.body;
  const teacherId = req.user.id;
  const teacherName = req.user.name;

  if (!classId || !subjectId || !date || !period || !Array.isArray(attendanceList)) {
    return res.status(400).json({ error: 'classId, subjectId, date, period, and attendanceList are required.' });
  }

  const periodInt = parseInt(period, 10);

  // Fetch class and subject names for notifications and record
  const classInfo = db.prepare('SELECT name, section FROM classes WHERE id = ?').get(classId);
  const subjectInfo = db.prepare('SELECT name, code FROM subjects WHERE id = ?').get(subjectId);

  if (!classInfo || !subjectInfo) {
    return res.status(404).json({ error: 'Class or Subject not found.' });
  }

  const notificationsGenerated = [];

  const upsertAttendance = db.prepare(`
    INSERT INTO attendance (
      student_id, student_name, class_id, class_name, section,
      subject_id, subject_name, teacher_id, teacher_name, date, period, status, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, subject_id, date, period) DO UPDATE SET
      status = excluded.status,
      remarks = excluded.remarks,
      teacher_id = excluded.teacher_id,
      teacher_name = excluded.teacher_name,
      created_at = CURRENT_TIMESTAMP
  `);

  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, title, message, type, metadata)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Process each student's attendance in a transaction
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const record of attendanceList) {
      const { studentId, status, remarks } = record;

      // 1. Fetch student info and linked parent
      const student = db.prepare(`
        SELECT s.id, s.parent_id, u.name as student_name, p.name as parent_name, p.phone as parent_phone
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN users p ON s.parent_id = p.id
        WHERE s.id = ?
      `).get(studentId);

      if (!student) continue;

      let finalStatus = status;

      // 2. Requirement 4: Check if student has an APPROVED leave for this date/period
      const approvedLeave = db.prepare(`
        SELECT * FROM permission_requests
        WHERE student_id = ? AND type = 'LEAVE' AND date = ? 
          AND final_status = 'APPROVED'
          AND (start_period IS NULL OR (start_period <= ? AND end_period >= ?))
      `).get(studentId, date, periodInt, periodInt);

      if (approvedLeave) {
        finalStatus = 'On Leave';
      }

      // 3. Save attendance record
      upsertAttendance.run(
        studentId,
        student.student_name,
        classId,
        classInfo.name,
        classInfo.section,
        subjectId,
        subjectInfo.name,
        teacherId,
        teacherName,
        date,
        periodInt,
        finalStatus,
        remarks || (approvedLeave ? `Approved Leave: ${approvedLeave.reason}` : '')
      );

      // 4. Requirement 3: If Absent (and NOT on approved leave), automatically notify linked parent!
      if (finalStatus === 'Absent' && !approvedLeave && student.parent_id) {
        const notifTitle = `Attendance Alert: ${student.student_name} Marked Absent`;
        const notifMsg = `Attendance Alert\nYour child ${student.student_name} was marked absent for ${subjectInfo.name} (${subjectInfo.code}), Period ${periodInt}, on ${date}.\nClass: ${classInfo.name}\nCollege: EduSphere`;
        
        insertNotif.run(
          student.parent_id,
          notifTitle,
          notifMsg,
          'ABSENCE_ALERT',
          JSON.stringify({
            studentId,
            studentName: student.student_name,
            subject: subjectInfo.name,
            period: periodInt,
            date,
            parentPhone: student.parent_phone || 'None'
          })
        );

        notificationsGenerated.push({
          parentName: student.parent_name,
          studentName: student.student_name,
          phone: student.parent_phone
        });
      }
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('Error saving attendance:', err);
    return res.status(500).json({ error: 'Failed to record attendance: ' + err.message });
  }

  res.json({
    message: `Attendance saved successfully for Period ${periodInt}!`,
    notificationsSent: notificationsGenerated.length,
    alertsDispatched: notificationsGenerated
  });
});

// 4. GET /api/teacher/permissions - Leave and outing requests from students in teacher's assigned classes
router.get('/permissions', (req, res) => {
  const teacherId = req.user.id;
  const isSuperAdmin = req.user.role === 'Admin';

  let requests;
  if (isSuperAdmin) {
    requests = db.prepare(`
      SELECT pr.*, s.roll_no, u.name as student_name, c.name as class_name,
             p.name as parent_name, p.phone as parent_phone
      FROM permission_requests pr
      JOIN students s ON pr.student_id = s.id
      JOIN users u ON s.user_id = u.id
      JOIN classes c ON s.class_id = c.id
      LEFT JOIN users p ON s.parent_id = p.id
      ORDER BY pr.id DESC
    `).all();
  } else {
    // Get requests for classes assigned to this teacher
    requests = db.prepare(`
      SELECT DISTINCT pr.*, s.roll_no, u.name as student_name, c.name as class_name,
             p.name as parent_name, p.phone as parent_phone
      FROM permission_requests pr
      JOIN students s ON pr.student_id = s.id
      JOIN users u ON s.user_id = u.id
      JOIN classes c ON s.class_id = c.id
      LEFT JOIN users p ON s.parent_id = p.id
      WHERE s.class_id IN (
        SELECT DISTINCT class_id FROM teacher_assignments WHERE teacher_id = ?
      )
      ORDER BY pr.id DESC
    `).all(teacherId);
  }

  res.json({ requests });
});

// 5. PUT /api/teacher/permissions/:id - Teacher approval / rejection
router.put('/permissions/:id', (req, res) => {
  const { action, comments } = req.body; // action: 'ACCEPT' or 'REJECT'
  const requestId = req.params.id;
  const teacherName = req.user.name;

  const reqRecord = db.prepare(`
    SELECT pr.*, s.user_id as student_user_id, s.parent_id, u.name as student_name
    FROM permission_requests pr
    JOIN students s ON pr.student_id = s.id
    JOIN users u ON s.user_id = u.id
    WHERE pr.id = ?
  `).get(requestId);

  if (!reqRecord) {
    return res.status(404).json({ error: 'Permission request not found.' });
  }

  let teacherApproval = 'PENDING';
  let finalStatus = reqRecord.final_status;

  if (action === 'ACCEPT') {
    teacherApproval = 'APPROVED';
    // If principal has already approved (or if single tier), advance to APPROVED; else TEACHER_APPROVED
    if (reqRecord.principal_approval === 'APPROVED') {
      finalStatus = 'APPROVED';
    } else {
      finalStatus = 'TEACHER_APPROVED';
    }
  } else if (action === 'REJECT') {
    teacherApproval = 'REJECTED';
    finalStatus = 'REJECTED';
  } else {
    return res.status(400).json({ error: "Action must be 'ACCEPT' or 'REJECT'." });
  }

  db.prepare(`
    UPDATE permission_requests
    SET teacher_approval = ?, final_status = ?, notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(teacherApproval, finalStatus, comments || null, requestId);

  // Notify student and parent of status update
  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (?, ?, ?, ?)
  `);

  const statusText = action === 'ACCEPT' ? 'Teacher Approved (Pending Principal Final Approval)' : 'Permission Rejected by Teacher';
  const notifMsg = `Your ${reqRecord.type} request for date ${reqRecord.date} has been updated: ${statusText}.\nTeacher: ${teacherName}`;

  insertNotif.run(reqRecord.student_user_id, `${reqRecord.type} Request Status Update`, notifMsg, `${reqRecord.type}_STATUS`);
  if (reqRecord.parent_id) {
    insertNotif.run(reqRecord.parent_id, `${reqRecord.type} Request Update: ${reqRecord.student_name}`, notifMsg, `${reqRecord.type}_STATUS`);
  }

  res.json({
    message: `Request ${action === 'ACCEPT' ? 'accepted' : 'rejected'} successfully.`,
    finalStatus,
    teacherApproval
  });
});

// 6. GET /api/teacher/my-attendance-summary - Teacher sees own attendance summary
router.get('/my-attendance-summary', (req, res) => {
  const teacherId = req.user.id;

  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ?').get(teacherId).count;
    const present = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Present'").get(teacherId).count;
    const absent = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Absent'").get(teacherId).count;
    const leave = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Leave'").get(teacherId).count;
    const halfDay = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Half-Day'").get(teacherId).count;
    const percentage = total > 0 ? ((present + (halfDay * 0.5)) / total * 100).toFixed(1) : '0.0';

    const recentRecords = db.prepare('SELECT * FROM teacher_attendance WHERE teacher_id = ? ORDER BY date DESC LIMIT 30').all(teacherId);

    res.json({
      summary: { total, present, absent, leave, halfDay, percentage },
      records: recentRecords
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attendance: ' + err.message });
  }
});

// 7. GET /api/teacher/student-attendance-summary - Teacher: attendance summary for students in their class
router.get('/student-attendance-summary', (req, res) => {
  const teacherId = req.user.id;
  const { classId, subjectId } = req.query;

  if (!classId) {
    return res.status(400).json({ error: 'classId is required.' });
  }

  // Security: teacher must be assigned to this class (unless Admin)
  if (req.user.role !== 'Admin') {
    const isAssigned = db.prepare('SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_id = ?').get(teacherId, classId);
    if (!isAssigned) {
      return res.status(403).json({ error: 'You are not assigned to this class.' });
    }
  }

  try {
    // Get all students in the class
    const students = db.prepare(`
      SELECT s.id as student_id, s.roll_no, u.name as student_name
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.class_id = ?
      ORDER BY CAST(s.roll_no AS INTEGER), u.name
    `).all(classId);

    // For each student compute attendance stats
    const result = students.map(stud => {
      let query = 'SELECT status FROM attendance WHERE student_id = ? AND class_id = ?';
      const params = [stud.student_id, classId];

      if (subjectId) {
        query += ' AND subject_id = ?';
        params.push(subjectId);
      }

      const records = db.prepare(query).all(...params);
      const total = records.length;
      const present = records.filter(r => r.status === 'Present').length;
      const absent = records.filter(r => r.status === 'Absent').length;
      const onLeave = records.filter(r => r.status === 'On Leave').length;
      const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';

      return {
        ...stud,
        total,
        present,
        absent,
        on_leave: onLeave,
        percentage
      };
    });

    res.json({ students: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch student attendance summary: ' + err.message });
  }
});

module.exports = router;

