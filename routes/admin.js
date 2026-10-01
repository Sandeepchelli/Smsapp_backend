const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, requireRole(['Admin']));

// 1. GET /api/admin/stats - High-level overview
router.get('/stats', (req, res) => {
  const usersCount = db.prepare('SELECT count(*) as count FROM users').get().count;
  const teachersCount = db.prepare("SELECT count(*) as count FROM users WHERE role = 'Teacher'").get().count;
  const studentsCount = db.prepare("SELECT count(*) as count FROM students").get().count;
  const parentsCount = db.prepare("SELECT count(*) as count FROM users WHERE role = 'Parent'").get().count;
  const classesCount = db.prepare("SELECT count(*) as count FROM classes").get().count;
  const booksCount = db.prepare("SELECT count(*) as count FROM books").get().count;
  const pendingPermissions = db.prepare("SELECT count(*) as count FROM permission_requests WHERE final_status = 'PENDING' OR final_status = 'TEACHER_APPROVED'").get().count;
  const totalCollected = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM fee_payments").get().total;
  const totalPending = db.prepare("SELECT COALESCE(SUM(pending_amount), 0) as total FROM student_fees").get().total;

  res.json({
    totalUsers: usersCount,
    teachers: teachersCount,
    students: studentsCount,
    parents: parentsCount,
    classes: classesCount,
    books: booksCount,
    pendingPermissions,
    totalCollected,
    totalPending
  });
});

// 2. GET /api/admin/teachers - Detailed teacher management list
router.get('/teachers', (req, res) => {
  const teachers = db.prepare(`
    SELECT u.id, u.name, u.username, u.role, u.post, u.email, u.phone, u.employee_id, u.department, u.profile_photo, u.is_active, u.created_at
    FROM users u
    WHERE u.role = 'Teacher'
    ORDER BY u.name ASC
  `).all();

  // Attach assigned classes and subjects to each teacher
  const teachersWithAssignments = teachers.map(t => {
    const assignments = db.prepare(`
      SELECT ta.id as assignment_id, c.id as class_id, c.name as class_name, c.section,
             s.id as subject_id, s.name as subject_name, s.code as subject_code
      FROM teacher_assignments ta
      JOIN classes c ON ta.class_id = c.id
      JOIN subjects s ON ta.subject_id = s.id
      WHERE ta.teacher_id = ?
    `).all(t.id);

    return {
      ...t,
      assignments
    };
  });

  res.json({ teachers: teachersWithAssignments });
});

// 3. POST /api/admin/teachers - Add a new teacher with profile photo & immediate class/subject assignment
router.post('/teachers', (req, res) => {
  const { name, username, password, employeeId, department, post, email, phone, profilePhoto, classId, subjectId } = req.body;

  if (!name || !username || !password || !employeeId) {
    return res.status(400).json({ error: 'Name, username, password, and employee ID are required.' });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    if (existing) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo)
      VALUES (?, ?, ?, 'Teacher', ?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      username.trim(),
      hash,
      post || 'Assistant Professor',
      email || null,
      phone || null,
      employeeId.trim(),
      department || 'Computer Science & Engineering',
      profilePhoto || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'
    );

    const teacherId = result.lastInsertRowid;

    // If initial class and subject were provided, assign immediately
    if (classId && subjectId) {
      db.prepare(`
        INSERT INTO teacher_assignments (teacher_id, class_id, subject_id)
        VALUES (?, ?, ?)
        ON CONFLICT(teacher_id, class_id, subject_id) DO NOTHING
      `).run(teacherId, classId, subjectId);
    }

    res.status(201).json({ message: `Teacher '${name}' added and assigned successfully.`, teacherId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add teacher: ' + err.message });
  }
});

// 4. PUT /api/admin/teachers/:id - Edit teacher information, credentials & assignments
router.put('/teachers/:id', (req, res) => {
  const teacherId = req.params.id;
  const { name, username, password, post, email, phone, department, employeeId, profilePhoto, assignments } = req.body;

  try {
    const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'Teacher'").get(teacherId);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found in database.' });
    }

    // 1. Validate & update username if provided and changed
    let updatedUsername = teacher.username;
    if (username && username.trim() && username.trim().toLowerCase() !== teacher.username.toLowerCase()) {
      const cleanUsername = username.trim();
      const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanUsername, teacherId);
      if (existing) {
        return res.status(409).json({ error: `Username '${cleanUsername}' is already taken by another account.` });
      }
      updatedUsername = cleanUsername;
    }

    // 2. Hash & update password if a new password was supplied
    let updatedPasswordHash = teacher.password_hash;
    if (password && String(password).trim().length > 0) {
      updatedPasswordHash = bcrypt.hashSync(String(password).trim(), 10);
    }

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          username = ?,
          password_hash = ?,
          post = COALESCE(?, post),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          department = COALESCE(?, department),
          employee_id = COALESCE(?, employee_id),
          profile_photo = COALESCE(?, profile_photo),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND role = 'Teacher'
    `).run(
      name ? name.trim() : null,
      updatedUsername,
      updatedPasswordHash,
      post ? post.trim() : null,
      email !== undefined ? email : null,
      phone !== undefined ? phone : null,
      department ? department.trim() : null,
      employeeId ? employeeId.trim() : null,
      profilePhoto || null,
      teacherId
    );

    // If new assignments array is passed, update them
    if (Array.isArray(assignments)) {
      db.prepare('DELETE FROM teacher_assignments WHERE teacher_id = ?').run(teacherId);
      const insertAssign = db.prepare(`
        INSERT INTO teacher_assignments (teacher_id, class_id, subject_id)
        VALUES (?, ?, ?)
        ON CONFLICT(teacher_id, class_id, subject_id) DO NOTHING
      `);
      for (const a of assignments) {
        if (a.classId && a.subjectId) {
          insertAssign.run(teacherId, a.classId, a.subjectId);
        }
      }
    }

    const updatedTeacher = db.prepare(`
      SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo
      FROM users WHERE id = ?
    `).get(teacherId);

    res.json({ message: 'Teacher profile & credentials updated successfully.', teacher: updatedTeacher });
  } catch (err) {
    console.error('Error updating teacher:', err);
    res.status(500).json({ error: 'Failed to update teacher: ' + err.message });
  }
});

// 5. DELETE /api/admin/teachers/:id - Safely remove teacher & clean dependencies
router.delete('/teachers/:id', (req, res) => {
  const teacherId = req.params.id;
  try {
    const teacher = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'Teacher'").get(teacherId);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found in database.' });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Delete assignments
      db.prepare('DELETE FROM teacher_assignments WHERE teacher_id = ?').run(teacherId);
      // 2. Remove timetable slots for this teacher
      db.prepare('DELETE FROM timetable WHERE teacher_id = ?').run(teacherId);
      // 3. Remove teacher attendance records
      db.prepare('DELETE FROM teacher_attendance WHERE teacher_id = ?').run(teacherId);
      // 4. Clean notifications
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(teacherId);
      // 5. Delete teacher user
      db.prepare("DELETE FROM users WHERE id = ? AND role = 'Teacher'").run(teacherId);

      db.exec('COMMIT;');
      res.json({ message: `Teacher Prof. ${teacher.name} removed safely from directory.` });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    console.error('Error deleting teacher:', err);
    res.status(500).json({ error: 'Failed to delete teacher: ' + err.message });
  }
});

// PUT /api/admin/teachers/:id/status - Enable or disable teacher account access
router.put('/teachers/:id/status', (req, res) => {
  const teacherId = req.params.id;
  const { isActive } = req.body;

  try {
    const teacher = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'Teacher'").get(teacherId);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });

    db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      isActive ? 1 : 0,
      teacherId
    );

    res.json({
      message: `Teacher ${teacher.name}'s account has been ${isActive ? 'enabled' : 'disabled'}.`,
      isActive: Boolean(isActive)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update teacher status: ' + err.message });
  }
});

// GET /api/admin/teachers/:id/attendance-summary - Admin: View teacher's attendance summary
router.get('/teachers/:id/attendance-summary', (req, res) => {
  const teacherId = req.params.id;
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ?').get(teacherId).count;
    const present = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Present'").get(teacherId).count;
    const absent = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Absent'").get(teacherId).count;
    const leave = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Leave'").get(teacherId).count;
    const halfDay = db.prepare("SELECT COUNT(*) as count FROM teacher_attendance WHERE teacher_id = ? AND status = 'Half-Day'").get(teacherId).count;
    const percentage = total > 0 ? ((present + (halfDay * 0.5)) / total * 100).toFixed(1) : '0.0';
    const records = db.prepare('SELECT * FROM teacher_attendance WHERE teacher_id = ? ORDER BY date DESC LIMIT 60').all(teacherId);
    res.json({ summary: { total, present, absent, leave, halfDay, percentage }, records });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teacher attendance: ' + err.message });
  }
});



// 6. GET /api/admin/users
router.get('/users', (req, res) => {
  const { role, search } = req.query;
  let query = 'SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo, is_active, created_at FROM users WHERE 1=1';
  const params = [];

  if (role && role !== 'All') {
    query += ' AND role = ?';
    params.push(role);
  }

  if (search) {
    query += ' AND (name LIKE ? OR username LIKE ? OR post LIKE ? OR employee_id LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY id DESC';
  const users = db.prepare(query).all(...params);
  res.json({ users });
});

// 7. POST /api/admin/users
router.post('/users', (req, res) => {
  const { name, username, password, role, post, email, phone, employeeId, department, profilePhoto } = req.body;
  if (!name || !username || !password || !role || !post) {
    return res.status(400).json({ error: 'Name, username, password, role, and post are required.' });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    if (existing) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const result = stmt.run(name.trim(), username.trim(), hash, role, post.trim(), email || null, phone || null, employeeId || null, department || null, profilePhoto || null);

    const newUser = db.prepare('SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo, is_active FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user: ' + err.message });
  }
});

// 8. PUT /api/admin/users/:id - Full user edit
router.put('/users/:id', (req, res) => {
  const userId = req.params.id;
  const { name, username, password, role, post, email, phone, employeeId, department, profilePhoto, isActive } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let updatedUsername = user.username;
    if (username && username.trim() && username.trim().toLowerCase() !== user.username.toLowerCase()) {
      const cleanUsername = username.trim();
      const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanUsername, userId);
      if (existing) return res.status(409).json({ error: `Username '${cleanUsername}' is already taken.` });
      updatedUsername = cleanUsername;
    }

    let updatedPasswordHash = user.password_hash;
    if (password && String(password).trim().length > 0) {
      updatedPasswordHash = bcrypt.hashSync(String(password).trim(), 10);
    }

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          username = ?,
          password_hash = ?,
          role = COALESCE(?, role),
          post = COALESCE(?, post),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          employee_id = COALESCE(?, employee_id),
          department = COALESCE(?, department),
          profile_photo = COALESCE(?, profile_photo),
          is_active = COALESCE(?, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      updatedUsername,
      updatedPasswordHash,
      role || null,
      post ? post.trim() : null,
      email !== undefined ? (email || null) : null,
      phone !== undefined ? (phone || null) : null,
      employeeId ? employeeId.trim() : null,
      department ? department.trim() : null,
      profilePhoto || null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      userId
    );

    const updated = db.prepare('SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo, is_active FROM users WHERE id = ?').get(userId);
    res.json({ message: 'User updated successfully.', user: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

// 9. PUT /api/admin/users/:id/status - Toggle account status
router.put('/users/:id/status', (req, res) => {
  const userId = req.params.id;
  const { isActive } = req.body;

  try {
    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      isActive ? 1 : 0,
      userId
    );

    res.json({
      message: `User ${user.name}'s account has been ${isActive ? 'enabled' : 'disabled'}.`,
      isActive: Boolean(isActive)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update account status: ' + err.message });
  }
});

// 10. DELETE /api/admin/users/:id - Delete user account
router.delete('/users/:id', (req, res) => {
  const userId = req.params.id;
  if (parseInt(userId, 10) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own active administrator account.' });
  }

  try {
    const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      db.exec('COMMIT;');
      res.json({ message: `User '${user.name}' deleted successfully.` });
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user: ' + err.message });
  }
});

// 11. PUT /api/admin/users/:id/role
router.put('/users/:id/role', (req, res) => {
  const userId = req.params.id;
  const { role, post } = req.body;

  try {
    db.prepare(`
      UPDATE users 
      SET role = ?, post = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(role, post, userId);

    const updated = db.prepare('SELECT id, name, username, role, post, email, phone FROM users WHERE id = ?').get(userId);
    res.json({ message: `Role updated to ${role} successfully. Next login will automatically route to ${role} portal.`, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Permissions & Principal Decision
router.get('/permissions', (req, res) => {
  const requests = db.prepare(`
    SELECT pr.*, s.roll_no, u.name as student_name, c.name as class_name,
           p.name as parent_name, p.phone as parent_phone
    FROM permission_requests pr
    JOIN students s ON pr.student_id = s.id
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    LEFT JOIN users p ON s.parent_id = p.id
    ORDER BY pr.id DESC
  `).all();
  res.json({ requests });
});

router.put('/permissions/:id', (req, res) => {
  const { action, comments } = req.body;
  const requestId = req.params.id;
  const principalName = req.user.name;

  const reqRecord = db.prepare(`
    SELECT pr.*, s.user_id as student_user_id, s.parent_id, u.name as student_name
    FROM permission_requests pr
    JOIN students s ON pr.student_id = s.id
    JOIN users u ON s.user_id = u.id
    WHERE pr.id = ?
  `).get(requestId);

  if (!reqRecord) return res.status(404).json({ error: 'Permission request not found.' });

  let principalApproval = action === 'ACCEPT' ? 'APPROVED' : 'REJECTED';
  let finalStatus = action === 'ACCEPT' ? 'APPROVED' : 'REJECTED';

  db.prepare(`
    UPDATE permission_requests
    SET principal_approval = ?, final_status = ?, notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(principalApproval, finalStatus, comments || null, requestId);

  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (?, ?, ?, ?)
  `);

  const statusTitle = action === 'ACCEPT' ? 'PERMISSION GRANTED' : 'PERMISSION REJECTED';
  const notifMsg = `Final Decision: ${statusTitle} for ${reqRecord.type} on ${reqRecord.date}.\nReviewed & Authorized by Principal ${principalName}.`;

  insertNotif.run(reqRecord.student_user_id, statusTitle, notifMsg, `${reqRecord.type}_STATUS`);
  if (reqRecord.parent_id) {
    insertNotif.run(reqRecord.parent_id, `${statusTitle}: ${reqRecord.student_name}`, notifMsg, `${reqRecord.type}_STATUS`);
  }

  res.json({
    message: `Permission request has been ${action === 'ACCEPT' ? 'GRANTED' : 'REJECTED'} by Principal.`,
    finalStatus,
    principalApproval
  });
});

// 10. Academic Classes & Subjects
router.get('/classes', (req, res) => {
  const classes = db.prepare(`
    SELECT c.*, 
           (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as student_count,
           (SELECT COUNT(*) FROM teacher_assignments ta WHERE ta.class_id = c.id) as assignment_count
    FROM classes c
    ORDER BY c.name
  `).all();
  res.json({ classes });
});

router.post('/classes', (req, res) => {
  const { name, department, year, section, semester } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'Class name and department required.' });

  try {
    const result = db.prepare(`
      INSERT INTO classes (name, department, year, section, semester)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, department, year || 1, section || 'A', semester || 1);
    res.status(201).json({ message: 'Class created', id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/subjects', (req, res) => {
  const subjects = db.prepare('SELECT * FROM subjects ORDER BY name').all();
  res.json({ subjects });
});

router.post('/subjects', (req, res) => {
  const { code, name, department, credits = 3 } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'Code and Name required.' });

  try {
    const result = db.prepare(`
      INSERT INTO subjects (code, name, department, credits)
      VALUES (?, ?, ?, ?)
    `).run(code, name, department || 'General', parseInt(credits, 10));
    res.status(201).json({ message: 'Subject created', id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/assign-teacher', (req, res) => {
  const { teacherId, classId, subjectId } = req.body;
  if (!teacherId || !classId || !subjectId) {
    return res.status(400).json({ error: 'teacherId, classId, and subjectId are required.' });
  }

  try {
    db.prepare(`
      INSERT INTO teacher_assignments (teacher_id, class_id, subject_id)
      VALUES (?, ?, ?)
      ON CONFLICT(teacher_id, class_id, subject_id) DO NOTHING
    `).run(teacherId, classId, subjectId);
    res.status(201).json({ message: 'Teacher assigned to class & subject successfully.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 11. Student Management Endpoints (Full CRUD & Safety)

// GET /api/admin/students - List all students with linked parent credentials, class, photo & active status
router.get('/students', (req, res) => {
  const { search, classId, department } = req.query;
  let query = `
    SELECT s.id, s.user_id, s.roll_no, s.class_id, s.parent_id, s.department, s.year, s.semester, s.relationship,
           u.name, u.username, u.email, u.phone, u.profile_photo, u.is_active, u.created_at,
           c.name as class_name, c.section,
           p.id as parent_user_id, p.name as parent_name, p.username as parent_username,
           p.phone as parent_phone, p.email as parent_email, p.post as parent_post,
           p.profile_photo as parent_profile_photo
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    LEFT JOIN users p ON s.parent_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (classId) {
    query += ' AND s.class_id = ?';
    params.push(classId);
  }

  if (department && department !== 'All') {
    query += ' AND s.department = ?';
    params.push(department);
  }

  if (search) {
    query += ' AND (u.name LIKE ? OR s.roll_no LIKE ? OR u.username LIKE ? OR c.name LIKE ? OR p.name LIKE ? OR p.username LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term, term, term);
  }

  query += ' ORDER BY c.name, CAST(s.roll_no AS INTEGER)';
  const students = db.prepare(query).all(...params);
  res.json({ students });
});

// POST /api/admin/students - Create new student with atomic Parent creation & linking
router.post('/students', (req, res) => {
  const {
    name, username, password, rollNo, classId, email, phone, profilePhoto, totalFee = 80000,
    parentId, // optional if selecting existing parent
    parentName, parentPhone, parentEmail, parentRelationship, parentUsername, parentPassword, parentProfilePhoto
  } = req.body;

  // 1. Enforce student required fields
  if (!name || !username || !password || !rollNo || !classId) {
    return res.status(400).json({ error: 'Student Name, User ID, Password, Roll Number, and Class are required.' });
  }

  const cleanStudentUsername = String(username).trim();
  const cleanStudentRoll = String(rollNo).trim();

  try {
    // Check student username uniqueness
    const existingStudentUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanStudentUsername);
    if (existingStudentUser) {
      return res.status(409).json({ error: `Student User ID '${cleanStudentUsername}' is already taken.` });
    }

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: 'Selected class does not exist.' });

    let finalParentId = parentId ? parseInt(parentId, 10) : null;

    // 2. Validate or create Parent
    if (!finalParentId) {
      // Parent details must be provided
      if (!parentName || !parentUsername || !parentPassword) {
        return res.status(400).json({ error: 'Parent Name, Parent User ID, and Parent Password are required.' });
      }

      const cleanParentUsername = String(parentUsername).trim();

      if (cleanParentUsername.toLowerCase() === cleanStudentUsername.toLowerCase()) {
        return res.status(400).json({ error: 'Student User ID and Parent User ID cannot be the same.' });
      }

      const existingParentUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanParentUsername);
      if (existingParentUser) {
        return res.status(409).json({ error: `Parent User ID '${cleanParentUsername}' is already taken.` });
      }
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // Create Parent if new parent was specified
      if (!finalParentId) {
        const cleanParentUsername = String(parentUsername).trim();
        const parentHash = bcrypt.hashSync(String(parentPassword).trim(), 10);
        const parentRole = 'Parent';
        const parentPost = parentRelationship ? String(parentRelationship).trim() : 'Parent';

        const parentRes = db.prepare(`
          INSERT INTO users (name, username, password_hash, role, post, email, phone, profile_photo, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          String(parentName).trim(),
          cleanParentUsername,
          parentHash,
          parentRole,
          parentPost,
          parentEmail ? String(parentEmail).trim() : null,
          parentPhone ? String(parentPhone).trim() : null,
          parentProfilePhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cleanParentUsername}`
        );
        finalParentId = parentRes.lastInsertRowid;
      }

      // Create Student User
      const studentHash = bcrypt.hashSync(String(password).trim(), 10);
      const studentUserRes = db.prepare(`
        INSERT INTO users (name, username, password_hash, role, post, email, phone, profile_photo, department, is_active)
        VALUES (?, ?, ?, 'Student', 'Student', ?, ?, ?, ?, 1)
      `).run(
        String(name).trim(),
        cleanStudentUsername,
        studentHash,
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null,
        profilePhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cleanStudentUsername}`,
        cls.department
      );
      const studentUserId = studentUserRes.lastInsertRowid;

      // Link Student with Class and Parent
      const studentRes = db.prepare(`
        INSERT INTO students (user_id, class_id, parent_id, roll_no, department, year, semester, relationship)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        studentUserId,
        cls.id,
        finalParentId,
        cleanStudentRoll,
        cls.department,
        cls.year,
        cls.semester,
        parentRelationship ? String(parentRelationship).trim() : 'Parent'
      );
      const studentId = studentRes.lastInsertRowid;

      // Initialize Fee Ledger
      db.prepare(`
        INSERT INTO student_fees (student_id, department, year, semester, total_fee, paid_amount, pending_amount)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run(studentId, cls.department, cls.year, cls.semester, parseFloat(totalFee), parseFloat(totalFee));

      db.exec('COMMIT;');

      res.status(201).json({
        message: `Student '${name}' (Roll #${rollNo}) and Parent account created and linked successfully!`,
        studentId,
        userId: studentUserId,
        parentId: finalParentId
      });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    console.error('Error creating student:', err);
    res.status(500).json({ error: 'Failed to create student: ' + err.message });
  }
});

// PUT /api/admin/students/:id - Edit student details, student credentials, and parent details & credentials
router.put('/students/:id', (req, res) => {
  const studentId = req.params.id;
  const {
    name, username, password, rollNo, classId, email, phone, profilePhoto,
    parentId, parentName, parentUsername, parentPassword, parentPhone, parentEmail, parentRelationship, parentProfilePhoto
  } = req.body;

  try {
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) return res.status(404).json({ error: 'Student record not found.' });

    const studentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(student.user_id);
    if (!studentUser) return res.status(404).json({ error: 'Associated student user account not found.' });

    // 1. Check student username uniqueness if changed
    let updatedStudentUsername = studentUser.username;
    if (username && username.trim() && username.trim().toLowerCase() !== studentUser.username.toLowerCase()) {
      const cleanU = username.trim();
      const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanU, student.user_id);
      if (existing) {
        return res.status(409).json({ error: `Student User ID '${cleanU}' is already taken by another user.` });
      }
      updatedStudentUsername = cleanU;
    }

    // 2. Hash student password if provided
    let updatedStudentPassHash = studentUser.password_hash;
    if (password && String(password).trim().length > 0) {
      updatedStudentPassHash = bcrypt.hashSync(String(password).trim(), 10);
    }

    let cls = null;
    if (classId) {
      cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // Update Student User record
      db.prepare(`
        UPDATE users
        SET name = COALESCE(?, name),
            username = ?,
            password_hash = ?,
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            profile_photo = COALESCE(?, profile_photo),
            department = COALESCE(?, department),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        name ? name.trim() : null,
        updatedStudentUsername,
        updatedStudentPassHash,
        email !== undefined ? email : null,
        phone !== undefined ? phone : null,
        profilePhoto || null,
        cls ? cls.department : null,
        student.user_id
      );

      // Handle Parent updates if parent details or credentials provided
      let currentParentId = student.parent_id;
      if (parentId !== undefined && parentId !== null && parentId !== '') {
        currentParentId = parseInt(parentId, 10);
      }

      if (currentParentId) {
        const parentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(currentParentId);
        if (parentUser) {
          let updatedParentUsername = parentUser.username;
          if (parentUsername && parentUsername.trim() && parentUsername.trim().toLowerCase() !== parentUser.username.toLowerCase()) {
            const cleanPU = parentUsername.trim();
            const existingP = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanPU, currentParentId);
            if (existingP) {
              db.exec('ROLLBACK;');
              return res.status(409).json({ error: `Parent User ID '${cleanPU}' is already taken by another account.` });
            }
            updatedParentUsername = cleanPU;
          }

          let updatedParentPassHash = parentUser.password_hash;
          if (parentPassword && String(parentPassword).trim().length > 0) {
            updatedParentPassHash = bcrypt.hashSync(String(parentPassword).trim(), 10);
          }

          db.prepare(`
            UPDATE users
            SET name = COALESCE(?, name),
                username = ?,
                password_hash = ?,
                phone = COALESCE(?, phone),
                email = COALESCE(?, email),
                post = COALESCE(?, post),
                profile_photo = COALESCE(?, profile_photo),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            parentName ? parentName.trim() : null,
            updatedParentUsername,
            updatedParentPassHash,
            parentPhone !== undefined ? parentPhone : null,
            parentEmail !== undefined ? parentEmail : null,
            parentRelationship ? parentRelationship.trim() : null,
            parentProfilePhoto || null,
            currentParentId
          );
        }
      } else if (parentName && parentUsername && parentPassword) {
        // No parent currently linked, but new parent credentials supplied in edit form!
        const cleanPU = parentUsername.trim();
        const existingP = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanPU);
        if (existingP) {
          db.exec('ROLLBACK;');
          return res.status(409).json({ error: `Parent User ID '${cleanPU}' is already taken.` });
        }
        const parentHash = bcrypt.hashSync(String(parentPassword).trim(), 10);
        const newParentRes = db.prepare(`
          INSERT INTO users (name, username, password_hash, role, post, email, phone, profile_photo, is_active)
          VALUES (?, ?, ?, 'Parent', ?, ?, ?, ?, 1)
        `).run(
          parentName.trim(),
          cleanPU,
          parentHash,
          parentRelationship ? parentRelationship.trim() : 'Parent',
          parentEmail || null,
          parentPhone || null,
          parentProfilePhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cleanPU}`
        );
        currentParentId = newParentRes.lastInsertRowid;
      }

      // Update Students table
      db.prepare(`
        UPDATE students
        SET roll_no = COALESCE(?, roll_no),
            class_id = COALESCE(?, class_id),
            parent_id = ?,
            department = COALESCE(?, department),
            year = COALESCE(?, year),
            semester = COALESCE(?, semester),
            relationship = COALESCE(?, relationship)
        WHERE id = ?
      `).run(
        rollNo ? rollNo.trim() : null,
        cls ? cls.id : null,
        currentParentId,
        cls ? cls.department : null,
        cls ? cls.year : null,
        cls ? cls.semester : null,
        parentRelationship ? parentRelationship.trim() : null,
        studentId
      );

      db.exec('COMMIT;');
      res.json({ message: 'Student and parent information & credentials updated successfully.' });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    console.error('Error updating student:', err);
    res.status(500).json({ error: 'Failed to update student: ' + err.message });
  }
});

// PUT /api/admin/students/:id/status - Toggle active/disabled status
router.put('/students/:id/status', (req, res) => {
  const studentId = req.params.id;
  const { isActive } = req.body;

  try {
    const student = db.prepare('SELECT user_id FROM students WHERE id = ?').get(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      isActive ? 1 : 0,
      student.user_id
    );

    res.json({
      message: `Student account has been ${isActive ? 'enabled' : 'disabled'}.`,
      isActive: Boolean(isActive)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update student status: ' + err.message });
  }
});

// DELETE /api/admin/students/:id - Safe student deletion with smart parent cleanup
router.delete('/students/:id', (req, res) => {
  const studentId = req.params.id;

  try {
    const student = db.prepare('SELECT user_id, parent_id, roll_no FROM students WHERE id = ?').get(studentId);
    if (!student) return res.status(404).json({ error: 'Student record not found.' });

    const studentUser = db.prepare('SELECT name FROM users WHERE id = ?').get(student.user_id);
    const studentName = studentUser ? studentUser.name : `Roll #${student.roll_no}`;

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Safely delete dependent records belonging only to this student
      db.prepare('DELETE FROM attendance WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM semester_results WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM permission_requests WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM book_loans WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM canteen_orders WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM fee_payments WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM student_fees WHERE student_id = ?').run(studentId);

      // 2. Delete student record
      db.prepare('DELETE FROM students WHERE id = ?').run(studentId);

      // 3. Delete student user notifications & user record
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(student.user_id);
      db.prepare('DELETE FROM users WHERE id = ?').run(student.user_id);

      // 4. Handle linked parent relationship:
      // If parent has no other children in the school, clean up orphan parent account.
      // If parent has other children, retain parent account!
      if (student.parent_id) {
        const otherChildren = db.prepare('SELECT count(*) as count FROM students WHERE parent_id = ?').get(student.parent_id);
        if (otherChildren.count === 0) {
          db.prepare('DELETE FROM notifications WHERE user_id = ?').run(student.parent_id);
          db.prepare("DELETE FROM users WHERE id = ? AND role = 'Parent'").run(student.parent_id);
        }
      }

      db.exec('COMMIT;');
      res.json({ message: `Student '${studentName}' (Roll #${student.roll_no}) deleted safely without leaving orphan records.` });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    console.error('Error deleting student:', err);
    res.status(500).json({ error: 'Failed to delete student: ' + err.message });
  }
});

// GET /api/admin/parents - List all parents with linked ward information
router.get('/parents', (req, res) => {
  const { search } = req.query;
  let query = `
    SELECT u.id, u.name, u.username, u.email, u.phone, u.post as relationship,
           u.profile_photo, u.is_active, u.created_at
    FROM users u
    WHERE u.role = 'Parent'
  `;
  const params = [];
  if (search) {
    query += ' AND (u.name LIKE ? OR u.username LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  query += ' ORDER BY u.name ASC';
  const parents = db.prepare(query).all(...params);

  const parentsWithWards = parents.map(p => {
    const wards = db.prepare(`
      SELECT s.id as student_id, u.name as student_name, s.roll_no, c.name as class_name, s.department
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.parent_id = ?
    `).all(p.id);
    return { ...p, wards };
  });

  res.json({ parents: parentsWithWards });
});

// POST /api/admin/parents - Create a new parent account
router.post('/parents', (req, res) => {
  const { name, username, password, email, phone, relationship, profilePhoto, studentId } = req.body;

  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, Username/ID, and Password are required.' });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    if (existing) {
      return res.status(409).json({ error: `Username '${username.trim()}' is already taken.` });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, profile_photo, is_active)
      VALUES (?, ?, ?, 'Parent', ?, ?, ?, ?, 1)
    `).run(
      name.trim(),
      username.trim(),
      hash,
      relationship || 'Parent / Guardian',
      email ? email.trim() : null,
      phone ? phone.trim() : null,
      profilePhoto || null
    );

    const parentId = result.lastInsertRowid;

    // If studentId was passed, link student to this parent
    if (studentId) {
      db.prepare('UPDATE students SET parent_id = ? WHERE id = ?').run(parentId, studentId);
    }

    const newParent = db.prepare('SELECT id, name, username, email, phone, post, profile_photo, is_active FROM users WHERE id = ?').get(parentId);
    res.status(201).json({ message: `Parent account '${name}' created successfully.`, parent: newParent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create parent: ' + err.message });
  }
});

// PUT /api/admin/parents/:id - Edit parent details & credentials
router.put('/parents/:id', (req, res) => {
  const parentId = req.params.id;
  const { name, username, password, email, phone, relationship, profilePhoto } = req.body;

  try {
    const parent = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'Parent'").get(parentId);
    if (!parent) return res.status(404).json({ error: 'Parent account not found.' });

    let updatedUsername = parent.username;
    if (username && username.trim() && username.trim().toLowerCase() !== parent.username.toLowerCase()) {
      const cleanUsername = username.trim();
      const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanUsername, parentId);
      if (existing) return res.status(409).json({ error: `Username '${cleanUsername}' is already taken.` });
      updatedUsername = cleanUsername;
    }

    let updatedPasswordHash = parent.password_hash;
    if (password && String(password).trim().length > 0) {
      updatedPasswordHash = bcrypt.hashSync(String(password).trim(), 10);
    }

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          username = ?,
          password_hash = ?,
          post = COALESCE(?, post),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          profile_photo = COALESCE(?, profile_photo),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND role = 'Parent'
    `).run(
      name ? name.trim() : null,
      updatedUsername,
      updatedPasswordHash,
      relationship ? relationship.trim() : null,
      email !== undefined ? (email || null) : null,
      phone !== undefined ? (phone || null) : null,
      profilePhoto || null,
      parentId
    );

    const updated = db.prepare('SELECT id, name, username, email, phone, post as relationship, profile_photo, is_active FROM users WHERE id = ?').get(parentId);
    res.json({ message: `Parent '${updated.name}' updated successfully.`, parent: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update parent: ' + err.message });
  }
});

// PUT /api/admin/parents/:id/status - Toggle parent account access
router.put('/parents/:id/status', (req, res) => {
  const parentId = req.params.id;
  const { isActive } = req.body;

  try {
    const parent = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'Parent'").get(parentId);
    if (!parent) return res.status(404).json({ error: 'Parent not found.' });

    db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      isActive ? 1 : 0,
      parentId
    );

    res.json({
      message: `Parent ${parent.name}'s account has been ${isActive ? 'enabled' : 'disabled'}.`,
      isActive: Boolean(isActive)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update parent status: ' + err.message });
  }
});

// DELETE /api/admin/parents/:id - Delete parent account
router.delete('/parents/:id', (req, res) => {
  const parentId = req.params.id;

  try {
    const parent = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'Parent'").get(parentId);
    if (!parent) return res.status(404).json({ error: 'Parent account not found.' });

    db.exec('BEGIN TRANSACTION;');
    try {
      // Unlink student associations
      db.prepare('UPDATE students SET parent_id = NULL WHERE parent_id = ?').run(parentId);
      // Remove notifications
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(parentId);
      // Remove user record
      db.prepare("DELETE FROM users WHERE id = ? AND role = 'Parent'").run(parentId);
      db.exec('COMMIT;');

      res.json({ message: `Parent account '${parent.name}' removed successfully.` });
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete parent: ' + err.message });
  }
});

// ==========================================
// TEACHER ATTENDANCE MODULE (SEPARATE FROM STUDENT ATTENDANCE)
// ==========================================

// GET /api/admin/teacher-attendance
// Search by date, month, teacher, or view all
router.get('/teacher-attendance', (req, res) => {
  const { date, month, teacherId, search } = req.query;
  try {
    let query = `
      SELECT ta.*, u.username, u.employee_id, u.email, u.phone
      FROM teacher_attendance ta
      JOIN users u ON ta.teacher_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      query += ' AND ta.date = ?';
      params.push(date);
    } else if (month) {
      query += ' AND ta.date LIKE ?';
      params.push(`${month}%`);
    }

    if (teacherId) {
      query += ' AND ta.teacher_id = ?';
      params.push(teacherId);
    }

    if (search) {
      query += ' AND (ta.teacher_name LIKE ? OR ta.department LIKE ? OR u.employee_id LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY ta.date DESC, ta.teacher_name ASC';
    const records = db.prepare(query).all(...params);

    // Also get all active teachers for the day if a specific date is selected
    // so any teacher without a record for that date can be marked
    let teachers = [];
    if (date) {
      teachers = db.prepare(`
        SELECT id, name, department, employee_id, email, phone
        FROM users
        WHERE role = 'Teacher' AND is_active = 1
        ORDER BY name ASC
      `).all();
    }

    res.json({ records, teachers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teacher attendance: ' + err.message });
  }
});

// POST /api/admin/teacher-attendance
// Mark or update teacher attendance (single or bulk array)
router.post('/teacher-attendance', (req, res) => {
  const { records, date, teacherId, status, remarks } = req.body;
  const adminName = req.user?.name || 'Administrator';
  const adminId = req.user?.id || null;

  try {
    const upsertStmt = db.prepare(`
      INSERT INTO teacher_attendance (teacher_id, teacher_name, department, date, status, remarks, marked_by, marked_by_name, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(teacher_id, date) DO UPDATE SET
        status = excluded.status,
        remarks = excluded.remarks,
        marked_by = excluded.marked_by,
        marked_by_name = excluded.marked_by_name,
        updated_at = CURRENT_TIMESTAMP
    `);

    if (Array.isArray(records) && records.length > 0) {
      for (const r of records) {
        const teacher = db.prepare('SELECT name, department FROM users WHERE id = ?').get(r.teacherId);
        if (teacher) {
          upsertStmt.run(
            r.teacherId,
            teacher.name,
            teacher.department || 'Faculty',
            r.date,
            r.status || 'Present',
            r.remarks || '',
            adminId,
            adminName
          );
        }
      }
      return res.json({ message: `Successfully saved attendance for ${records.length} teacher(s).` });
    }

    if (!teacherId || !date || !status) {
      return res.status(400).json({ error: 'teacherId, date, and status are required.' });
    }

    const teacher = db.prepare('SELECT name, department FROM users WHERE id = ?').get(teacherId);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found.' });
    }

    upsertStmt.run(
      teacherId,
      teacher.name,
      teacher.department || 'Faculty',
      date,
      status,
      remarks || '',
      adminId,
      adminName
    );

    res.json({ message: `Attendance for Prof. ${teacher.name} marked as ${status}.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark teacher attendance: ' + err.message });
  }
});

// PUT /api/admin/teacher-attendance/:id
// Edit an existing teacher attendance entry
router.put('/teacher-attendance/:id', (req, res) => {
  const { id } = req.params;
  const { status, remarks } = req.body;
  const adminName = req.user?.name || 'Administrator';
  const adminId = req.user?.id || null;

  try {
    const existing = db.prepare('SELECT * FROM teacher_attendance WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Attendance record not found.' });
    }

    db.prepare(`
      UPDATE teacher_attendance
      SET status = COALESCE(?, status),
          remarks = COALESCE(?, remarks),
          marked_by = ?,
          marked_by_name = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status || null, remarks !== undefined ? remarks : null, adminId, adminName, id);

    const updated = db.prepare('SELECT * FROM teacher_attendance WHERE id = ?').get(id);
    res.json({ message: 'Teacher attendance record updated successfully.', record: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update attendance record: ' + err.message });
  }
});

// GET /api/admin/teacher-attendance/stats
// Returns summary statistics for teacher attendance
router.get('/teacher-attendance-stats', (req, res) => {
  const { month } = req.query; // YYYY-MM
  const currentMonth = month || new Date().toISOString().substring(0, 7);

  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_entries,
        SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) as absent_count,
        SUM(CASE WHEN status = 'Leave' THEN 1 ELSE 0 END) as leave_count,
        SUM(CASE WHEN status = 'Half-Day' THEN 1 ELSE 0 END) as half_day_count
      FROM teacher_attendance
      WHERE date LIKE ?
    `).get(`${currentMonth}%`);

    const byTeacher = db.prepare(`
      SELECT 
        ta.teacher_id,
        ta.teacher_name,
        ta.department,
        COUNT(*) as total_days,
        SUM(CASE WHEN ta.status = 'Present' THEN 1 ELSE 0 END) as present_days,
        SUM(CASE WHEN ta.status = 'Absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN ta.status = 'Leave' THEN 1 ELSE 0 END) as leave_days,
        SUM(CASE WHEN ta.status = 'Half-Day' THEN 1 ELSE 0 END) as half_day_days
      FROM teacher_attendance ta
      WHERE ta.date LIKE ?
      GROUP BY ta.teacher_id, ta.teacher_name, ta.department
      ORDER BY ta.teacher_name ASC
    `).all(`${currentMonth}%`);

    res.json({
      month: currentMonth,
      summary: stats,
      byTeacher
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attendance stats: ' + err.message });
  }
});

// ==========================================
// TEACHER SUBJECT & CLASS MANAGEMENT MODULE
// ==========================================

// GET /api/admin/teacher-assignments
// List all assignments and available teachers, classes, subjects
router.get('/teacher-assignments', (req, res) => {
  try {
    const assignments = db.prepare(`
      SELECT 
        ta.id as assignment_id,
        ta.teacher_id,
        u.name as teacher_name,
        u.email as teacher_email,
        u.department as teacher_dept,
        u.employee_id,
        ta.class_id,
        c.name as class_name,
        c.department as class_dept,
        c.year as class_year,
        c.section as class_section,
        ta.subject_id,
        s.name as subject_name,
        s.code as subject_code,
        s.credits as subject_credits,
        ta.created_at
      FROM teacher_assignments ta
      JOIN users u ON ta.teacher_id = u.id
      JOIN classes c ON ta.class_id = c.id
      JOIN subjects s ON ta.subject_id = s.id
      ORDER BY u.name ASC, c.name ASC, s.name ASC
    `).all();

    const teachers = db.prepare(`
      SELECT id, name, department, employee_id, email, phone
      FROM users
      WHERE role = 'Teacher' AND is_active = 1
      ORDER BY name ASC
    `).all();

    const classes = db.prepare(`
      SELECT id, name, department, year, section, semester
      FROM classes
      ORDER BY name ASC
    `).all();

    const subjects = db.prepare(`
      SELECT id, code, name, department, credits
      FROM subjects
      ORDER BY name ASC
    `).all();

    res.json({ assignments, teachers, classes, subjects });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignments: ' + err.message });
  }
});

// POST /api/admin/teacher-assignments
// Assign a subject & class to a teacher
router.post('/teacher-assignments', (req, res) => {
  const { teacherId, classId, subjectId } = req.body;

  if (!teacherId || !classId || !subjectId) {
    return res.status(400).json({ error: 'teacherId, classId, and subjectId are all required.' });
  }

  try {
    const existing = db.prepare(`
      SELECT id FROM teacher_assignments
      WHERE teacher_id = ? AND class_id = ? AND subject_id = ?
    `).get(teacherId, classId, subjectId);

    if (existing) {
      return res.status(409).json({ error: 'This subject is already assigned to this teacher for this class.' });
    }

    const result = db.prepare(`
      INSERT INTO teacher_assignments (teacher_id, class_id, subject_id)
      VALUES (?, ?, ?)
    `).run(teacherId, classId, subjectId);

    const teacher = db.prepare('SELECT name FROM users WHERE id = ?').get(teacherId);
    const subject = db.prepare('SELECT name FROM subjects WHERE id = ?').get(subjectId);
    const cls = db.prepare('SELECT name FROM classes WHERE id = ?').get(classId);

    res.status(201).json({
      message: `Assigned "${subject?.name}" in "${cls?.name}" to Prof. ${teacher?.name} successfully.`,
      assignmentId: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign teacher: ' + err.message });
  }
});

// DELETE /api/admin/teacher-assignments/:id
// Remove an assignment
router.delete('/teacher-assignments/:id', (req, res) => {
  const { id } = req.params;

  try {
    const assignment = db.prepare(`
      SELECT ta.*, u.name as teacher_name, s.name as subject_name, c.name as class_name
      FROM teacher_assignments ta
      JOIN users u ON ta.teacher_id = u.id
      JOIN subjects s ON ta.subject_id = s.id
      JOIN classes c ON ta.class_id = c.id
      WHERE ta.id = ?
    `).get(id);

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found.' });
    }

    db.prepare('DELETE FROM teacher_assignments WHERE id = ?').run(id);

    res.json({
      message: `Removed assignment of "${assignment.subject_name}" from Prof. ${assignment.teacher_name}.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove assignment: ' + err.message });
  }
});

// ============================================================
// STAFF MANAGEMENT (Non-academic staff: Driver, Watchman, Attendant, OfficeStaff, Cleaner, Other, Canteen)
// ============================================================

const STAFF_ROLES = ['Driver', 'Watchman', 'Attender', 'Attendant', 'Lab Technician', 'OfficeStaff', 'Cleaner', 'Other', 'Canteen', 'Cashier', 'Librarian'];

// GET /api/admin/staff - List all non-academic staff
router.get('/staff', (req, res) => {
  const { role, search, department } = req.query;

  let query = `
    SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo, is_active, created_at
    FROM users
    WHERE role IN ('Driver','Watchman','Attender','Attendant','Lab Technician','OfficeStaff','Cleaner','Other','Canteen','Cashier','Librarian')
  `;
  const params = [];

  if (role && role !== 'All') {
    query += ' AND role = ?';
    params.push(role);
  }

  if (department && department !== 'All') {
    query += ' AND department = ?';
    params.push(department);
  }

  if (search) {
    query += ' AND (name LIKE ? OR username LIKE ? OR employee_id LIKE ? OR post LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY role ASC, name ASC';
  const staff = db.prepare(query).all(...params);
  res.json({ staff });
});

// POST /api/admin/staff - Create a new staff account
router.post('/staff', (req, res) => {
  const { name, username, password, role, post, email, phone, employeeId, department, profilePhoto } = req.body;

  if (!name || !username || !password || !role || !post) {
    return res.status(400).json({ error: 'Name, User ID, Password, Role, and Post/Designation are required.' });
  }

  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid staff role '${role}'. Allowed: ${STAFF_ROLES.join(', ')}` });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    if (existing) {
      return res.status(409).json({ error: `User ID '${username.trim()}' is already taken.` });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      name.trim(),
      username.trim(),
      hash,
      role,
      post.trim(),
      email || null,
      phone || null,
      employeeId ? employeeId.trim() : null,
      department ? department.trim() : null,
      profilePhoto || null
    );

    const newStaff = db.prepare(
      'SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo, is_active FROM users WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.status(201).json({ message: `Staff member '${name}' created successfully.`, staff: newStaff });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create staff: ' + err.message });
  }
});

// PUT /api/admin/staff/:id - Edit staff details & credentials
router.put('/staff/:id', (req, res) => {
  const staffId = req.params.id;
  const { name, username, password, role, post, email, phone, employeeId, department, profilePhoto, isActive } = req.body;

  try {
    const staff = db.prepare('SELECT * FROM users WHERE id = ? AND role IN (\'Driver\',\'Watchman\',\'Attender\',\'Attendant\',\'Lab Technician\',\'OfficeStaff\',\'Cleaner\',\'Other\',\'Canteen\',\'Cashier\',\'Librarian\')').get(staffId);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found.' });
    }

    // Validate username uniqueness if changed
    let updatedUsername = staff.username;
    if (username && username.trim() && username.trim().toLowerCase() !== staff.username.toLowerCase()) {
      const cleanUsername = username.trim();
      const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanUsername, staffId);
      if (existing) {
        return res.status(409).json({ error: `User ID '${cleanUsername}' is already taken by another account.` });
      }
      updatedUsername = cleanUsername;
    }

    // Hash new password if provided
    let updatedPasswordHash = staff.password_hash;
    if (password && String(password).trim().length > 0) {
      updatedPasswordHash = bcrypt.hashSync(String(password).trim(), 10);
    }

    // Validate role if being changed
    if (role && !STAFF_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid staff role '${role}'.` });
    }

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          username = ?,
          password_hash = ?,
          role = COALESCE(?, role),
          post = COALESCE(?, post),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          employee_id = COALESCE(?, employee_id),
          department = COALESCE(?, department),
          profile_photo = COALESCE(?, profile_photo),
          is_active = COALESCE(?, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      updatedUsername,
      updatedPasswordHash,
      role || null,
      post ? post.trim() : null,
      email !== undefined ? (email || null) : null,
      phone !== undefined ? (phone || null) : null,
      employeeId ? employeeId.trim() : null,
      department ? department.trim() : null,
      profilePhoto || null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      staffId
    );

    // If role changed, update any existing staff_attendance records for this staff member
    if (role) {
      db.prepare('UPDATE staff_attendance SET staff_role = ? WHERE staff_id = ?').run(role, staffId);
    }

    const updatedStaff = db.prepare(
      'SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo, is_active FROM users WHERE id = ?'
    ).get(staffId);

    res.json({ message: `Staff member '${updatedStaff.name}' updated successfully.`, staff: updatedStaff });
  } catch (err) {
    console.error('Error updating staff:', err);
    res.status(500).json({ error: 'Failed to update staff: ' + err.message });
  }
});

// DELETE /api/admin/staff/:id - Safely remove staff member and all their attendance records
router.delete('/staff/:id', (req, res) => {
  const staffId = req.params.id;
  try {
    const staff = db.prepare('SELECT id, name, role FROM users WHERE id = ? AND role IN (\'Driver\',\'Watchman\',\'Attender\',\'Attendant\',\'Lab Technician\',\'OfficeStaff\',\'Cleaner\',\'Other\',\'Canteen\',\'Cashier\',\'Librarian\')').get(staffId);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found.' });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Remove staff attendance records
      db.prepare('DELETE FROM staff_attendance WHERE staff_id = ?').run(staffId);
      // 2. Remove notifications
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(staffId);
      // 3. Remove user settings
      db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(staffId);
      // 4. Remove the user account
      db.prepare('DELETE FROM users WHERE id = ?').run(staffId);

      db.exec('COMMIT;');
      res.json({ message: `Staff member '${staff.name}' (${staff.role}) removed successfully.` });
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    console.error('Error deleting staff:', err);
    res.status(500).json({ error: 'Failed to delete staff: ' + err.message });
  }
});

// PUT /api/admin/staff/:id/status - Toggle staff account access
router.put('/staff/:id/status', (req, res) => {
  const staffId = req.params.id;
  const { isActive } = req.body;

  try {
    const staff = db.prepare('SELECT id, name FROM users WHERE id = ?').get(staffId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });

    db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      isActive ? 1 : 0,
      staffId
    );

    res.json({
      message: `Staff member ${staff.name}'s account has been ${isActive ? 'enabled' : 'disabled'}.`,
      isActive: Boolean(isActive)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update staff status: ' + err.message });
  }
});

// ============================================================
// STAFF ATTENDANCE MANAGEMENT
// ============================================================

// GET /api/admin/staff-attendance - View staff attendance (by date, by month, or all)
router.get('/staff-attendance', (req, res) => {
  const { date, month, staffId, role } = req.query;

  let query = `
    SELECT sa.*, u.name as staff_name_current, u.role as staff_role_current
    FROM staff_attendance sa
    JOIN users u ON sa.staff_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (date) {
    query += ' AND sa.date = ?';
    params.push(date);
  } else if (month) {
    query += ' AND sa.date LIKE ?';
    params.push(`${month}%`);
  }

  if (staffId) {
    query += ' AND sa.staff_id = ?';
    params.push(staffId);
  }

  if (role && role !== 'All') {
    query += ' AND sa.staff_role = ?';
    params.push(role);
  }

  query += ' ORDER BY sa.date DESC, sa.staff_name ASC';

  try {
    const records = db.prepare(query).all(...params);
    res.json({ attendance: records });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff attendance: ' + err.message });
  }
});

// POST /api/admin/staff-attendance - Mark/bulk-mark staff attendance
// Body: { records: [{ staffId, date, status, remarks }] } OR single { staffId, date, status, remarks }
router.post('/staff-attendance', (req, res) => {
  const markedBy = req.user.id;
  const markedByName = req.user.name;

  let records = req.body.records;
  if (!records) {
    // Single record form
    const { staffId, date, status, remarks } = req.body;
    if (!staffId || !date || !status) {
      return res.status(400).json({ error: 'staffId, date, and status are required.' });
    }
    records = [{ staffId, date, status, remarks }];
  }

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No attendance records provided.' });
  }

  try {
    const insertOrReplace = db.prepare(`
      INSERT INTO staff_attendance (staff_id, staff_name, staff_role, department, date, status, remarks, marked_by, marked_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(staff_id, date) DO UPDATE SET
        status = excluded.status,
        remarks = excluded.remarks,
        marked_by = excluded.marked_by,
        marked_by_name = excluded.marked_by_name,
        updated_at = CURRENT_TIMESTAMP
    `);

    let markedCount = 0;
    for (const rec of records) {
      const { staffId, date, status, remarks } = rec;
      if (!staffId || !date || !status) continue;

      const staffUser = db.prepare('SELECT id, name, role, department FROM users WHERE id = ?').get(staffId);
      if (!staffUser) continue;

      insertOrReplace.run(
        staffUser.id,
        staffUser.name,
        staffUser.role,
        staffUser.department || null,
        date,
        status,
        remarks || null,
        markedBy,
        markedByName
      );
      markedCount++;
    }

    res.json({ message: `Attendance marked for ${markedCount} staff member(s).`, count: markedCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark attendance: ' + err.message });
  }
});

// PUT /api/admin/staff-attendance/:id - Update a single attendance record
router.put('/staff-attendance/:id', (req, res) => {
  const attId = req.params.id;
  const { status, remarks } = req.body;

  if (!status) return res.status(400).json({ error: 'Status is required.' });

  try {
    const existing = db.prepare('SELECT * FROM staff_attendance WHERE id = ?').get(attId);
    if (!existing) return res.status(404).json({ error: 'Attendance record not found.' });

    db.prepare(`
      UPDATE staff_attendance
      SET status = ?, remarks = COALESCE(?, remarks), marked_by = ?, marked_by_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, remarks || null, req.user.id, req.user.name, attId);

    res.json({ message: 'Attendance record updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update attendance: ' + err.message });
  }
});

// GET /api/admin/staff-attendance/summary - Monthly summary per staff
router.get('/staff-attendance/summary', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month parameter (YYYY-MM) is required.' });

  try {
    const summary = db.prepare(`
      SELECT
        sa.staff_id,
        sa.staff_name,
        sa.staff_role,
        sa.department,
        COUNT(*) as total_days,
        SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN sa.status = 'Absent' THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN sa.status = 'Leave' THEN 1 ELSE 0 END) as leave,
        SUM(CASE WHEN sa.status = 'Half-Day' THEN 1 ELSE 0 END) as half_day
      FROM staff_attendance sa
      WHERE sa.date LIKE ?
      GROUP BY sa.staff_id
      ORDER BY sa.staff_role ASC, sa.staff_name ASC
    `).all(`${month}%`);

    res.json({ summary, month });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attendance summary: ' + err.message });
  }
});

module.exports = router;



