const assert = require('assert');
const http = require('http');

function request(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const payload = postData ? (typeof postData === 'string' ? postData : JSON.stringify(postData)) : null;

    const headers = { ...options.headers };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          body
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  const BASE_URL = 'http://localhost:5000';
  console.log('=== STARTING USER MANAGEMENT UPGRADES VERIFICATION ===\n');

  // 1. Log in as Admin to get Admin JWT
  console.log('1. Authenticating as Admin...');
  const adminLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: 'admin',
    password: 'admin123'
  });
  assert.strictEqual(adminLogin.status, 200);
  assert.strictEqual(adminLogin.data.user.role, 'Admin');
  const adminToken = adminLogin.data.token;
  const authHeaders = { Authorization: `Bearer ${adminToken}` };
  console.log('   ✓ Admin authenticated successfully.\n');

  // 2. Fetch classes to get a valid class ID
  const classesRes = await request(`${BASE_URL}/api/admin/classes`, { headers: authHeaders });
  assert.strictEqual(classesRes.status, 200);
  const classId = classesRes.data.classes[0].id;

  // 3. Test Student Creation with Parent Details & Credentials
  const timestamp = Date.now();
  const testStudentUser = `tstud_${timestamp}`;
  const testStudentPass = `pass_stud_${timestamp}`;
  const testParentUser = `tpar_${timestamp}`;
  const testParentPass = `pass_par_${timestamp}`;

  console.log('2. Testing Student Creation with Linked Parent Credentials...');
  const createRes = await request(`${BASE_URL}/api/admin/students`, {
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Integration Test Student',
    username: testStudentUser,
    password: testStudentPass,
    rollNo: '999',
    classId: classId,
    email: 'teststudent@integration.edu',
    phone: '+91 99999 11111',
    profilePhoto: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150',
    totalFee: 75000,
    parentName: 'Integration Test Parent',
    parentPhone: '+91 99999 22222',
    parentEmail: 'testparent@integration.edu',
    parentRelationship: 'Mother',
    parentUsername: testParentUser,
    parentPassword: testParentPass,
    parentProfilePhoto: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'
  });

  assert.strictEqual(createRes.status, 201, `Failed creation: ${JSON.stringify(createRes.data)}`);
  const createdStudentId = createRes.data.studentId;
  const createdParentId = createRes.data.parentId;
  console.log(`   ✓ Student created with ID: ${createdStudentId}, linked Parent ID: ${createdParentId}`);

  // 4. Verify Student and Parent login and role detection
  console.log('3. Verifying Automatic Role Detection for new accounts...');
  const studLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: testStudentUser,
    password: testStudentPass
  });
  assert.strictEqual(studLogin.status, 200);
  assert.strictEqual(studLogin.data.user.role, 'Student');
  console.log(`   ✓ Student logged in -> Role detected: ${studLogin.data.user.role}`);

  const parLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: testParentUser,
    password: testParentPass
  });
  assert.strictEqual(parLogin.status, 200);
  assert.strictEqual(parLogin.data.user.role, 'Parent');
  console.log(`   ✓ Parent logged in -> Role detected: ${parLogin.data.user.role}\n`);

  // 5. Test Student Edit: Change Student User ID, Password, and Parent User ID, Password
  console.log('4. Testing Student & Parent Edit (Username, Password & Profile)...');
  const updatedStudentUser = `tstud_upd_${timestamp}`;
  const updatedStudentPass = `pass_stud_upd_${timestamp}`;
  const updatedParentUser = `tpar_upd_${timestamp}`;
  const updatedParentPass = `pass_par_upd_${timestamp}`;

  const editRes = await request(`${BASE_URL}/api/admin/students/${createdStudentId}`, {
    method: 'PUT',
    headers: authHeaders
  }, {
    name: 'Updated Student Name',
    username: updatedStudentUser,
    password: updatedStudentPass,
    rollNo: '999-A',
    classId: classId,
    email: 'updated_stud@test.edu',
    phone: '+91 88888 11111',
    parentName: 'Updated Parent Name',
    parentUsername: updatedParentUser,
    parentPassword: updatedParentPass,
    parentPhone: '+91 88888 22222',
    parentEmail: 'updated_par@test.edu',
    parentRelationship: 'Guardian'
  });

  assert.strictEqual(editRes.status, 200, `Failed edit: ${JSON.stringify(editRes.data)}`);
  console.log(`   ✓ Update API response: ${editRes.data.message}`);

  // Old credentials must fail
  const oldStudLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: testStudentUser,
    password: testStudentPass
  });
  assert.strictEqual(oldStudLogin.status, 401);
  console.log('   ✓ Old student credentials rejected with HTTP 401.');

  // New credentials must succeed
  const newStudLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: updatedStudentUser,
    password: updatedStudentPass
  });
  assert.strictEqual(newStudLogin.status, 200);
  assert.strictEqual(newStudLogin.data.user.role, 'Student');
  console.log('   ✓ New student credentials successfully authenticated.');

  // New parent credentials must succeed
  const newParLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: updatedParentUser,
    password: updatedParentPass
  });
  assert.strictEqual(newParLogin.status, 200);
  assert.strictEqual(newParLogin.data.user.role, 'Parent');
  console.log('   ✓ New parent credentials successfully authenticated.\n');

  // 6. Test Teacher Creation, Edit (Username + Password), and Verification
  console.log('5. Testing Teacher Management (Credentials & Profile Edit)...');
  const testTeacherUser = `tteach_${timestamp}`;
  const testTeacherPass = `pass_teach_${timestamp}`;
  const createTeacherRes = await request(`${BASE_URL}/api/admin/teachers`, {
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Prof. Test Teacher',
    username: testTeacherUser,
    password: testTeacherPass,
    employeeId: `FAC-${timestamp}`,
    department: 'Computer Science & Engineering',
    post: 'Assistant Professor',
    email: 'teacher@test.edu',
    phone: '+91 77777 00000'
  });
  assert.strictEqual(createTeacherRes.status, 201);
  const createdTeacherId = createTeacherRes.data.teacherId;
  console.log(`   ✓ Teacher created with ID: ${createdTeacherId}`);

  // Edit Teacher: Update Username, Password, and Post
  const updatedTeacherUser = `tteach_upd_${timestamp}`;
  const updatedTeacherPass = `pass_teach_upd_${timestamp}`;
  const editTeacherRes = await request(`${BASE_URL}/api/admin/teachers/${createdTeacherId}`, {
    method: 'PUT',
    headers: authHeaders
  }, {
    name: 'Prof. Updated Test Teacher',
    username: updatedTeacherUser,
    password: updatedTeacherPass,
    employeeId: `FAC-${timestamp}`,
    department: 'Computer Science & Engineering',
    post: 'Senior Associate Professor',
    email: 'teacher_updated@test.edu',
    phone: '+91 77777 11111'
  });
  assert.strictEqual(editTeacherRes.status, 200);
  console.log(`   ✓ Teacher updated: ${editTeacherRes.data.message}`);

  // Verify login with updated teacher credentials
  const teacherLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: updatedTeacherUser,
    password: updatedTeacherPass
  });
  assert.strictEqual(teacherLogin.status, 200);
  assert.strictEqual(teacherLogin.data.user.role, 'Teacher');
  console.log(`   ✓ New teacher credentials authenticated -> Role: ${teacherLogin.data.user.role}\n`);

  // 7. Test Student Deletion & Orphan Parent Cleanup
  console.log('6. Testing Safe Student Deletion & Parent Cleanup...');
  const deleteStudRes = await request(`${BASE_URL}/api/admin/students/${createdStudentId}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  assert.strictEqual(deleteStudRes.status, 200);
  console.log(`   ✓ Student delete response: ${deleteStudRes.data.message}`);

  // Verify student login fails now
  const deletedStudLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: updatedStudentUser,
    password: updatedStudentPass
  });
  assert.strictEqual(deletedStudLogin.status, 401);
  console.log('   ✓ Deleted student user account no longer exists.');

  // Verify orphan parent was cleaned up
  const deletedParLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: updatedParentUser,
    password: updatedParentPass
  });
  assert.strictEqual(deletedParLogin.status, 401);
  console.log('   ✓ Orphan parent account cleaned up cleanly without affecting unrelated users.\n');

  // 8. Test Teacher Deletion
  console.log('7. Testing Safe Teacher Deletion...');
  const deleteTeacherRes = await request(`${BASE_URL}/api/admin/teachers/${createdTeacherId}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  assert.strictEqual(deleteTeacherRes.status, 200);
  console.log(`   ✓ Teacher delete response: ${deleteTeacherRes.data.message}`);

  // Verify teacher login fails
  const deletedTeacherLogin = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
    username: updatedTeacherUser,
    password: updatedTeacherPass
  });
  assert.strictEqual(deletedTeacherLogin.status, 401);
  console.log('   ✓ Deleted teacher account no longer exists.\n');

  // 9. Verify existing baseline users are intact
  console.log('8. Verifying Existing Database Users Remain Completely Intact:');
  const baselineUsers = [
    { u: 'admin', p: 'admin123', role: 'Admin' },
    { u: 'ravi123', p: 'teacher123', role: 'Teacher' },
    { u: 'student123', p: 'student123', role: 'Student' },
    { u: 'parent123', p: 'parent123', role: 'Parent' },
    { u: 'cashier123', p: 'cashier123', role: 'Cashier' }
  ];

  for (const b of baselineUsers) {
    const res = await request(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
      username: b.u,
      password: b.p
    });
    assert.strictEqual(res.status, 200, `Baseline user ${b.u} login failed!`);
    assert.strictEqual(res.data.user.role, b.role);
    console.log(`   ✓ ${b.role} (${b.u}) intact and functioning properly.`);
  }

  console.log('\n>>> ALL USER MANAGEMENT UPGRADE TESTS PASSED SUCCESSFULLY! <<<');
}

run().catch(err => {
  console.error('\n!!! TEST FAILED:', err);
  process.exit(1);
});
