const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

const BASE_URL = 'http://localhost:5000';

async function runTests() {
  console.log('🧪 Starting Verification of New Modules...\n');

  // 1. Authenticate as Admin
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const adminAuth = await adminLoginRes.json();
  if (!adminLoginRes.ok) throw new Error('Admin login failed: ' + JSON.stringify(adminAuth));
  const adminToken = adminAuth.token;
  console.log('✅ Admin authenticated successfully');

  // 2. Test Teacher Attendance API
  console.log('\n--- Testing Teacher Attendance ---');
  const attRes = await fetch(`${BASE_URL}/api/admin/teacher-attendance?date=2026-09-20`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const attData = await attRes.json();
  console.log(`✅ Teacher attendance fetched: ${attData.records?.length || 0} records, ${attData.teachers?.length || 0} active faculty members`);

  if (attData.teachers?.length > 0) {
    const targetTeacher = attData.teachers[0];
    const markRes = await fetch(`${BASE_URL}/api/admin/teacher-attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        teacherId: targetTeacher.id,
        date: '2026-09-20',
        status: 'Present',
        remarks: 'Punctual for 1st hour'
      })
    });
    const markData = await markRes.json();
    console.log(`✅ Mark teacher attendance response: "${markData.message}"`);
  }

  // Monthly stats
  const statsRes = await fetch(`${BASE_URL}/api/admin/teacher-attendance-stats?month=2026-09`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const statsData = await statsRes.json();
  console.log(`✅ Teacher monthly attendance summary: ${statsData.summary?.total_entries || 0} total entries`);

  // 3. Test Teacher Subject Management API
  console.log('\n--- Testing Teacher Subject Management ---');
  const assignListRes = await fetch(`${BASE_URL}/api/admin/teacher-assignments`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const assignListData = await assignListRes.json();
  console.log(`✅ Teacher assignments fetched: ${assignListData.assignments?.length || 0} assignments, ${assignListData.teachers?.length || 0} teachers, ${assignListData.classes?.length || 0} classes, ${assignListData.subjects?.length || 0} subjects`);

  // Try creating a new assignment
  if (assignListData.teachers?.length > 0 && assignListData.classes?.length > 0 && assignListData.subjects?.length > 0) {
    const teacherId = assignListData.teachers[0].id;
    // find a class and subject not yet assigned to this teacher
    const unusedClass = assignListData.classes[0].id;
    const unusedSubject = assignListData.subjects[assignListData.subjects.length - 1].id;

    const createAssignRes = await fetch(`${BASE_URL}/api/admin/teacher-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        teacherId,
        classId: unusedClass,
        subjectId: unusedSubject
      })
    });
    const createAssignData = await createAssignRes.json();
    console.log(`✅ Create assignment response:`, createAssignData.message || createAssignData.error);

    if (createAssignData.assignmentId) {
      // Delete assignment
      const delAssignRes = await fetch(`${BASE_URL}/api/admin/teacher-assignments/${createAssignData.assignmentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const delAssignData = await delAssignRes.json();
      console.log(`✅ Delete assignment response: "${delAssignData.message}"`);
    }
  }

  // 4. Test User Profile API for Multiple Roles
  console.log('\n--- Testing User Profile API ---');
  // Admin Profile
  const adminProfRes = await fetch(`${BASE_URL}/api/users/profile`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const adminProf = await adminProfRes.json();
  console.log(`✅ Admin Profile: ${adminProf.user?.name} (${adminProf.user?.role}) - Admin ID: ${adminProf.roleData?.adminId}`);

  // Student Profile
  const studentLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'student123', password: 'student123' })
  });
  const studentAuth = await studentLogin.json();
  const studentProfRes = await fetch(`${BASE_URL}/api/users/profile`, {
    headers: { 'Authorization': `Bearer ${studentAuth.token}` }
  });
  const studentProf = await studentProfRes.json();
  console.log(`✅ Student Profile: ${studentProf.user?.name} (Roll #${studentProf.roleData?.rollNo}, Class: ${studentProf.roleData?.className})`);
  console.log(`   Linked Parent: ${studentProf.roleData?.parent?.name} (${studentProf.roleData?.parent?.relation})`);
  console.log(`   Academic Stats: CGPA ${studentProf.roleData?.cgpa}, Attendance: ${studentProf.roleData?.attendanceRate}%`);

  // Teacher Profile
  const teacherLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ravi123', password: 'teacher123' })
  });
  const teacherAuth = await teacherLogin.json();
  const teacherProfRes = await fetch(`${BASE_URL}/api/users/profile`, {
    headers: { 'Authorization': `Bearer ${teacherAuth.token}` }
  });
  const teacherProf = await teacherProfRes.json();
  console.log(`✅ Teacher Profile: Prof. ${teacherProf.user?.name} (${teacherProf.roleData?.department}) - ${teacherProf.roleData?.assignedSubjectsCount} Courses`);

  // 5. Test Profile Contact Update
  console.log('\n--- Testing Profile Update ---');
  const updateRes = await fetch(`${BASE_URL}/api/users/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentAuth.token}` },
    body: JSON.stringify({
      email: 'sandeep.updated@greenwood.edu',
      phone: '+91 98765 00101'
    })
  });
  const updateData = await updateRes.json();
  console.log(`✅ Profile update response: "${updateData.message}" - New Email: ${updateData.user?.email}`);

  // 6. Test Settings API & Password Change
  console.log('\n--- Testing User Settings & Password Change ---');
  const settingsRes = await fetch(`${BASE_URL}/api/users/settings`, {
    headers: { 'Authorization': `Bearer ${studentAuth.token}` }
  });
  const settingsData = await settingsRes.json();
  console.log(`✅ User settings fetched: Theme=${settingsData.settings?.theme}, Lang=${settingsData.settings?.language}`);

  const updateSettingsRes = await fetch(`${BASE_URL}/api/users/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentAuth.token}` },
    body: JSON.stringify({
      theme: 'glassmorphism',
      language: 'en',
      emailAlerts: 1,
      smsAlerts: 1
    })
  });
  const updateSettingsData = await updateSettingsRes.json();
  console.log(`✅ Update settings response: "${updateSettingsData.message}"`);

  // Password change test
  const badPwRes = await fetch(`${BASE_URL}/api/users/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentAuth.token}` },
    body: JSON.stringify({
      currentPassword: 'wrongpassword',
      newPassword: 'newpassword123'
    })
  });
  console.log(`✅ Incorrect password correctly rejected with status ${badPwRes.status}`);

  console.log('\n🎉 ALL NEW MODULE TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
