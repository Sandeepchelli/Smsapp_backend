const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'sms.sqlite');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign key constraints
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

function initDatabase() {
  db.exec(`
    -- 1. Users Table (Admin, Teacher, Student, Parent, Cashier, Librarian, Driver, Watchman, Attender, Lab Tech, Canteen, OfficeStaff, Cleaner, Other)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
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
      name TEXT UNIQUE NOT NULL,
      department TEXT NOT NULL,
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
      date TEXT NOT NULL,
      period INTEGER NOT NULL,
      status TEXT NOT NULL,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, subject_id, date, period)
    );

    -- 7. Permission Requests (Leave & Outing)
    CREATE TABLE IF NOT EXISTS permission_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
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
      type TEXT NOT NULL,
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
      grade TEXT NOT NULL,
      grade_points REAL NOT NULL,
      credits INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'PASS',
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
      status TEXT NOT NULL DEFAULT 'ISSUED',
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
      day TEXT NOT NULL,
      period INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      room_no TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, day, period)
    );

    -- 15. Canteen Items Catalog
    CREATE TABLE IF NOT EXISTS canteen_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT NOT NULL DEFAULT 'Main Course',
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
      status TEXT NOT NULL DEFAULT 'Pending',
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

    -- 18. Teacher Attendance Table
    CREATE TABLE IF NOT EXISTS teacher_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      teacher_name TEXT NOT NULL,
      department TEXT,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
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
      theme TEXT DEFAULT 'glassmorphism',
      language TEXT DEFAULT 'en',
      timezone TEXT DEFAULT 'Asia/Kolkata',
      date_format TEXT DEFAULT 'DD-MM-YYYY',
      two_factor_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 20. Staff Attendance Table
    CREATE TABLE IF NOT EXISTS staff_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      staff_name TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      department TEXT,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Present',
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
      type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 22. Staff Salary Ledger
    CREATE TABLE IF NOT EXISTS staff_salaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      monthly_salary REAL NOT NULL DEFAULT 0,
      total_paid REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 23. Salary Payment Transactions
    CREATE TABLE IF NOT EXISTS salary_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      salary_month TEXT NOT NULL,
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

    -- 24. Notices / Announcements
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Normal',
      target_audience TEXT NOT NULL DEFAULT 'All',
      target_user_ids TEXT,
      attachment_url TEXT,
      created_by INTEGER REFERENCES users(id),
      created_by_name TEXT,
      notice_date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 25. Notice Read Status
    CREATE TABLE IF NOT EXISTS notice_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(notice_id, user_id)
    );
  `);

  // Safe schema migrations
  try { db.exec('ALTER TABLE books ADD COLUMN description TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE books ADD COLUMN image_url TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE teacher_attendance ADD COLUMN department TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE students ADD COLUMN relationship TEXT;'); } catch (e) {}
}

initDatabase();

module.exports = db;
