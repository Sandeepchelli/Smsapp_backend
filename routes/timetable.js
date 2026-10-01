const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// 1. GET /api/timetable/my-class - Student's class timetable
router.get('/my-class', requireRole(['Student', 'Parent', 'Admin']), (req, res) => {
  let classId = null;

  if (req.user.role === 'Student') {
    const student = db.prepare('SELECT class_id FROM students WHERE user_id = ?').get(req.user.id);
    if (student) classId = student.class_id;
  } else if (req.user.role === 'Parent') {
    const student = db.prepare('SELECT class_id FROM students WHERE parent_id = ?').get(req.user.id);
    if (student) classId = student.class_id;
  }

  if (!classId) {
    const defaultClass = db.prepare('SELECT id FROM classes LIMIT 1').get();
    classId = defaultClass ? defaultClass.id : 1;
  }

  const classInfo = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  const slots = db.prepare(`
    SELECT t.*, s.name as subject_name, s.code as subject_code, u.name as teacher_name
    FROM timetable t
    JOIN subjects s ON t.subject_id = s.id
    JOIN users u ON t.teacher_id = u.id
    WHERE t.class_id = ?
    ORDER BY 
      CASE t.day
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        ELSE 7
      END,
      t.period ASC
  `).all(classId);

  res.json({ classInfo, timetable: slots });
});

// 2. GET /api/timetable/my-teaching - Teacher's weekly teaching schedule
router.get('/my-teaching', requireRole(['Teacher', 'Admin']), (req, res) => {
  const teacherId = req.user.id;

  const slots = db.prepare(`
    SELECT t.*, c.name as class_name, c.section, s.name as subject_name, s.code as subject_code
    FROM timetable t
    JOIN classes c ON t.class_id = c.id
    JOIN subjects s ON t.subject_id = s.id
    WHERE t.teacher_id = ?
    ORDER BY 
      CASE t.day
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        ELSE 7
      END,
      t.period ASC
  `).all(teacherId);

  res.json({ teachingSchedule: slots });
});

// 3. GET /api/timetable/class/:classId - View timetable for any class
router.get('/class/:classId', (req, res) => {
  const classId = req.params.classId;
  const classInfo = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!classInfo) return res.status(404).json({ error: 'Class not found.' });

  const slots = db.prepare(`
    SELECT t.*, s.name as subject_name, s.code as subject_code, u.name as teacher_name
    FROM timetable t
    JOIN subjects s ON t.subject_id = s.id
    JOIN users u ON t.teacher_id = u.id
    WHERE t.class_id = ?
    ORDER BY 
      CASE t.day
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        ELSE 7
      END,
      t.period ASC
  `).all(classId);

  res.json({ classInfo, timetable: slots });
});

// 4. POST /api/timetable - Admin adds/updates timetable slot
router.post('/', requireRole(['Admin']), (req, res) => {
  const { classId, subjectId, teacherId, day, period, startTime, endTime, roomNo = 'Room 101' } = req.body;

  if (!classId || !subjectId || !teacherId || !day || !period || !startTime || !endTime) {
    return res.status(400).json({ error: 'All timetable slot fields are required.' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO timetable (class_id, subject_id, teacher_id, day, period, start_time, end_time, room_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(class_id, day, period) DO UPDATE SET
        subject_id = excluded.subject_id,
        teacher_id = excluded.teacher_id,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        room_no = excluded.room_no
    `);

    stmt.run(
      classId,
      subjectId,
      teacherId,
      day,
      parseInt(period, 10),
      startTime,
      endTime,
      roomNo
    );

    res.status(201).json({ message: `Timetable slot scheduled for ${day} (Period ${period}) successfully.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to schedule timetable: ' + err.message });
  }
});

// 5. DELETE /api/timetable/:id - Admin deletes timetable slot
router.delete('/:id', requireRole(['Admin']), (req, res) => {
  db.prepare('DELETE FROM timetable WHERE id = ?').run(req.params.id);
  res.json({ message: 'Timetable slot removed.' });
});

module.exports = router;
