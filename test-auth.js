const assert = require('assert');
const http = require('http');

// Start temporary server or test directly against API
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const cashierRoutes = require('./routes/cashier');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cashier', cashierRoutes);

const server = app.listen(5099, async () => {
  console.log('Testing Automatic Role Detection and RBAC on port 5099...\n');
  try {
    await runTests();
    console.log('\n>>> ALL ROLE DETECTION AND SECURITY TESTS PASSED SUCCESSFULLY! <<<\n');
  } catch (err) {
    console.error('\n!!! TEST SUITE FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

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
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
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
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
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
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runTests() {
  const BASE_URL = 'http://localhost:5099';

  // TEST 1: Admin Login
  console.log('1. Testing Admin Login (admin / admin123)...');
  const resAdmin = await post(`${BASE_URL}/api/auth/login`, { username: 'admin', password: 'admin123' });
  assert.strictEqual(resAdmin.status, 200);
  assert.strictEqual(resAdmin.data.user.role, 'Admin');
  console.log(`   ✓ Success! Detected Role: ${resAdmin.data.user.role} | Post: ${resAdmin.data.user.post}`);
  const adminToken = resAdmin.data.token;

  // TEST 2: Teacher Login (Ravi Kumar)
  console.log('2. Testing Teacher Login (ravi123 / teacher123)...');
  const resTeacher = await post(`${BASE_URL}/api/auth/login`, { username: 'ravi123', password: 'teacher123' });
  assert.strictEqual(resTeacher.status, 200);
  assert.strictEqual(resTeacher.data.user.role, 'Teacher');
  console.log(`   ✓ Success! Detected Role: ${resTeacher.data.user.role} | Post: ${resTeacher.data.user.post}`);
  const teacherToken = resTeacher.data.token;

  // TEST 3: Student Login (Sandeep)
  console.log('3. Testing Student Login (student123 / student123)...');
  const resStudent = await post(`${BASE_URL}/api/auth/login`, { username: 'student123', password: 'student123' });
  assert.strictEqual(resStudent.status, 200);
  assert.strictEqual(resStudent.data.user.role, 'Student');
  console.log(`   ✓ Success! Detected Role: ${resStudent.data.user.role} | Post: ${resStudent.data.user.post}`);
  const studentToken = resStudent.data.token;

  // TEST 4: Parent Login (Ramesh)
  console.log('4. Testing Parent Login (parent123 / parent123)...');
  const resParent = await post(`${BASE_URL}/api/auth/login`, { username: 'parent123', password: 'parent123' });
  assert.strictEqual(resParent.status, 200);
  assert.strictEqual(resParent.data.user.role, 'Parent');
  console.log(`   ✓ Success! Detected Role: ${resParent.data.user.role} | Post: ${resParent.data.user.post}`);

  // TEST 5: Cashier Login (Priya)
  console.log('5. Testing Cashier Login (cashier123 / cashier123)...');
  const resCashier = await post(`${BASE_URL}/api/auth/login`, { username: 'cashier123', password: 'cashier123' });
  assert.strictEqual(resCashier.status, 200);
  assert.strictEqual(resCashier.data.user.role, 'Cashier');
  console.log(`   ✓ Success! Detected Role: ${resCashier.data.user.role} | Post: ${resCashier.data.user.post}`);
  const cashierToken = resCashier.data.token;

  // TEST 6: Role-Based API Protection
  console.log('6. Testing Backend Role-Based Security:');
  console.log('   - Cashier attempts to access Admin User Management...');
  const resForbidden = await get(`${BASE_URL}/api/admin/users`, { Authorization: `Bearer ${cashierToken}` });
  assert.strictEqual(resForbidden.status, 403);
  console.log(`   ✓ Blocked with HTTP 403: ${resForbidden.data.error}`);

  console.log('   - Cashier accesses Cashier Fees API...');
  const resFees = await get(`${BASE_URL}/api/cashier/fees`, { Authorization: `Bearer ${cashierToken}` });
  assert.strictEqual(resFees.status, 200);
  console.log(`   ✓ Authorized with HTTP 200 (Retrieved ${resFees.data.fees.length} fee records)`);

  // TEST 7: Invalid Credentials
  console.log('7. Testing Invalid Credentials Handling...');
  const resBadPass = await post(`${BASE_URL}/api/auth/login`, { username: 'ravi123', password: 'wrongpassword' });
  assert.strictEqual(resBadPass.status, 401);
  console.log(`   ✓ Rejected with HTTP 401: ${resBadPass.data.error}`);

  // TEST 8: Dynamic Role Update
  console.log('8. Testing Dynamic Role Update by Admin:');
  // Create a new user as Cashier
  const newStaffUsername = 'teststaff_' + Date.now();
  const createRes = await post(`${BASE_URL}/api/admin/users`, {
    name: 'Staff Test User',
    username: newStaffUsername,
    password: 'password123',
    role: 'Cashier',
    post: 'Junior Cashier'
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(createRes.status, 201);
  const newUserId = createRes.data.user.id;
  console.log(`   ✓ Admin created user ${newStaffUsername} with initial role: Cashier`);

  // Log in as test user
  const initialLogin = await post(`${BASE_URL}/api/auth/login`, { username: newStaffUsername, password: 'password123' });
  assert.strictEqual(initialLogin.data.user.role, 'Cashier');
  console.log(`   ✓ First login verified role: ${initialLogin.data.user.role}`);

  // Admin updates role to Teacher
  console.log(`   - Admin updates ${newStaffUsername}'s role from Cashier -> Teacher...`);
  const updateRoleRes = await put(`${BASE_URL}/api/admin/users/${newUserId}/role`, {
    role: 'Teacher',
    post: 'Senior Physics Teacher'
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(updateRoleRes.status, 200);
  console.log(`   ✓ Admin API response: ${updateRoleRes.data.message}`);

  // Subsequent login: must automatically detect the new role 'Teacher'
  console.log(`   - User logs in again (NO role requested, just username/password)...`);
  const subsequentLogin = await post(`${BASE_URL}/api/auth/login`, { username: newStaffUsername, password: 'password123' });
  assert.strictEqual(subsequentLogin.data.user.role, 'Teacher');
  assert.strictEqual(subsequentLogin.data.user.post, 'Senior Physics Teacher');
  console.log(`   ✓ Next login automatically detected updated role: ${subsequentLogin.data.user.role} (${subsequentLogin.data.user.post})`);
}
