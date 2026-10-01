const assert = require('assert');
const http = require('http');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const cashierRoutes = require('./routes/cashier');
const teacherRoutes = require('./routes/teacher');
const studentRoutes = require('./routes/student');
const parentRoutes = require('./routes/parent');
const notificationRoutes = require('./routes/notifications');
const resultsRoutes = require('./routes/results');
const libraryRoutes = require('./routes/library');
const timetableRoutes = require('./routes/timetable');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cashier', cashierRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/timetable', timetableRoutes);

function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...headers }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function put(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const server = app.listen(5097, async () => {
  console.log('Testing Smart Attendance App - Additional Modules on port 5097...\n');
  try {
    await runTests();
    console.log('\n=============================================================');
    console.log('>>> ALL ADDITIONAL MODULE INTEGRATION TESTS PASSED! <<<');
    console.log('=============================================================\n');
  } catch (err) {
    console.error('\n!!! TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

async function runTests() {
  const BASE_URL = 'http://localhost:5097';

  // 1. Authenticate users
  console.log('1. Authenticating test users...');
  const studentLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'student123', password: 'student123' });
  const studentToken = studentLogin.data.token;

  const parentLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'parent123', password: 'parent123' });
  const parentToken = parentLogin.data.token;

  const teacherLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'ravi123', password: 'teacher123' });
  const teacherToken = teacherLogin.data.token;

  const librarianLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'librarian123', password: 'librarian123' });
  assert.strictEqual(librarianLogin.status, 200);
  assert.strictEqual(librarianLogin.data.user.role, 'Librarian');
  const librarianToken = librarianLogin.data.token;

  const adminLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'admin', password: 'admin123' });
  const adminToken = adminLogin.data.token;
  console.log('   ✓ Student, Parent, Teacher, Librarian, and Admin authenticated.');

  // 2. Test Semester Results Module
  console.log('\n2. Testing Semester Results Module...');
  // Student view
  const myResults = await get(`${BASE_URL}/api/results/my-results`, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(myResults.status, 200);
  assert(myResults.data.semesters.length >= 2, 'Student must have results for Semester 4 and 5');
  console.log(`   ✓ Student Sandeep retrieved semester results. CGPA: ${myResults.data.overallCGPA}`);

  // Parent view
  const wardResults = await get(`${BASE_URL}/api/results/ward-results`, { Authorization: `Bearer ${parentToken}` });
  assert.strictEqual(wardResults.status, 200);
  assert.strictEqual(wardResults.data.ward.student_name, 'Sandeep');
  console.log(`   ✓ Parent Ramesh retrieved ward's results (CGPA: ${wardResults.data.overallCGPA}).`);

  // Teacher view
  const classResults = await get(`${BASE_URL}/api/results/class-results`, { Authorization: `Bearer ${teacherToken}` });
  assert.strictEqual(classResults.status, 200);
  assert(classResults.data.results.length > 0);
  console.log(`   ✓ Teacher Ravi Kumar viewed ${classResults.data.results.length} result entries for assigned sections.`);

  // 3. Test Library Management Module
  console.log('\n3. Testing Library Management Module...');
  // Librarian catalogs new book
  const newBook = await post(`${BASE_URL}/api/library/books`, {
    bookCode: 'BK-TEST-' + Date.now(),
    title: 'Deep Learning & Neural Networks',
    author: 'Ian Goodfellow',
    category: 'Artificial Intelligence',
    totalQty: 4,
    shelfLocation: 'Shelf DL-01'
  }, { Authorization: `Bearer ${librarianToken}` });
  assert.strictEqual(newBook.status, 201);
  const testBookId = newBook.data.bookId;
  console.log(`   ✓ Librarian added book: "Deep Learning & Neural Networks" (Total Qty: 4)`);

  // Librarian issues book to student Sandeep (student_id = 1)
  const issueRes = await post(`${BASE_URL}/api/library/issue`, {
    bookId: testBookId,
    studentId: 1,
    dueDate: '2026-10-10'
  }, { Authorization: `Bearer ${librarianToken}` });
  assert.strictEqual(issueRes.status, 200);
  console.log(`   ✓ Book issued to Sandeep. Due Date: 2026-10-10`);

  // Verify Student sees borrowed book
  const myBooks = await get(`${BASE_URL}/api/library/my-books`, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(myBooks.status, 200);
  const borrowedBook = myBooks.data.activeLoans.find(l => l.book_id === testBookId);
  assert(borrowedBook, 'Student must see issued book in active loans');
  console.log(`   ✓ Student sees active loan: "${borrowedBook.book_title}" (Due: ${borrowedBook.due_date})`);

  // Verify Parent sees ward's borrowed book
  const wardBooks = await get(`${BASE_URL}/api/library/ward-books`, { Authorization: `Bearer ${parentToken}` });
  assert.strictEqual(wardBooks.status, 200);
  assert(wardBooks.data.loans.some(l => l.book_id === testBookId));
  console.log(`   ✓ Parent Ramesh sees ward's borrowed library book.`);

  // Librarian returns book
  const returnRes = await post(`${BASE_URL}/api/library/return`, {
    loanId: borrowedBook.id,
    fineAmount: 0
  }, { Authorization: `Bearer ${librarianToken}` });
  assert.strictEqual(returnRes.status, 200);
  console.log(`   ✓ Book return processed by Librarian.`);

  // 4. Test Teacher Management & Subject Assignment
  console.log('\n4. Testing Teacher Management & Subject Assignment by Admin...');
  const newTeacherUsername = 'suresh_' + Date.now();
  const createTeacherRes = await post(`${BASE_URL}/api/admin/teachers`, {
    name: 'Suresh Menon',
    username: newTeacherUsername,
    password: 'password123',
    employeeId: 'EMP-301',
    department: 'Computer Science & Engineering',
    post: 'Senior Lecturer',
    email: 'suresh.menon@greenwoodit.edu',
    phone: '+91 98765 30101',
    classId: 2, // B.Tech CSE - III Year - Section B
    subjectId: 4 // Computer Networks
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(createTeacherRes.status, 201);
  console.log(`   ✓ Admin created faculty '${newTeacherUsername}' and assigned to Section B for Computer Networks.`);

  // Log in as new teacher and verify assigned subjects are loaded automatically
  const newTeacherLogin = await post(`${BASE_URL}/api/auth/login`, { username: newTeacherUsername, password: 'password123' });
  assert.strictEqual(newTeacherLogin.status, 200);
  const newTeacherAssignments = await get(`${BASE_URL}/api/teacher/assignments`, { Authorization: `Bearer ${newTeacherLogin.data.token}` });
  assert.strictEqual(newTeacherAssignments.status, 200);
  assert(newTeacherAssignments.data.assignments.some(a => a.subject_name === 'Computer Networks'));
  console.log(`   ✓ New teacher logged in and automatically retrieved assigned subject 'Computer Networks'!`);

  // 5. Test Timetable Management
  console.log('\n5. Testing Timetable Management Module...');
  // Student class timetable
  const classTimetable = await get(`${BASE_URL}/api/timetable/my-class`, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(classTimetable.status, 200);
  assert(classTimetable.data.timetable.length > 0);
  console.log(`   ✓ Student retrieved ${classTimetable.data.timetable.length} weekly timetable slots for ${classTimetable.data.classInfo.name}`);

  // Teacher teaching schedule
  const teachingSchedule = await get(`${BASE_URL}/api/timetable/my-teaching`, { Authorization: `Bearer ${teacherToken}` });
  assert.strictEqual(teachingSchedule.status, 200);
  assert(teachingSchedule.data.teachingSchedule.length > 0);
  console.log(`   ✓ Teacher Ravi Kumar retrieved ${teachingSchedule.data.teachingSchedule.length} teaching periods.`);

  // Admin schedules new timetable period
  const newSlot = await post(`${BASE_URL}/api/timetable`, {
    classId: 1,
    subjectId: 1,
    teacherId: 2,
    day: 'Saturday',
    period: 1,
    startTime: '09:00 AM',
    endTime: '09:50 AM',
    roomNo: 'Lab 1'
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(newSlot.status, 201);
  console.log(`   ✓ Admin successfully scheduled new timetable slot for Saturday.`);
}
