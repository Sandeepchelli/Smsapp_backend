const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'sms.sqlite');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign key constraints
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

function initDatabase() {
  db.exec(`
    -- 1. Users Table (Admin, Teacher, Student, Parent, Cashier, Librarian)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL, -- 'Admin', 'Teacher', 'Student', 'Parent', 'Cashier', 'Librarian'
      post TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      employee_id TEXT,
      profile_photo TEXT,
      department TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Classes Table
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL, -- e.g. 'B.Tech CSE - III Year - Section A'
      department TEXT NOT NULL, -- e.g. 'Computer Science & Engineering'
      year INTEGER NOT NULL,
      section TEXT NOT NULL,
      semester INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Subjects Table
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      credits INTEGER DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 4. Teacher Class & Subject Assignments
    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(teacher_id, class_id, subject_id)
    );

    -- 5. Students Table (Linked to User, Class, and Parent)
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      roll_no TEXT NOT NULL,
      department TEXT NOT NULL,
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 6. Period-wise Attendance Table
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      class_name TEXT NOT NULL,
      section TEXT NOT NULL,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      subject_name TEXT NOT NULL,
      teacher_id INTEGER NOT NULL REFERENCES users(id),
      teacher_name TEXT NOT NULL,
      date TEXT NOT NULL, -- YYYY-MM-DD
      period INTEGER NOT NULL, -- 1 to 7
      status TEXT NOT NULL, -- 'Present', 'Absent', 'On Leave'
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, subject_id, date, period)
    );

    -- 7. Permission Requests (Leave & Outing)
    CREATE TABLE IF NOT EXISTS permission_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- 'LEAVE' or 'OUTING'
      date TEXT NOT NULL, -- YYYY-MM-DD
      start_period INTEGER,
      end_period INTEGER,
      leaving_time TEXT,
      expected_return_time TEXT,
      destination TEXT,
      reason TEXT NOT NULL,
      notes TEXT,
      teacher_approval TEXT DEFAULT 'PENDING',
      principal_approval TEXT DEFAULT 'PENDING',
      final_status TEXT DEFAULT 'PENDING',
      teacher_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 8. Notifications Table
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL, -- 'ABSENCE_ALERT', 'LEAVE_STATUS', 'OUTING_STATUS', 'FEE_UPDATE', 'LIBRARY_LOAN', 'GENERAL'
      metadata TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 9. Student Fee Ledgers
    CREATE TABLE IF NOT EXISTS student_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER UNIQUE NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      department TEXT NOT NULL,
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      total_fee REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      pending_amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 10. Fee Payment Transactions History
    CREATE TABLE IF NOT EXISTS fee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      fee_id INTEGER NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      receipt_no TEXT UNIQUE NOT NULL,
      cashier_id INTEGER REFERENCES users(id),
      cashier_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 11. Semester Results Table
    CREATE TABLE IF NOT EXISTS semester_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      semester INTEGER NOT NULL,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      subject_name TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      internal_marks REAL NOT NULL,
      external_marks REAL NOT NULL,
      total_marks REAL NOT NULL,
      grade TEXT NOT NULL, -- 'O' (90+), 'A+' (80-89), 'A' (70-79), 'B+' (60-69), 'B' (50-59), 'RA' (<50)
      grade_points REAL NOT NULL, -- 10, 9, 8, 7, 6, 0
      credits INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'PASS', -- 'PASS' or 'FAIL'
      academic_year TEXT NOT NULL DEFAULT '2025-2026',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, semester, subject_id)
    );

    -- 12. Library Books Table
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      isbn TEXT,
      total_qty INTEGER NOT NULL DEFAULT 1,
      available_qty INTEGER NOT NULL DEFAULT 1,
      borrowed_qty INTEGER NOT NULL DEFAULT 0,
      shelf_location TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 13. Library Book Loans Table
    CREATE TABLE IF NOT EXISTS book_loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      return_date TEXT,
      status TEXT NOT NULL DEFAULT 'ISSUED', -- 'ISSUED', 'RETURNED', 'OVERDUE'
      fine_amount REAL DEFAULT 0,
      issued_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 14. Timetable Management Table
    CREATE TABLE IF NOT EXISTS timetable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL, -- 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
      period INTEGER NOT NULL, -- 1 to 7
      start_time TEXT NOT NULL, -- e.g. '09:00 AM'
      end_time TEXT NOT NULL, -- e.g. '09:50 AM'
      room_no TEXT NOT NULL, -- e.g. 'Hall 304'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, day, period)
    );

    -- 15. Canteen Items Catalog
    CREATE TABLE IF NOT EXISTS canteen_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT NOT NULL DEFAULT 'Main Course', -- 'Breakfast', 'Main Course', 'Snacks', 'Beverages', 'Dessert'
      image_url TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 16. Canteen Orders Table
    CREATE TABLE IF NOT EXISTS canteen_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      class_name TEXT,
      total_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending', -- 'Pending', 'Confirmed', 'Preparing', 'Ready', 'Completed', 'Cancelled'
      payment_mode TEXT NOT NULL DEFAULT 'Cash / Campus Pay',
      order_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 17. Canteen Order Items Table
    CREATE TABLE IF NOT EXISTS canteen_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES canteen_orders(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES canteen_items(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      price_per_item REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL
    );

    -- 18. Teacher Attendance Table (Completely separate from student attendance)
    CREATE TABLE IF NOT EXISTS teacher_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      teacher_name TEXT NOT NULL,
      department TEXT,
      date TEXT NOT NULL, -- YYYY-MM-DD
      status TEXT NOT NULL, -- 'Present', 'Absent', 'Leave', 'Half-Day'
      remarks TEXT,
      marked_by INTEGER REFERENCES users(id),
      marked_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(teacher_id, date)
    );

    -- 19. User Settings Table
    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_alerts INTEGER DEFAULT 1,
      sms_alerts INTEGER DEFAULT 1,
      attendance_alerts INTEGER DEFAULT 1,
      fee_reminders INTEGER DEFAULT 1,
      result_notifications INTEGER DEFAULT 1,
      canteen_updates INTEGER DEFAULT 1,
      theme TEXT DEFAULT 'glassmorphism', -- 'glassmorphism', 'midnight', 'slate', 'light'
      language TEXT DEFAULT 'en', -- 'en', 'hi', 'te', 'ta', 'kn'
      timezone TEXT DEFAULT 'Asia/Kolkata',
      date_format TEXT DEFAULT 'DD-MM-YYYY',
      two_factor_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 20. Staff Attendance Table (for Drivers, Watchmen, Attendants, OfficeStaff, Cleaners, Other)
    CREATE TABLE IF NOT EXISTS staff_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      staff_name TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      department TEXT,
      date TEXT NOT NULL, -- YYYY-MM-DD
      status TEXT NOT NULL DEFAULT 'Present', -- 'Present', 'Absent', 'Leave', 'Half-Day'
      remarks TEXT,
      marked_by INTEGER REFERENCES users(id),
      marked_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(staff_id, date)
    );

    -- 21. Study Materials Table
    CREATE TABLE IF NOT EXISTS study_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      unit TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL, -- 'PDF', 'Notes', 'Video', 'Link', 'Document'
      file_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 22. Staff Salary Ledger (one record per staff member - their fixed monthly salary)
    CREATE TABLE IF NOT EXISTS staff_salaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      monthly_salary REAL NOT NULL DEFAULT 0,
      total_paid REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 23. Salary Payment Transactions (never overwritten - full history)
    CREATE TABLE IF NOT EXISTS salary_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      salary_month TEXT NOT NULL,     -- e.g. '2026-09'
      total_salary REAL NOT NULL,
      amount_paid REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      transaction_ref TEXT,
      notes TEXT,
      cashier_id INTEGER REFERENCES users(id),
      cashier_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 24. Notices / Announcements (from Admin)
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Normal',  -- 'Low', 'Normal', 'High', 'Urgent'
      target_audience TEXT NOT NULL DEFAULT 'All', -- 'All','Teacher','Student','Parent','Cashier','Librarian','Driver','Watchman','Attender','Lab Technician','Canteen','OfficeStaff','Specific'
      target_user_ids TEXT,    -- JSON array of user IDs for 'Specific' targeting
      attachment_url TEXT,
      created_by INTEGER REFERENCES users(id),
      created_by_name TEXT,
      notice_date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 25. Notice Read Status (per user)
    CREATE TABLE IF NOT EXISTS notice_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(notice_id, user_id)
    );
  `);

  // Safe migrations
  try { db.exec('ALTER TABLE books ADD COLUMN description TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE books ADD COLUMN image_url TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE teacher_attendance ADD COLUMN department TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE students ADD COLUMN relationship TEXT;'); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS study_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        unit TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        file_url TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}

  // Seed sample teacher attendance records if table is empty
  try {
    const attCount = db.prepare('SELECT count(*) as count FROM teacher_attendance').get();
    if (attCount.count === 0) {
      console.log('Seeding initial teacher attendance records...');
      const teachers = db.prepare("SELECT id, name, department FROM users WHERE role = 'Teacher'").all();
      const insertAtt = db.prepare(`
        INSERT INTO teacher_attendance (teacher_id, teacher_name, department, date, status, remarks, marked_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, date) DO NOTHING
      `);

      // Generate dates for past 3 days and today
      const today = new Date();
      for (let i = 4; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];

        teachers.forEach((t, idx) => {
          let status = 'Present';
          let remarks = 'On time';
          if (i === 1 && idx === 1) {
            status = 'Leave';
            remarks = 'Approved medical leave';
          } else if (i === 2 && idx === 0) {
            status = 'Half-Day';
            remarks = 'Conference in afternoon session';
          } else if (i === 3 && idx === 2) {
            status = 'Absent';
            remarks = 'Unexcused absence';
          }
          insertAtt.run(t.id, t.name, t.department || 'Academic Faculty', dateStr, status, remarks, 'Principal / Admin Office');
        });
      }
      console.log(`Seeded teacher attendance for ${teachers.length} teachers across 5 days.`);
    }
  } catch (err) {
    console.error('Teacher attendance seed check error:', err);
  }

  // Check if initial seeding is needed
  const checkClasses = db.prepare(`SELECT count(*) as count FROM classes`).get();
  if (checkClasses.count === 0) {
    console.log('Seeding College Relational Database with all academic modules...');

    const defaultHash = bcrypt.hashSync('student123', 10);
    const teacherHash = bcrypt.hashSync('teacher123', 10);
    const adminHash = bcrypt.hashSync('admin123', 10);
    const parentHash = bcrypt.hashSync('parent123', 10);
    const cashierHash = bcrypt.hashSync('cashier123', 10);
    const librarianHash = bcrypt.hashSync('librarian123', 10);

    const insertUser = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. Admin / Principal
    const adminRes = insertUser.run(
      'Dr. K. S. Sharma',
      'admin',
      adminHash,
      'Admin',
      'Principal & Head of Institution',
      'principal@greenwoodit.edu',
      '+91 98765 00001',
      'PRIN-001',
      'Administration',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'
    );
    const adminId = adminRes.lastInsertRowid;

    // 2. Teacher: Ravi Kumar
    const teacherRes = insertUser.run(
      'Ravi Kumar',
      'ravi123',
      teacherHash,
      'Teacher',
      'Associate Professor (CSE)',
      'ravi.kumar@greenwoodit.edu',
      '+91 98765 00002',
      'EMP-201',
      'Computer Science & Engineering',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'
    );
    const raviTeacherId = teacherRes.lastInsertRowid;

    // Additional Teacher: Dr. Ananya Sen
    const teacher2Res = insertUser.run(
      'Dr. Ananya Sen',
      'ananya123',
      teacherHash,
      'Teacher',
      'Professor (CSE)',
      'ananya.sen@greenwoodit.edu',
      '+91 98765 00003',
      'EMP-202',
      'Computer Science & Engineering',
      'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150'
    );
    const ananyaTeacherId = teacher2Res.lastInsertRowid;

    // 3. Parents: Ramesh
    const rameshRes = insertUser.run(
      'Ramesh',
      'parent123',
      parentHash,
      'Parent',
      'Father & Guardian of Sandeep',
      'ramesh.parent@gmail.com',
      '+91 98765 43210',
      null,
      null,
      null
    );
    const rameshParentId = rameshRes.lastInsertRowid;

    // Suresh (Parent of Ravi S)
    const sureshRes = insertUser.run(
      'Suresh Sharma',
      'suresh_p',
      parentHash,
      'Parent',
      'Father of Ravi Sharma',
      'suresh.sharma@gmail.com',
      '+91 98765 43211',
      null,
      null,
      null
    );

    // 4. Cashier: Priya
    const cashierRes = insertUser.run(
      'Priya',
      'cashier123',
      cashierHash,
      'Cashier',
      'Accounts Officer & Senior Cashier',
      'priya.cashier@greenwoodit.edu',
      '+91 98765 00005',
      'ACC-101',
      'Accounts & Treasury',
      null
    );
    const cashierId = cashierRes.lastInsertRowid;

    // 5. Librarian: Mrs. Shanti Verma
    const librarianRes = insertUser.run(
      'Mrs. Shanti Verma',
      'librarian123',
      librarianHash,
      'Librarian',
      'Chief Librarian & Information Officer',
      'shanti.library@greenwoodit.edu',
      '+91 98765 00006',
      'LIB-001',
      'Central Library',
      'https://images.unsplash.com/photo-1580894732444-8ecded7900cd?w=150'
    );
    const librarianId = librarianRes.lastInsertRowid;

    // 6. Classes
    const insertClass = db.prepare(`
      INSERT INTO classes (name, department, year, section, semester)
      VALUES (?, ?, ?, ?, ?)
    `);

    const classARes = insertClass.run(
      'B.Tech CSE - III Year - Section A',
      'Computer Science & Engineering',
      3,
      'A',
      5
    );
    const classAId = classARes.lastInsertRowid;

    const classBRes = insertClass.run(
      'B.Tech CSE - III Year - Section B',
      'Computer Science & Engineering',
      3,
      'B',
      5
    );
    const classBId = classBRes.lastInsertRowid;

    const classCRes = insertClass.run(
      'B.Tech AI&DS - II Year - Section A',
      'Artificial Intelligence & Data Science',
      2,
      'A',
      3
    );

    // 7. Subjects
    const insertSubject = db.prepare(`
      INSERT INTO subjects (code, name, department, credits)
      VALUES (?, ?, ?, ?)
    `);

    const subMLRes = insertSubject.run('CS301', 'Machine Learning', 'Computer Science & Engineering', 4);
    const subMLId = subMLRes.lastInsertRowid;

    const subOSRes = insertSubject.run('CS302', 'Operating Systems', 'Computer Science & Engineering', 4);
    const subOSId = subOSRes.lastInsertRowid;

    const subCCRes = insertSubject.run('CS303', 'Cloud Computing', 'Computer Science & Engineering', 3);
    const subCCId = subCCRes.lastInsertRowid;

    const subCNRes = insertSubject.run('CS304', 'Computer Networks', 'Computer Science & Engineering', 3);
    const subCNId = subCNRes.lastInsertRowid;

    const subDBMSRes = insertSubject.run('CS305', 'Database Management Systems', 'Computer Science & Engineering', 4);
    const subDBMSId = subDBMSRes.lastInsertRowid;

    // 8. Teacher Assignments
    const insertAssignment = db.prepare(`
      INSERT INTO teacher_assignments (teacher_id, class_id, subject_id)
      VALUES (?, ?, ?)
    `);
    insertAssignment.run(raviTeacherId, classAId, subMLId);
    insertAssignment.run(raviTeacherId, classAId, subCCId);
    insertAssignment.run(raviTeacherId, classBId, subMLId);
    insertAssignment.run(ananyaTeacherId, classAId, subOSId);
    insertAssignment.run(ananyaTeacherId, classAId, subCNId);

    // 9. Students in Class A
    const insertStudentUser = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone)
      VALUES (?, ?, ?, 'Student', ?, ?, ?)
    `);

    const insertStudent = db.prepare(`
      INSERT INTO students (user_id, class_id, parent_id, roll_no, department, year, semester)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFee = db.prepare(`
      INSERT INTO student_fees (student_id, department, year, semester, total_fee, paid_amount, pending_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPayment = db.prepare(`
      INSERT INTO fee_payments (student_id, fee_id, amount, payment_date, payment_method, receipt_no, cashier_id, cashier_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Student 1: Sandeep
    const uSandeep = insertStudentUser.run('Sandeep', 'student123', defaultHash, 'Class: B.Tech CSE III-A (Roll: 101)', 'sandeep@student.greenwoodit.edu', '+91 98765 10101');
    const sSandeep = insertStudent.run(uSandeep.lastInsertRowid, classAId, rameshParentId, '101', 'Computer Science & Engineering', 3, 5);
    const sandeepStudentId = sSandeep.lastInsertRowid;

    const feeSandeep = insertFee.run(sandeepStudentId, 'Computer Science & Engineering', 3, 5, 80000, 50000, 30000);
    const feeSandeepId = feeSandeep.lastInsertRowid;

    insertPayment.run(sandeepStudentId, feeSandeepId, 20000, '2026-07-15', 'Net Banking', 'REC-2026-0715', cashierId, 'Priya (Cashier)');
    insertPayment.run(sandeepStudentId, feeSandeepId, 20000, '2026-08-10', 'UPI', 'REC-2026-0810', cashierId, 'Priya (Cashier)');
    insertPayment.run(sandeepStudentId, feeSandeepId, 10000, '2026-08-20', 'Cash', 'REC-2026-0820', cashierId, 'Priya (Cashier)');

    // Student 2: Ravi
    const uRavi = insertStudentUser.run('Ravi', 'ravi_s', defaultHash, 'Class: B.Tech CSE III-A (Roll: 102)', 'ravi.s@student.greenwoodit.edu', '+91 98765 10102');
    const sRavi = insertStudent.run(uRavi.lastInsertRowid, classAId, sureshRes.lastInsertRowid, '102', 'Computer Science & Engineering', 3, 5);
    insertFee.run(sRavi.lastInsertRowid, 'Computer Science & Engineering', 3, 5, 80000, 80000, 0);

    // Student 3: Kiran
    const uKiran = insertStudentUser.run('Kiran', 'kiran_s', defaultHash, 'Class: B.Tech CSE III-A (Roll: 103)', 'kiran@student.greenwoodit.edu', '+91 98765 10103');
    const sKiran = insertStudent.run(uKiran.lastInsertRowid, classAId, null, '103', 'Computer Science & Engineering', 3, 5);
    insertFee.run(sKiran.lastInsertRowid, 'Computer Science & Engineering', 3, 5, 80000, 40000, 40000);

    // Student 4: Priya
    const uPriya = insertStudentUser.run('Priya', 'priya_s', defaultHash, 'Class: B.Tech CSE III-A (Roll: 104)', 'priya.s@student.greenwoodit.edu', '+91 98765 10104');
    const sPriya = insertStudent.run(uPriya.lastInsertRowid, classAId, null, '104', 'Computer Science & Engineering', 3, 5);
    insertFee.run(sPriya.lastInsertRowid, 'Computer Science & Engineering', 3, 5, 80000, 60000, 20000);

    // Student 5: Anjali
    const uAnjali = insertStudentUser.run('Anjali', 'anjali_s', defaultHash, 'Class: B.Tech CSE III-A (Roll: 105)', 'anjali@student.greenwoodit.edu', '+91 98765 10105');
    const sAnjali = insertStudent.run(uAnjali.lastInsertRowid, classAId, null, '105', 'Computer Science & Engineering', 3, 5);
    insertFee.run(sAnjali.lastInsertRowid, 'Computer Science & Engineering', 3, 5, 80000, 80000, 0);

    // Student 6: Rahul
    const uRahul = insertStudentUser.run('Rahul', 'rahul_s', defaultHash, 'Class: B.Tech CSE III-A (Roll: 106)', 'rahul@student.greenwoodit.edu', '+91 98765 10106');
    const sRahul = insertStudent.run(uRahul.lastInsertRowid, classAId, null, '106', 'Computer Science & Engineering', 3, 5);
    insertFee.run(sRahul.lastInsertRowid, 'Computer Science & Engineering', 3, 5, 80000, 25000, 55000);

    // Student in Class B
    const uVikram = insertStudentUser.run('Vikram Rao', 'vikram_b', defaultHash, 'Class: B.Tech CSE III-B (Roll: 201)', 'vikram@student.greenwoodit.edu', '+91 98765 10201');
    insertStudent.run(uVikram.lastInsertRowid, classBId, null, '201', 'Computer Science & Engineering', 3, 5);

    // 10. Seed Semester Results (Semester 4 & 5 for Sandeep)
    const insertResult = db.prepare(`
      INSERT INTO semester_results (
        student_id, semester, subject_id, subject_name, subject_code,
        internal_marks, external_marks, total_marks, grade, grade_points, credits, status, academic_year
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Semester 4 (Completed)
    insertResult.run(sandeepStudentId, 4, subDBMSId, 'Database Management Systems', 'CS305', 28, 64, 92, 'O', 10, 4, 'PASS', '2025-2026');
    insertResult.run(sandeepStudentId, 4, subOSId, 'Operating Systems', 'CS302', 26, 61, 87, 'A+', 9, 4, 'PASS', '2025-2026');
    insertResult.run(sandeepStudentId, 4, subCNId, 'Computer Networks', 'CS304', 27, 58, 85, 'A+', 9, 3, 'PASS', '2025-2026');

    // Semester 5 (Mid-Term / Published Results)
    insertResult.run(sandeepStudentId, 5, subMLId, 'Machine Learning', 'CS301', 29, 65, 94, 'O', 10, 4, 'PASS', '2025-2026');
    insertResult.run(sandeepStudentId, 5, subCCId, 'Cloud Computing', 'CS303', 27, 61, 88, 'A+', 9, 3, 'PASS', '2025-2026');

    // Also results for Ravi (Roll 102)
    insertResult.run(sRavi.lastInsertRowid, 5, subMLId, 'Machine Learning', 'CS301', 25, 55, 80, 'A+', 9, 4, 'PASS', '2025-2026');

    // 11. Seed Library Books
    const insertBook = db.prepare(`
      INSERT INTO books (book_code, title, author, category, isbn, total_qty, available_qty, borrowed_qty, shelf_location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const b1 = insertBook.run('BK-1001', 'Pattern Recognition and Machine Learning', 'Christopher M. Bishop', 'Artificial Intelligence', '978-0387310732', 5, 4, 1, 'Shelf AI-03');
    const b2 = insertBook.run('BK-1002', 'Operating System Concepts (10th Ed)', 'Abraham Silberschatz', 'Computer Science', '978-1118063330', 8, 8, 0, 'Shelf CS-01');
    const b3 = insertBook.run('BK-1003', 'Computer Networks: A Systems Approach', 'Larry L. Peterson', 'Networking', '978-0123850591', 6, 5, 1, 'Shelf NET-04');
    const b4 = insertBook.run('BK-1004', 'Cloud Computing: Concepts, Technology & Architecture', 'Thomas Erl', 'Cloud & Systems', '978-0133387520', 4, 4, 0, 'Shelf CLOUD-02');
    const b5 = insertBook.run('BK-1005', 'Clean Architecture: A Craftsman Guide', 'Robert C. Martin', 'Software Engineering', '978-0134494166', 7, 7, 0, 'Shelf SE-05');

    // 12. Seed Active Book Loans for Sandeep
    const insertLoan = db.prepare(`
      INSERT INTO book_loans (book_id, student_id, issue_date, due_date, return_date, status, fine_amount, issued_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLoan.run(b1.lastInsertRowid, sandeepStudentId, '2026-09-10', '2026-09-25', null, 'ISSUED', 0, librarianId);
    insertLoan.run(b3.lastInsertRowid, sRavi.lastInsertRowid, '2026-09-08', '2026-09-23', null, 'ISSUED', 0, librarianId);

    // 13. Seed Weekly Timetable for Class A (B.Tech CSE - III Year - Section A)
    const insertTimetable = db.prepare(`
      INSERT INTO timetable (class_id, subject_id, teacher_id, day, period, start_time, end_time, room_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const timeSlots = [
      { p: 1, start: '09:00 AM', end: '09:50 AM' },
      { p: 2, start: '09:55 AM', end: '10:45 AM' },
      { p: 3, start: '11:00 AM', end: '11:50 AM' },
      { p: 4, start: '11:55 AM', end: '12:45 PM' },
      { p: 5, start: '01:30 PM', end: '02:20 PM' },
      { p: 6, start: '02:25 PM', end: '03:15 PM' },
      { p: 7, start: '03:20 PM', end: '04:10 PM' }
    ];

    // Monday
    insertTimetable.run(classAId, subMLId, raviTeacherId, 'Monday', 1, '09:00 AM', '09:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subMLId, raviTeacherId, 'Monday', 2, '09:55 AM', '10:45 AM', 'Hall 304');
    insertTimetable.run(classAId, subOSId, ananyaTeacherId, 'Monday', 3, '11:00 AM', '11:50 AM', 'Lab 2');
    insertTimetable.run(classAId, subCCId, raviTeacherId, 'Monday', 4, '11:55 AM', '12:45 PM', 'Hall 304');
    insertTimetable.run(classAId, subCNId, ananyaTeacherId, 'Monday', 5, '01:30 PM', '02:20 PM', 'Hall 304');

    // Tuesday
    insertTimetable.run(classAId, subOSId, ananyaTeacherId, 'Tuesday', 1, '09:00 AM', '09:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subMLId, raviTeacherId, 'Tuesday', 2, '09:55 AM', '10:45 AM', 'Hall 304');
    insertTimetable.run(classAId, subCCId, raviTeacherId, 'Tuesday', 3, '11:00 AM', '11:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subCNId, ananyaTeacherId, 'Tuesday', 4, '11:55 AM', '12:45 PM', 'Hall 304');
    insertTimetable.run(classAId, subMLId, raviTeacherId, 'Tuesday', 5, '01:30 PM', '02:20 PM', 'Lab 1');

    // Wednesday
    insertTimetable.run(classAId, subCNId, ananyaTeacherId, 'Wednesday', 1, '09:00 AM', '09:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subOSId, ananyaTeacherId, 'Wednesday', 2, '09:55 AM', '10:45 AM', 'Hall 304');
    insertTimetable.run(classAId, subMLId, raviTeacherId, 'Wednesday', 3, '11:00 AM', '11:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subCCId, raviTeacherId, 'Wednesday', 4, '11:55 AM', '12:45 PM', 'Lab 3');

    // Thursday
    insertTimetable.run(classAId, subCCId, raviTeacherId, 'Thursday', 1, '09:00 AM', '09:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subMLId, raviTeacherId, 'Thursday', 2, '09:55 AM', '10:45 AM', 'Hall 304');
    insertTimetable.run(classAId, subOSId, ananyaTeacherId, 'Thursday', 3, '11:00 AM', '11:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subCNId, ananyaTeacherId, 'Thursday', 4, '11:55 AM', '12:45 PM', 'Hall 304');

    // Friday
    insertTimetable.run(classAId, subMLId, raviTeacherId, 'Friday', 1, '09:00 AM', '09:50 AM', 'Hall 304');
    insertTimetable.run(classAId, subCNId, ananyaTeacherId, 'Friday', 2, '09:55 AM', '10:45 AM', 'Hall 304');
    insertTimetable.run(classAId, subOSId, ananyaTeacherId, 'Friday', 3, '11:00 AM', '11:50 AM', 'Hall 304');
    console.log('Seeded All Extended Modules Successfully!');
  }

  // Ensure Canteen Staff user exists
  const checkCanteenStaff = db.prepare("SELECT id FROM users WHERE username = 'canteen123'").get();
  if (!checkCanteenStaff) {
    const canteenHash = bcrypt.hashSync('canteen123', 10);
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo)
      VALUES (?, ?, ?, 'Canteen', 'Canteen Incharge', 'canteen@greenwoodit.edu', '+91 98765 00006', 'CAN-001', 'Campus Hospitality', 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=150')
    `).run('Chef Rajesh Varma', 'canteen123', canteenHash);
    console.log('Seeded Canteen Staff user: canteen123');
  }

  // Ensure Canteen Food Items exist
  const checkCanteenItems = db.prepare("SELECT count(*) as count FROM canteen_items").get();
  if (checkCanteenItems.count === 0) {
    const insertItem = db.prepare(`
      INSERT INTO canteen_items (name, description, price, category, image_url, is_available)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertItem.run('Veg Fried Rice', 'Aromatic wok-tossed basmati rice with crunchy seasonal vegetables and light soy seasoning.', 80, 'Main Course', 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400', 1);
    insertItem.run('Paneer Butter Masala Combo', 'Rich tomato-cashew curry served with 2 freshly made butter naans & salad.', 120, 'Main Course', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400', 1);
    insertItem.run('Special Hyderabadi Biryani', 'Fragrant spiced layered rice cooked with marinated herbs, served with raita and mirchi ka salan.', 150, 'Main Course', 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400', 1);
    insertItem.run('South Indian Masala Dosa', 'Golden crispy fermented crepe filled with spiced potato masala, served with coconut chutney & sambar.', 50, 'Breakfast', 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=400', 1);
    insertItem.run('Crispy Veg Burger', 'Herb potato patty topped with lettuce, sliced tomatoes, creamy mayo in a toasted sesame bun.', 60, 'Snacks', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400', 1);
    insertItem.run('Grilled Club Sandwich', 'Triple decker toast with cucumber, cheese, spiced tomatoes and mint spread.', 45, 'Snacks', 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400', 1);
    insertItem.run('Hot Samosa & Chutney (2 pcs)', 'Flaky golden pastry cones stuffed with spiced peas and potatoes with tangy tamarind chutney.', 20, 'Snacks', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400', 1);
    insertItem.run('Cold Coffee with Ice Cream', 'Creamy chilled espresso blended with dairy milk and a scoop of vanilla ice cream.', 40, 'Beverages', 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=400', 1);
    insertItem.run('Fresh Lime Soda', 'Refreshing sparkling water infused with freshly squeezed lime and sweet-salted herbs.', 30, 'Beverages', 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=400', 1);
    insertItem.run('Warm Gulab Jamun (2 pcs)', 'Soft milk solid dumplings soaked in cardamom flavored saffron sugar syrup.', 35, 'Dessert', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400', 1);

    console.log('Seeded 10 Canteen Menu Items successfully!');

    // Seed a sample order for student Sandeep
    const studentSandeep = db.prepare("SELECT id FROM students WHERE roll_no = '101'").get();
    if (studentSandeep) {
      const sampleOrder = db.prepare(`
        INSERT INTO canteen_orders (order_number, student_id, student_name, class_name, total_amount, status, payment_mode, order_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'ORD-2026-901',
        studentSandeep.id,
        'Sandeep',
        'B.Tech CSE - III Year - Section A',
        160,
        'Preparing',
        'Campus Card',
        'Extra spicy for Fried Rice'
      );

      const orderId = sampleOrder.lastInsertRowid;
      db.prepare(`
        INSERT INTO canteen_order_items (order_id, item_id, item_name, price_per_item, quantity, subtotal)
        VALUES (?, 1, 'Veg Fried Rice', 80, 2, 160)
      `).run(orderId);
    }
  }

  // Ensure Driver account exists
  const checkDriver = db.prepare("SELECT id FROM users WHERE username = 'driver123'").get();
  if (!checkDriver) {
    const driverHash = bcrypt.hashSync('driver123', 10);
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo, is_active)
      VALUES (?, ?, ?, 'Driver', 'Senior Transport Driver', 'driver@greenwoodit.edu', '+91 98765 00007', 'DRV-001', 'Transport & Fleet', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=150', 1)
    `).run('Ramesh Singh', 'driver123', driverHash);
    console.log('Seeded Driver user: driver123');
  }

  // Ensure Watchman / Security account exists
  const checkWatchman = db.prepare("SELECT id FROM users WHERE username = 'watchman123'").get();
  if (!checkWatchman) {
    const watchmanHash = bcrypt.hashSync('watchman123', 10);
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo, is_active)
      VALUES (?, ?, ?, 'Watchman', 'Campus Chief Security Guard', 'security@greenwoodit.edu', '+91 98765 00008', 'SEC-001', 'Campus Security', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150', 1)
    `).run('Bahadur Thapa', 'watchman123', watchmanHash);
    console.log('Seeded Watchman user: watchman123');
  }

  // Ensure Attender account exists
  const checkAttender = db.prepare("SELECT id FROM users WHERE username = 'attender123'").get();
  if (!checkAttender) {
    const attenderHash = bcrypt.hashSync('attender123', 10);
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo, is_active)
      VALUES (?, ?, ?, 'Attender', 'Academic Floor Attender', 'attender@greenwoodit.edu', '+91 98765 00009', 'ATT-001', 'Campus Maintenance', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 1)
    `).run('Gopal Verma', 'attender123', attenderHash);
    console.log('Seeded Attender user: attender123');
  }

  // Ensure Lab Technician account exists
  const checkLabTech = db.prepare("SELECT id FROM users WHERE username = 'labtech123'").get();
  if (!checkLabTech) {
    const labTechHash = bcrypt.hashSync('labtech123', 10);
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, profile_photo, is_active)
      VALUES (?, ?, ?, 'Lab Technician', 'Senior Systems & Hardware Lab Technician', 'labtech@greenwoodit.edu', '+91 98765 00010', 'LAB-001', 'Computer Laboratories', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150', 1)
    `).run('Suresh Reddy', 'labtech123', labTechHash);
    console.log('Seeded Lab Technician user: labtech123');
  }

  // Ensure Demo Student student123 exists
  const checkStudent123 = db.prepare("SELECT id FROM users WHERE username = 'student123'").get();
  if (!checkStudent123) {
    const studentHash = bcrypt.hashSync('student123', 10);
    const sUser = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, department, profile_photo, is_active)
      VALUES (?, ?, ?, 'Student', 'Student (CSE)', 'student@greenwoodit.edu', '+91 98765 00004', 'Computer Science & Engineering', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150', 1)
    `).run('Sandeep (Demo Student)', 'student123', studentHash);
    const classA = db.prepare("SELECT id FROM classes LIMIT 1").get();
    if (classA) {
      db.prepare(`
        INSERT INTO students (user_id, class_id, roll_no, department, year, semester)
        VALUES (?, ?, '101', 'Computer Science & Engineering', 3, 5)
      `).run(sUser.lastInsertRowid, classA.id);
    }
    console.log('Seeded Student user: student123');
  }

  // Ensure Demo Parent parent123 exists
  const checkParent123 = db.prepare("SELECT id FROM users WHERE username = 'parent123'").get();
  if (!checkParent123) {
    const parentHash = bcrypt.hashSync('parent123', 10);
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, department, profile_photo, is_active)
      VALUES (?, ?, ?, 'Parent', 'Father / Guardian', 'parent@greenwoodit.edu', '+91 98765 00005', 'Guardian', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 1)
    `).run('Ramesh (Demo Parent)', 'parent123', parentHash);
    console.log('Seeded Parent user: parent123');
  }

  // Seed initial staff attendance if empty
  try {
    const staffAttCount = db.prepare('SELECT count(*) as count FROM staff_attendance').get();
    if (staffAttCount.count === 0) {
      const staffMembers = db.prepare(`
        SELECT id, name, role, department FROM users
        WHERE role IN ('Driver', 'Watchman', 'Attender', 'Attendant', 'Lab Technician', 'OfficeStaff', 'Cleaner', 'Other')
      `).all();

      if (staffMembers.length > 0) {
        console.log(`Seeding initial staff attendance for ${staffMembers.length} staff members...`);
        const insertStaffAtt = db.prepare(`
          INSERT INTO staff_attendance (staff_id, staff_name, staff_role, department, date, status, remarks, marked_by_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(staff_id, date) DO NOTHING
        `);

        const today = new Date();
        for (let i = 4; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];

          staffMembers.forEach((s, idx) => {
            let status = 'Present';
            let remarks = 'On duty';
            if (i === 1 && idx === 1) {
              status = 'Half-Day';
              remarks = 'Shift adjustment';
            } else if (i === 2 && idx === 2) {
              status = 'Leave';
              remarks = 'Permission granted';
            }
            insertStaffAtt.run(s.id, s.name, s.role, s.department || 'Campus Facilities', dateStr, status, remarks, 'Principal / Admin Office');
          });
        }
        console.log('Seeded staff attendance records successfully.');
      }
    }
  } catch (err) {
    console.error('Staff attendance seed error:', err);
  }
}


initDatabase();

module.exports = db;
