const fetch = globalThis.fetch || require('node-fetch');

async function testStaffManagement() {
  console.log('--- TESTING STAFF MANAGEMENT ---');

  let adminToken = '';

  // 1. Admin login
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) throw new Error(loginData.error);
  adminToken = loginData.token;
  console.log('✅ Admin login successful');

  // 2. Create a Driver
  const driverData = {
    name: 'Ramesh Driver',
    username: 'driver1',
    password: 'password123',
    role: 'Driver',
    post: 'Senior Driver',
    phone: '9876543210',
    department: 'Transport'
  };
  const createRes = await fetch('http://localhost:5000/api/admin/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify(driverData)
  });
  const createJson = await createRes.json();
  if (!createRes.ok) throw new Error(createJson.error);
  console.log('✅ Created Driver successfully');
  const staffId = createJson.staff.id;

  // 3. Mark Attendance for the Driver
  const attRes = await fetch('http://localhost:5000/api/admin/staff-attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ staffId, date: '2026-09-22', status: 'Present' })
  });
  const attJson = await attRes.json();
  if (!attRes.ok) throw new Error(attJson.error);
  console.log('✅ Marked Driver Attendance successfully');

  // 4. View Attendance (Admin)
  const viewAttRes = await fetch('http://localhost:5000/api/admin/staff-attendance?date=2026-09-22', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const viewAttJson = await viewAttRes.json();
  if (!viewAttRes.ok) throw new Error('Failed to view attendance');
  const hasAttendance = viewAttJson.attendance.some(a => a.staff_id === staffId && a.status === 'Present');
  if (!hasAttendance) throw new Error('Attendance not found in fetch list');
  console.log('✅ Fetched Driver Attendance successfully');

  // 5. Login as the Driver
  const driverLoginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'driver1', password: 'password123' })
  });
  const driverLoginJson = await driverLoginRes.json();
  if (!driverLoginRes.ok) throw new Error(driverLoginJson.error);
  const driverToken = driverLoginJson.token;
  console.log('✅ Driver login successful');

  // 6. View own attendance as Driver
  const driverAttRes = await fetch('http://localhost:5000/api/staff/me/attendance', {
    headers: { 'Authorization': `Bearer ${driverToken}` }
  });
  const driverAttJson = await driverAttRes.json();
  if (!driverAttRes.ok) throw new Error('Failed to fetch own attendance');
  if (driverAttJson.summary.present !== 1) throw new Error('Driver summary present count mismatch');
  console.log('✅ Driver own attendance fetch successful');

  // 7. Delete the Driver
  const delRes = await fetch(`http://localhost:5000/api/admin/staff/${staffId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const delJson = await delRes.json();
  if (!delRes.ok) throw new Error(delJson.error);
  console.log('✅ Deleted Driver successfully');

  console.log('--- ALL STAFF TESTS PASSED ---');
}

testStaffManagement().catch(err => {
  console.error('❌ TEST FAILED:', err);
});
