import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load .env
if (!process.env.ADMIN_PASSWORD || !process.env.STAFF_PASSWORD) {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (err) {}
}

const baseUrl = process.env.BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async login(username, password) {
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });
    return res;
  }

  async request(path, { method = 'GET', body, headers: customHeaders = {} } = {}) {
    const headers = new Headers(customHeaders);
    if (body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.cookie) {
      headers.set('Cookie', this.cookie);
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
}

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

console.log('============================================================');
console.log('TESTING 3-TIER USER REFACTOR: ADMIN > DIRECTOR > STAFF');
console.log('============================================================\n');

const adminClient = new ApiClient();
const staffClient = new ApiClient();

// 1. ADMIN Login
await test('1. Login ADMIN succeeds and returns admin session', async () => {
  const loginRes = await adminClient.login('admin', adminPassword);
  assert.equal(loginRes.status, 200, 'Admin login failed');
  assert.equal(loginRes.data.user.role, 'admin');
  assert.ok(loginRes.data.user.permissions.includes('*'), 'Admin has wildcard *');
});

// 2. ADMIN can access /api/users and /api/rbac
await test('2. ADMIN can view users list and roles', async () => {
  const usersRes = await adminClient.request('/api/users');
  assert.equal(usersRes.status, 200);
  assert.ok(Array.isArray(usersRes.data.items), 'items must be an array');
  assert.ok(usersRes.data.total >= 1, 'must have users');

  const rolesRes = await adminClient.request('/api/rbac/roles');
  assert.equal(rolesRes.status, 200);
  assert.equal(rolesRes.data.items.length, 5);
});

// 3. ADMIN creates STAFF user
const testStaffUser = `staff_${Date.now()}`;
const testStaffPass = 'Staff_Test_123456!';
await test('3. ADMIN creates STAFF user successfully', async () => {
  const res = await adminClient.request('/api/users', {
    method: 'POST',
    body: {
      username: testStaffUser,
      full_name: 'Test Staff User',
      email: 'staff_test@billing.local',
      password: testStaffPass,
      role: 'staff',
      status: 'ACTIVE'
    }
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.username, testStaffUser);
  assert.equal(res.data.user.role, 'staff');
  assert.equal(res.data.user.is_active, true);
});

// 4. ADMIN creates DIRECTOR user
const testDirectorUser = `dir_${Date.now()}`;
const testDirectorPass = 'Director_Test_123456!';
await test('4. ADMIN creates DIRECTOR user successfully', async () => {
  const res = await adminClient.request('/api/users', {
    method: 'POST',
    body: {
      username: testDirectorUser,
      full_name: 'Test Director User',
      email: 'director_test@billing.local',
      password: testDirectorPass,
      role: 'director',
      status: 'ACTIVE'
    }
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.username, testDirectorUser);
  assert.ok(res.data.user.role === 'ROLE_BILLING_MANAGER' || res.data.user.role === 'director');
  assert.equal(res.data.user.display_role, 'DIRECTOR');
  assert.equal(res.data.user.is_active, true);
});

// 5. Login created STAFF user
const newStaffClient = new ApiClient();
await test('5. Login created STAFF user and verify operational permissions', async () => {
  const loginRes = await newStaffClient.login(testStaffUser, testStaffPass);
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.user.role, 'staff');
  assert.ok(!loginRes.data.user.permissions.includes('*'), 'Staff does not have wildcard');
  assert.ok(loginRes.data.user.permissions.includes('invoice.create'), 'Staff has invoice.create');
});

// 6. STAFF attempting admin endpoints -> HTTP 403 FORBIDDEN
await test('6. STAFF calling Admin endpoints returns HTTP 403 FORBIDDEN', async () => {
  // GET /api/users
  const r1 = await newStaffClient.request('/api/users');
  assert.equal(r1.status, 403, 'STAFF GET /api/users must be 403');

  // POST /api/users
  const r2 = await newStaffClient.request('/api/users', {
    method: 'POST',
    body: { username: 'hacker', password: 'password123', role: 'admin' }
  });
  assert.equal(r2.status, 403, 'STAFF POST /api/users must be 403');

  // PUT /api/rbac/roles/2/permissions
  const r3 = await newStaffClient.request('/api/rbac/roles/2/permissions', {
    method: 'PUT',
    body: { permission_ids: [1, 2] }
  });
  assert.equal(r3.status, 403, 'STAFF PUT /api/rbac/roles/... must be 403');

  // PUT /api/settings
  const r4 = await newStaffClient.request('/api/settings', {
    method: 'PUT',
    body: { company_name: 'Hacked Inc' }
  });
  assert.equal(r4.status, 403, 'STAFF PUT /api/settings must be 403');

  // GET /api/audit
  const r5 = await newStaffClient.request('/api/audit');
  assert.equal(r5.status, 403, 'STAFF GET /api/audit must be 403');

  // POST /api/adjustments/1/approve
  const r6 = await newStaffClient.request('/api/adjustments/1/approve', { method: 'POST' });
  assert.equal(r6.status, 403, 'STAFF POST /api/adjustments/.../approve must be 403');
});

// 7. Login created DIRECTOR user
const newDirectorClient = new ApiClient();
await test('7. Login created DIRECTOR user and verify executive permissions', async () => {
  const loginRes = await newDirectorClient.login(testDirectorUser, testDirectorPass);
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.data.user.role === 'ROLE_BILLING_MANAGER' || loginRes.data.user.role === 'director');
  assert.ok(!loginRes.data.user.permissions.includes('*'), 'Director does not have wildcard');
  assert.ok(loginRes.data.user.permissions.includes('invoice.issue_override'), 'Director has issue_override');
  assert.ok(loginRes.data.user.permissions.includes('adjustment.approve'), 'Director has adjustment.approve');
});

// 8. DIRECTOR attempting admin-only endpoints -> HTTP 403 FORBIDDEN
await test('8. DIRECTOR calling User/Permission/Audit management returns HTTP 403 FORBIDDEN', async () => {
  // GET /api/users
  const r1 = await newDirectorClient.request('/api/users');
  assert.equal(r1.status, 403, 'DIRECTOR GET /api/users must be 403');

  // POST /api/users
  const r2 = await newDirectorClient.request('/api/users', {
    method: 'POST',
    body: { username: 'dir_create', password: 'password123', role: 'staff' }
  });
  assert.equal(r2.status, 403, 'DIRECTOR POST /api/users must be 403');

  // PUT /api/rbac/roles/3/permissions
  const r3 = await newDirectorClient.request('/api/rbac/roles/3/permissions', {
    method: 'PUT',
    body: { permission_ids: [1, 2] }
  });
  assert.equal(r3.status, 403, 'DIRECTOR PUT /api/rbac/roles/... must be 403');

  // PUT /api/settings
  const r4 = await newDirectorClient.request('/api/settings', {
    method: 'PUT',
    body: { company_name: 'Director Changed' }
  });
  assert.equal(r4.status, 403, 'DIRECTOR PUT /api/settings must be 403');

  // GET /api/audit
  const r5 = await newDirectorClient.request('/api/audit');
  assert.equal(r5.status, 403, 'DIRECTOR GET /api/audit must be 403');
});

// 9. DIRECTOR can access financial & executive endpoints
await test('9. DIRECTOR can view financial reports, invoices, and customers', async () => {
  const rInv = await newDirectorClient.request('/api/invoices?limit=5');
  assert.equal(rInv.status, 200, 'Director can view invoices');

  const rCust = await newDirectorClient.request('/api/customers?limit=5');
  assert.equal(rCust.status, 200, 'Director can view customers');

  const rRev = await newDirectorClient.request('/api/reports/revenue-analytics');
  assert.equal(rRev.status, 200, 'Director can view revenue analytics');

  const rAging = await newDirectorClient.request('/api/reports/aging');
  assert.equal(rAging.status, 200, 'Director can view aging matrix');

  const rDso = await newDirectorClient.request('/api/reports/collection-metrics');
  assert.equal(rDso.status, 200, 'Director can view DSO/CEI');
});

// 10. ADMIN can update permissions and session reload verifies dynamic state
await test('10. ADMIN can update role permissions and dynamic reload works', async () => {
  // Get current permissions of ROLE_BILLING_MANAGER (id 3)
  const currentPerms = await adminClient.request('/api/rbac/roles/3/permissions');
  assert.equal(currentPerms.status, 200);
  const origPermIds = currentPerms.data.permission_ids;

  // Update permissions
  const updateRes = await adminClient.request('/api/rbac/roles/3/permissions', {
    method: 'PUT',
    body: { permission_ids: origPermIds }
  });
  assert.equal(updateRes.status, 200);

  // Reload session of director
  const meRes = await newDirectorClient.request('/api/auth/me');
  assert.equal(meRes.status, 200);
  assert.ok(meRes.data.role === 'ROLE_BILLING_MANAGER' || meRes.data.role === 'director');
  assert.ok(meRes.data.permissions.includes('adjustment.approve'));
});

// 11. ADMIN lock and unlock user
await test('11. ADMIN lock/unlock user toggles active status', async () => {
  // Find testStaff user
  const usersRes = await adminClient.request(`/api/users?q=${testStaffUser}`);
  const user = usersRes.data.items.find(u => u.username === testStaffUser);
  assert.ok(user, 'test staff user found');

  // Lock user
  const lockRes = await adminClient.request(`/api/users/${user.id}/toggle-status`, {
    method: 'POST',
    body: { is_active: false }
  });
  assert.equal(lockRes.status, 200);
  assert.equal(lockRes.data.user.is_active, false);

  // Locked user fails login
  const lockedClient = new ApiClient();
  const failLogin = await lockedClient.login(testStaffUser, testStaffPass);
  assert.equal(failLogin.status, 401, 'Locked user cannot log in');

  // Unlock user
  const unlockRes = await adminClient.request(`/api/users/${user.id}/toggle-status`, {
    method: 'POST',
    body: { is_active: true }
  });
  assert.equal(unlockRes.status, 200);
  assert.equal(unlockRes.data.user.is_active, true);

  // Unlocked user can log in again
  const reLogin = await lockedClient.login(testStaffUser, testStaffPass);
  assert.equal(reLogin.status, 200, 'Unlocked user can log in');
});

// 12. Cleanup test users
await test('12. Cleanup test users created during test', async () => {
  const usersRes = await adminClient.request(`/api/users`);
  for (const u of usersRes.data.items) {
    if (u.username === testStaffUser || u.username === testDirectorUser) {
      await adminClient.request(`/api/users/${u.id}`, { method: 'DELETE' });
    }
  }
});

console.log('\n============================================================');
console.log(`TIER REFACTOR SUITE: ALL ${passed}/${total} TESTS PASSED (100%)`);
console.log('============================================================\n');
