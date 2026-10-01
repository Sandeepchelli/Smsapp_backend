const assert = require('assert');
const http = require('http');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const canteenRoutes = require('./routes/canteen');
const studentRoutes = require('./routes/student');
const libraryRoutes = require('./routes/library');
require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/canteen', canteenRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/library', libraryRoutes);

const server = app.listen(5096, async () => {
  console.log('Testing Canteen Module, Student Management & Enhanced Library on port 5096...\n');
  try {
    await runTests();
    console.log('\n=============================================================');
    console.log('>>> ALL CANTEEN & STUDENT MANAGEMENT TESTS PASSED (100%)! <<<');
    console.log('=============================================================\n');
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

function del(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'DELETE',
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

async function runTests() {
  const BASE = 'http://localhost:5096';

  // 1. Authenticate Users
  console.log('1. Authenticating test accounts...');
  const resAdmin = await post(`${BASE}/api/auth/login`, { username: 'admin', password: 'admin123' });
  assert.strictEqual(resAdmin.status, 200);
  const adminToken = resAdmin.data.token;

  const resStudent = await post(`${BASE}/api/auth/login`, { username: 'student123', password: 'student123' });
  assert.strictEqual(resStudent.status, 200);
  const studentToken = resStudent.data.token;

  const resCanteen = await post(`${BASE}/api/auth/login`, { username: 'canteen123', password: 'canteen123' });
  assert.strictEqual(resCanteen.status, 200);
  assert.strictEqual(resCanteen.data.user.role, 'Canteen');
  const canteenToken = resCanteen.data.token;
  console.log('   ✓ Admin, Student (Sandeep), and Canteen Staff (Chef Rajesh) authenticated.');

  // 2. Test Canteen Menu & Management
  console.log('2. Testing Canteen Menu & Staff Operations...');
  const menuRes = await get(`${BASE}/api/canteen/menu`, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(menuRes.status, 200);
  assert(menuRes.data.items.length >= 10);
  console.log(`   ✓ Retrieved ${menuRes.data.items.length} food items from canteen menu.`);

  // Staff adds new item
  const addItemRes = await post(`${BASE}/api/canteen/items`, {
    name: 'Special Masala Chai & Biscuit',
    description: 'Freshly brewed aromatic tea with ginger & cardamom',
    price: 15,
    category: 'Beverages',
    imageUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400',
    isAvailable: 1
  }, { Authorization: `Bearer ${canteenToken}` });
  assert.strictEqual(addItemRes.status, 201);
  const newFoodId = addItemRes.data.itemId;
  console.log(`   ✓ Canteen staff added: Special Masala Chai (ID: ${newFoodId})`);

  // Staff updates price
  const updateItemRes = await put(`${BASE}/api/canteen/items/${newFoodId}`, {
    price: 18,
    isAvailable: 1
  }, { Authorization: `Bearer ${canteenToken}` });
  assert.strictEqual(updateItemRes.status, 200);
  console.log('   ✓ Canteen staff updated item price to ₹18.');

  // 3. Test Student Food Order Placement
  console.log('3. Testing Student Canteen Ordering Flow...');
  const orderRes = await post(`${BASE}/api/canteen/orders`, {
    items: [
      { itemId: menuRes.data.items[0].id, quantity: 2 }, // Veg Fried Rice 2x ₹80 = ₹160
      { itemId: newFoodId, quantity: 1 } // Masala Chai 1x ₹18 = ₹18
    ],
    orderNotes: 'Please pack in eco-friendly container',
    paymentMode: 'Campus Pay Card'
  }, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.data.orderId;
  const orderNum = orderRes.data.orderNumber;
  console.log(`   ✓ Student placed order #${orderNum}. Total Amount: ₹${orderRes.data.totalAmount}`);

  // Student checks my orders
  const myOrdersRes = await get(`${BASE}/api/canteen/my-orders`, { Authorization: `Bearer ${studentToken}` });
  assert.strictEqual(myOrdersRes.status, 200);
  const foundOrder = myOrdersRes.data.orders.find(o => o.id === orderId);
  assert(foundOrder);
  assert.strictEqual(foundOrder.items.length, 2);
  console.log(`   ✓ Student verified order #${orderNum} with ${foundOrder.items.length} items in My Orders history.`);

  // 4. Test Canteen Staff Order Status Workflow
  console.log('4. Testing Canteen Staff Order Status Transitions...');
  const statuses = ['Confirmed', 'Preparing', 'Ready', 'Completed'];
  for (const st of statuses) {
    const stRes = await put(`${BASE}/api/canteen/orders/${orderId}/status`, { status: st }, { Authorization: `Bearer ${canteenToken}` });
    assert.strictEqual(stRes.status, 200);
    console.log(`   ✓ Advanced order status -> ${st}`);
  }

  // 5. Test Admin Student Management (Full CRUD)
  console.log('5. Testing Admin Student Management CRUD...');
  const testStudentUser = 'test_student_' + Date.now();
  const createStudentRes = await post(`${BASE}/api/admin/students`, {
    name: 'Kavita Reddy',
    username: testStudentUser,
    password: 'password123',
    rollNo: '999',
    classId: 1,
    email: 'kavita@test.com',
    phone: '+91 98765 43299',
    profilePhoto: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    totalFee: 80000
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(createStudentRes.status, 201);
  const newStudentId = createStudentRes.data.studentId;
  console.log(`   ✓ Admin created student 'Kavita Reddy' (Roll #999, ID: ${newStudentId})`);

  // Admin edits student
  const editStudentRes = await put(`${BASE}/api/admin/students/${newStudentId}`, {
    name: 'Kavita S. Reddy',
    phone: '+91 98765 00000'
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(editStudentRes.status, 200);
  console.log('   ✓ Admin updated student details.');

  // Admin disables student account
  const disableRes = await put(`${BASE}/api/admin/students/${newStudentId}/status`, { isActive: 0 }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(disableRes.status, 200);
  assert.strictEqual(disableRes.data.isActive, false);
  console.log('   ✓ Admin disabled student account.');

  // Admin re-enables student account
  const enableRes = await put(`${BASE}/api/admin/students/${newStudentId}/status`, { isActive: 1 }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(enableRes.status, 200);
  assert.strictEqual(enableRes.data.isActive, true);
  console.log('   ✓ Admin re-enabled student account.');

  // Admin safely deletes student
  const delStudentRes = await del(`${BASE}/api/admin/students/${newStudentId}`, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(delStudentRes.status, 200);
  console.log(`   ✓ Admin safely deleted test student (${delStudentRes.data.message})`);

  // 6. Test Enhanced Library Book Addition with Description & Cover
  console.log('6. Testing Enhanced Library Book Management...');
  const newBookCode = 'LIB-AI-' + Date.now().toString().slice(-4);
  const addBookRes = await post(`${BASE}/api/library/books`, {
    bookCode: newBookCode,
    title: 'Reinforcement Learning: An Introduction',
    author: 'Richard S. Sutton & Andrew G. Barto',
    category: 'Computer Science',
    isbn: '978-0262039246',
    totalQty: 6,
    shelfLocation: 'Rack AI-01',
    description: 'Comprehensive guide to modern reinforcement learning algorithms and MDPs.',
    imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300'
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(addBookRes.status, 201);
  const newBookId = addBookRes.data.bookId;
  console.log(`   ✓ Library cataloged: "${newBookCode}" with cover image & description.`);

  const editBookRes = await put(`${BASE}/api/library/books/${newBookId}`, {
    totalQty: 8
  }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(editBookRes.status, 200);
  console.log('   ✓ Updated book total stock to 8 copies.');
}
