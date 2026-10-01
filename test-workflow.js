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

const server = app.listen(5098, async () => {
  console.log('Testing Smart Attendance App - Advanced College Workflow on port 5098...\n');
  try {
    await runWorkflowTests();
    console.log('\n=============================================================');
    console.log('>>> ALL 16 ADVANCED COLLEGE WORKFLOW TESTS PASSED! <<<');
    console.log('=============================================================\n');
  } catch (err) {
    console.error('\n!!! WORKFLOW TESTS FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

async function runWorkflowTests() {
  const BASE_URL = 'http://localhost:5098';

  // 1. Log in all roles
  console.log('1. Authenticating test users...');
  const teacherLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'ravi123', password: 'teacher123' });
  assert.strictEqual(teacherLogin.status, 200);
  const teacherToken = teacherLogin.data.token;

  const studentLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'student123', password: 'student123' });
  assert.strictEqual(studentLogin.status, 200);
  const studentToken = studentLogin.data.token;

  const parentLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'parent123', password: 'parent123' });
  assert.strictEqual(parentLogin.status, 200);
  const parentToken = parentLogin.data.token;

  const adminLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'admin', password: 'admin123' });
  assert.strictEqual(adminLogin.status, 200);
  const adminToken = adminLogin.data.token;

  const cashierLogin = await post(`${BASE_URL}/api/auth/login`, { username: 'cashier123', password: 'cashier123' });
  assert.strictEqual(cashierLogin.status, 200);
  const cashierToken = cashierLogin.data.token;
  console.log('   ✓ All 5 roles authenticated successfully via common login endpoint.');

  // 2. Teacher Assigned Classes & Student Roster
  console.log('\n2. Testing Teacher Assigned Classes and Student Roster...');
  const assignRes = await get(`${BASE_URL}/api/teacher/assignments`, { Authorization: `Bearer ${teacherToken}` });
  assert.strictEqual(assignRes.status, 200);
  assert(assignRes.data.assignments.length > 0);
  const assignment = assignRes.data.assignments[0];
  console.log(`   ✓ Teacher Ravi Kumar assigned to: ${assignment.class_name} for ${assignment.subject_name}`);

  // Fetch students for this class
  const classStudentsRes = await get(`${BASE_URL}/api/teacher/class-students?classId=${assignment.class_id}&subjectId=${assignment.subject_id}&date=2026-09-20&period=2`, {
    Authorization: `Bearer ${teacherToken}`
  });
  assert.strictEqual(classStudentsRes.status, 200);
  const students = classStudentsRes.data.students;
  console.log(`   ✓ Found ${students.length} students assigned to ${assignment.class_name}:`);
  students.forEach(s => console.log(`      - Roll ${s.roll_no}: ${s.student_name} (Parent: ${s.parent_name || 'None'})`));

  // Verify Sandeep is present and Vikram Rao (Section B) is NOT present in Section A list
  const hasSandeep = students.some(s => s.student_name === 'Sandeep');
  const hasVikram = students.some(s => s.student_name === 'Vikram Rao');
  assert.strictEqual(hasSandeep, true, 'Sandeep must be in Section A');
  assert.strictEqual(hasVikram, false, 'Vikram Rao from Section B must NOT be in Section A');
  console.log('   ✓ Class boundary strictly enforced (Zero unrelated students).');

  // 3. Attendance Taking & Automatic Parent Notification
  console.log('\n3. Testing Attendance Taking & Automatic Parent Absence Alert...');
  const sandeep = students.find(s => s.student_name === 'Sandeep');
  const attendancePayload = {
    classId: assignment.class_id,
    subjectId: assignment.subject_id,
    date: '2026-09-20',
    period: 2,
    attendanceList: [
      { studentId: sandeep.student_id, status: 'Absent', remarks: 'Unexcused absence' },
      ...students.filter(s => s.student_id !== sandeep.student_id).map(s => ({ studentId: s.student_id, status: 'Present', remarks: 'Present' }))
    ]
  };

  const attRes = await post(`${BASE_URL}/api/teacher/attendance`, attendancePayload, { Authorization: `Bearer ${teacherToken}` });
  assert.strictEqual(attRes.status, 200);
  console.log(`   ✓ Attendance saved for Period 2. Notification dispatched: ${attRes.data.notificationsSent}`);

  // Verify Parent Ramesh received the notification
  const parentNotifs = await get(`${BASE_URL}/api/notifications`, { Authorization: `Bearer ${parentToken}` });
  assert.strictEqual(parentNotifs.status, 200);
  const absenceAlert = parentNotifs.data.notifications.find(n => n.type === 'ABSENCE_ALERT');
  assert(absenceAlert, 'Parent must have received ABSENCE_ALERT notification');
  console.log(`   ✓ Parent Ramesh received alert: "${absenceAlert.title}"`);
  console.log(`     Details:\n${absenceAlert.message}`);

  // 4. Student Leave Request & Multi-Level Approval
  console.log('\n4. Testing Student Leave Request & Multi-Tier Approval Workflow...');
  const leaveReq = await post(`${BASE_URL}/api/student/leave-request`, {
    date: '2026-09-20',
    startPeriod: 3,
    endPeriod: 3,
    reason: 'Family Emergency & Medical Appointment',
    notes: 'Doctor consultation at 11 AM'
  }, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(leaveReq.status, 201);
  const leaveId = leaveReq.data.requestId;
  console.log(`   ✓ Student Sandeep submitted leave request #${leaveId} for Period 3`);

  // Teacher Review
  const teacherPerms = await get(`${BASE_URL}/api/teacher/permissions`, { Authorization: `Bearer ${teacherToken}` });
  const pendingLeave = teacherPerms.data.requests.find(r => r.id === leaveId);
  assert(pendingLeave, 'Teacher must see pending leave request');
  console.log(`   ✓ Teacher sees pending request from ${pendingLeave.student_name}: "${pendingLeave.reason}"`);

  // Teacher accepts
  const teachApprove = await put(`${BASE_URL}/api/teacher/permissions/${leaveId}`, { action: 'ACCEPT', comments: 'Medical reason verified.' }, { Authorization: `Bearer ${teacherToken}` });
  assert.strictEqual(teachApprove.status, 200);
  assert.strictEqual(teachApprove.data.finalStatus, 'TEACHER_APPROVED');
  console.log('   ✓ Teacher accepted. Status advanced to TEACHER_APPROVED.');

  // Principal Final Approval
  const adminApprove = await put(`${BASE_URL}/api/admin/permissions/${leaveId}`, { action: 'ACCEPT', comments: 'Approved by Principal' }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(adminApprove.status, 200);
  assert.strictEqual(adminApprove.data.finalStatus, 'APPROVED');
  console.log('   ✓ Principal granted final approval. Final Status: PERMISSION GRANTED (APPROVED).');

  // 5. Approved Leave Suppresses Unnecessary Absence Alert
  console.log('\n5. Testing that Approved Leave Suppresses Unnecessary Absence Alert...');
  // Now teacher marks attendance for Period 3 where Sandeep has APPROVED leave
  const period3Payload = {
    classId: assignment.class_id,
    subjectId: assignment.subject_id,
    date: '2026-09-20',
    period: 3,
    attendanceList: [
      { studentId: sandeep.student_id, status: 'Absent', remarks: '' }
    ]
  };

  const att3Res = await post(`${BASE_URL}/api/teacher/attendance`, period3Payload, { Authorization: `Bearer ${teacherToken}` });
  assert.strictEqual(att3Res.status, 200);
  // Verify that NO new absence alert was generated because student is on approved leave!
  assert.strictEqual(att3Res.data.notificationsSent, 0, 'No absence alert should be sent for approved leave');
  console.log('   ✓ Success! Attendance correctly handled as "On Leave"; zero false absence alerts sent to parent.');

  // 6. Outing Permission Workflow
  console.log('\n6. Testing Outing Permission Workflow...');
  const outingReq = await post(`${BASE_URL}/api/student/outing-request`, {
    date: '2026-09-21',
    leavingTime: '02:00 PM',
    expectedReturnTime: '05:00 PM',
    destination: 'City Library',
    reason: 'Project Research Work'
  }, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(outingReq.status, 201);
  const outingId = outingReq.data.requestId;
  console.log(`   ✓ Outing request #${outingId} submitted by student.`);

  // Teacher approves outing
  await put(`${BASE_URL}/api/teacher/permissions/${outingId}`, { action: 'ACCEPT' }, { Authorization: `Bearer ${teacherToken}` });
  // Principal approves outing
  const finalOuting = await put(`${BASE_URL}/api/admin/permissions/${outingId}`, { action: 'ACCEPT' }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(finalOuting.data.finalStatus, 'APPROVED');
  console.log('   ✓ Outing request approved by Teacher and Principal -> PERMISSION GRANTED.');

  // 7. Cashier Fee Management & Payment Ledger
  console.log('\n7. Testing Cashier Fee Management, Automatic Calculation & Ledger...');
  // Cashier searches student Sandeep
  const searchStudentRes = await get(`${BASE_URL}/api/cashier/students?search=Sandeep`, { Authorization: `Bearer ${cashierToken}` });
  assert.strictEqual(searchStudentRes.status, 200);
  const sandeepFeeSummary = searchStudentRes.data.students[0];
  console.log(`   ✓ Cashier found student: ${sandeepFeeSummary.student_name} (${sandeepFeeSummary.class_name})`);
  console.log(`     Total Fee: ₹${sandeepFeeSummary.total_fee} | Paid: ₹${sandeepFeeSummary.paid_amount} | Pending: ₹${sandeepFeeSummary.pending_amount}`);
  assert.strictEqual(sandeepFeeSummary.total_fee, 80000);
  assert.strictEqual(sandeepFeeSummary.paid_amount, 50000);
  assert.strictEqual(sandeepFeeSummary.pending_amount, 30000);

  // Cashier records ₹10,000 payment
  console.log('   - Cashier recording new payment of ₹10,000...');
  const payRes = await post(`${BASE_URL}/api/cashier/payment`, {
    studentId: sandeepFeeSummary.student_id,
    amount: 10000,
    paymentMethod: 'UPI',
    notes: 'Semester 5 Tuition Installment'
  }, { Authorization: `Bearer ${cashierToken}` });

  assert.strictEqual(payRes.status, 200);
  assert.strictEqual(payRes.data.totalFee, 80000);
  assert.strictEqual(payRes.data.paidAmount, 60000);
  assert.strictEqual(payRes.data.pendingAmount, 20000);
  console.log(`   ✓ Payment saved! Receipt: ${payRes.data.receiptNo}`);
  console.log(`     Updated Calculation: Total: ₹${payRes.data.totalFee} | Paid: ₹${payRes.data.paidAmount} | Pending: ₹${payRes.data.pendingAmount}`);

  // Verify Student sees updated fee
  const studentDash = await get(`${BASE_URL}/api/student/dashboard`, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(studentDash.data.fees.paid_amount, 60000);
  assert.strictEqual(studentDash.data.fees.pending_amount, 20000);
  console.log('   ✓ Student Dashboard reflects updated fee and payment history.');

  // Verify Parent sees updated fee
  const parentDash = await get(`${BASE_URL}/api/parent/dashboard`, { Authorization: `Bearer ${parentToken}` });
  assert.strictEqual(parentDash.data.fees.paid_amount, 60000);
  assert.strictEqual(parentDash.data.fees.pending_amount, 20000);
  console.log('   ✓ Parent Dashboard reflects updated fee and payment history.');
}
