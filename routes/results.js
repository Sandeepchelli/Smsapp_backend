const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// Helper function to calculate GPA
function calculateGPA(results) {
  let totalCredits = 0;
  let weightedPoints = 0;

  for (const r of results) {
    totalCredits += r.credits;
    weightedPoints += (r.grade_points * r.credits);
  }

  return totalCredits > 0 ? (weightedPoints / totalCredits).toFixed(2) : '0.00';
}

// 1. GET /api/results/my-results - Student's own semester results (Read-Only)
router.get('/my-results', requireRole(['Student', 'Admin']), (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) {
    return res.status(404).json({ error: 'Student profile not found.' });
  }

  const results = db.prepare(`
    SELECT sr.*, s.code as subject_code, s.name as subject_name
    FROM semester_results sr
    JOIN subjects s ON sr.subject_id = s.id
    WHERE sr.student_id = ?
    ORDER BY sr.semester DESC, s.name ASC
  `).all(student.id);

  // Group by semester
  const semesters = {};
  for (const r of results) {
    if (!semesters[r.semester]) {
      semesters[r.semester] = [];
    }
    semesters[r.semester].push(r);
  }

  const semesterSummary = Object.keys(semesters).map(sem => ({
    semester: parseInt(sem, 10),
    gpa: calculateGPA(semesters[sem]),
    courses: semesters[sem]
  }));

  const overallCGPA = calculateGPA(results);

  res.json({
    studentId: student.id,
    overallCGPA,
    semesters: semesterSummary
  });
});

// 2. GET /api/results/ward-results - Parent's linked ward semester results (Read-Only)
router.get('/ward-results', requireRole(['Parent', 'Admin']), (req, res) => {
  const parentId = req.user.id;
  let student = db.prepare(`
    SELECT s.id, u.name as student_name, s.roll_no, c.name as class_name
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    WHERE s.parent_id = ?
  `).get(parentId);

  if (!student && req.user.role === 'Admin') {
    student = db.prepare(`
      SELECT s.id, u.name as student_name, s.roll_no, c.name as class_name
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN classes c ON s.class_id = c.id
      LIMIT 1
    `).get();
  }

  if (!student) {
    return res.status(404).json({ error: 'No linked student found for this parent.' });
  }

  const results = db.prepare(`
    SELECT sr.*, s.code as subject_code, s.name as subject_name
    FROM semester_results sr
    JOIN subjects s ON sr.subject_id = s.id
    WHERE sr.student_id = ?
    ORDER BY sr.semester DESC, s.name ASC
  `).all(student.id);

  const semesters = {};
  for (const r of results) {
    if (!semesters[r.semester]) {
      semesters[r.semester] = [];
    }
    semesters[r.semester].push(r);
  }

  const semesterSummary = Object.keys(semesters).map(sem => ({
    semester: parseInt(sem, 10),
    gpa: calculateGPA(semesters[sem]),
    courses: semesters[sem]
  }));

  const overallCGPA = calculateGPA(results);

  res.json({
    ward: student,
    overallCGPA,
    semesters: semesterSummary
  });
});

// 3. GET /api/results/class-results - Teacher view of assigned classes & subjects
router.get('/class-results', requireRole(['Teacher', 'Admin']), (req, res) => {
  const teacherId = req.user.id;
  const isSuperAdmin = req.user.role === 'Admin';
  const { classId, semester } = req.query;

  let query = `
    SELECT sr.*, u.name as student_name, s.roll_no, c.name as class_name, sub.code as subject_code, sub.name as subject_name
    FROM semester_results sr
    JOIN students s ON sr.student_id = s.id
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    JOIN subjects sub ON sr.subject_id = sub.id
    WHERE 1=1
  `;
  const params = [];

  if (!isSuperAdmin) {
    query += ` AND s.class_id IN (SELECT class_id FROM teacher_assignments WHERE teacher_id = ?)`;
    params.push(teacherId);
  }

  if (classId) {
    query += ` AND s.class_id = ?`;
    params.push(classId);
  }

  if (semester) {
    query += ` AND sr.semester = ?`;
    params.push(semester);
  }

  query += ` ORDER BY sr.semester DESC, CAST(s.roll_no AS INTEGER), sub.name`;

  const results = db.prepare(query).all(...params);
  res.json({ results });
});

// 4. GET /api/results/all - Admin overview
router.get('/all', requireRole(['Admin']), (req, res) => {
  const { classId, semester, search } = req.query;

  let query = `
    SELECT sr.*, u.name as student_name, s.roll_no, c.name as class_name, sub.code as subject_code, sub.name as subject_name
    FROM semester_results sr
    JOIN students s ON sr.student_id = s.id
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    JOIN subjects sub ON sr.subject_id = sub.id
    WHERE 1=1
  `;
  const params = [];

  if (classId) {
    query += ` AND s.class_id = ?`;
    params.push(classId);
  }
  if (semester) {
    query += ` AND sr.semester = ?`;
    params.push(semester);
  }
  if (search) {
    query += ` AND (u.name LIKE ? OR s.roll_no LIKE ? OR sub.name LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ` ORDER BY sr.semester DESC, c.name, CAST(s.roll_no AS INTEGER)`;

  const results = db.prepare(query).all(...params);
  res.json({ results });
});

// 5. POST /api/results - Admin adds/publishes result
router.post('/', requireRole(['Admin']), (req, res) => {
  const { studentId, semester, subjectId, internalMarks, externalMarks, credits = 3, academicYear = '2025-2026' } = req.body;

  if (!studentId || !semester || !subjectId || internalMarks === undefined || externalMarks === undefined) {
    return res.status(400).json({ error: 'All result fields are required.' });
  }

  const subject = db.prepare('SELECT name, code FROM subjects WHERE id = ?').get(subjectId);
  if (!subject) return res.status(404).json({ error: 'Subject not found.' });

  const total = parseFloat(internalMarks) + parseFloat(externalMarks);
  let grade = 'RA';
  let gradePoints = 0;
  let status = 'FAIL';

  if (total >= 90) { grade = 'O'; gradePoints = 10; status = 'PASS'; }
  else if (total >= 80) { grade = 'A+'; gradePoints = 9; status = 'PASS'; }
  else if (total >= 70) { grade = 'A'; gradePoints = 8; status = 'PASS'; }
  else if (total >= 60) { grade = 'B+'; gradePoints = 7; status = 'PASS'; }
  else if (total >= 50) { grade = 'B'; gradePoints = 6; status = 'PASS'; }

  try {
    const stmt = db.prepare(`
      INSERT INTO semester_results (
        student_id, semester, subject_id, subject_name, subject_code,
        internal_marks, external_marks, total_marks, grade, grade_points, credits, status, academic_year
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, semester, subject_id) DO UPDATE SET
        internal_marks = excluded.internal_marks,
        external_marks = excluded.external_marks,
        total_marks = excluded.total_marks,
        grade = excluded.grade,
        grade_points = excluded.grade_points,
        status = excluded.status
    `);

    stmt.run(
      studentId,
      parseInt(semester, 10),
      subjectId,
      subject.name,
      subject.code,
      parseFloat(internalMarks),
      parseFloat(externalMarks),
      total,
      grade,
      gradePoints,
      parseInt(credits, 10),
      status,
      academicYear
    );

    // Notify student and parent of published results
    const studentUser = db.prepare('SELECT user_id, parent_id FROM students WHERE id = ?').get(studentId);
    if (studentUser) {
      const insertNotif = db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)');
      const notifMsg = `Semester ${semester} Result Published for ${subject.name} (${subject.code}): Total Score: ${total}/100, Grade: ${grade} (${status}).`;
      insertNotif.run(studentUser.user_id, `Semester ${semester} Result Published`, notifMsg, 'GENERAL');
      if (studentUser.parent_id) {
        insertNotif.run(studentUser.parent_id, `Semester ${semester} Result: Ward`, notifMsg, 'GENERAL');
      }
    }

    res.status(201).json({ message: 'Result recorded and published successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record result: ' + err.message });
  }
});

// 6. DELETE /api/results/:id - Admin deletes result
router.delete('/:id', requireRole(['Admin']), (req, res) => {
  db.prepare('DELETE FROM semester_results WHERE id = ?').run(req.params.id);
  res.json({ message: 'Result record deleted successfully.' });
});

module.exports = router;
