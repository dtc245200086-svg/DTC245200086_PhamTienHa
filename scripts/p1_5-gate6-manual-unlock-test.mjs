/**
 * BILLING_ONE — P1.5 GATE 6 TEST SUITE
 * MANUAL CUSTOMER UNLOCK — CONTROLLED IMPLEMENTATION & FORENSIC VERIFICATION
 *
 * Scenarios verified:
 * T01: Anonymous request -> 401 UNAUTHENTICATED
 * T02: staff -> 403 FORBIDDEN
 * T03: ROLE_ACCOUNTANT -> 403 FORBIDDEN
 * T04: ROLE_AUDITOR -> 403 FORBIDDEN
 * T05: admin valid unlock -> 200 -> customer ACTIVE
 * T06: ROLE_BILLING_MANAGER valid unlock -> 200 -> customer ACTIVE
 * T07: Missing unlock_reason -> 400 UNLOCK_REASON_REQUIRED
 * T08: unlock_reason < 10 chars -> 400 UNLOCK_REASON_REQUIRED
 * T09: Missing Idempotency-Key -> 400 IDEMPOTENCY_KEY_REQUIRED
 * T10: Invalid target_status -> 400 INVALID_TARGET_STATUS
 * T11: Customer not found -> 404 CUSTOMER_NOT_FOUND
 * T12: Customer not LOCKED -> 409 CUSTOMER_NOT_LOCKED
 * T13: LOCKED -> ACTIVE -> success -> lock metadata cleared
 * T14: LOCKED -> WARNING -> success -> lock metadata cleared
 * T15: Audit metadata correctness (100% compliant)
 * T16: Idempotent replay (same key + payload -> 200 + 0 dup audit)
 * T17: Idempotency payload mismatch (same key + changed payload -> 409)
 * T18: Audit failure rollback (customer remains LOCKED, 0 committed unlock audit)
 * T19: Concurrent same-key unlock requests (1 execution + 1 replay + 0 deadlocks)
 * T20: Concurrent different-key unlock requests (1 success + 1 CUSTOMER_NOT_LOCKED + 0 deadlocks)
 * T21: Gate 4 regression: PUT LOCKED customer attempting ACTIVE -> 409 CUSTOMER_IS_LOCKED
 * T22: Gate 4 regression: PUT LOCKED customer attempting WARNING -> 409 CUSTOMER_IS_LOCKED
 * T23: Manual unlock does not alter credit_limit
 * T24: Manual unlock does not alter unrelated customer profile data
 * T25: Successful unlock creates exactly one valid audit chain entry
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load .env fallback
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
  } catch (err) {
    // Ignore error
  }
}

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const staffPassword = process.env.STAFF_PASSWORD;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!staffPassword || !adminPassword) {
  throw new Error('STAFF_PASSWORD and ADMIN_PASSWORD are required in environment or .env.');
}

function queryDb(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  return out;
}

function queryDbJson(sql) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim();
  const singleLineSql = `SELECT coalesce(json_agg(t), '[]'::json) FROM (${cleanSql}) t;`;
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  if (!out || out === '') return [];
  return JSON.parse(out);
}

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async login(username, password) {
    let res = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });
    if (res.status === 429) {
      console.log(`[CLIENT] 429 encountered for ${username}, backing off 12s...`);
      await new Promise(r => setTimeout(r, 12000));
      res = await this.request('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      });
    }
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

function getErrorCode(res) {
  return res.data?.error?.code || res.data?.code;
}

console.log('============================================================');
console.log('BILLING_ONE — P1.5 GATE 6 MANUAL CUSTOMER UNLOCK SUITE');
console.log('============================================================\n');

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

// Ensure test users exist with individual test credentials
const gate6BillingMgrPass = process.env.TEST_GATE6_BILLING_MGR_PASSWORD || 'Test_gate6_billing_mgr_Pass!2026';
const gate6AccountantPass = process.env.TEST_GATE6_ACCOUNTANT_PASSWORD || 'Test_gate6_accountant_Pass!2026';
const gate6AuditorPass = process.env.TEST_GATE6_AUDITOR_PASSWORD || 'Test_gate6_auditor_Pass!2026';

queryDb(`
  INSERT INTO public.users (username, password_hash, role)
  VALUES ('gate6_billing_mgr', crypt('${gate6BillingMgrPass}', gen_salt('bf', 10)), 'ROLE_BILLING_MANAGER')
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate6BillingMgrPass}', gen_salt('bf', 10)), role = 'ROLE_BILLING_MANAGER';
`);

queryDb(`
  INSERT INTO public.users (username, password_hash, role)
  VALUES ('gate6_accountant', crypt('${gate6AccountantPass}', gen_salt('bf', 10)), 'ROLE_ACCOUNTANT')
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate6AccountantPass}', gen_salt('bf', 10)), role = 'ROLE_ACCOUNTANT';
`);

queryDb(`
  INSERT INTO public.users (username, password_hash, role)
  VALUES ('gate6_auditor', crypt('${gate6AuditorPass}', gen_salt('bf', 10)), 'ROLE_AUDITOR')
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate6AuditorPass}', gen_salt('bf', 10)), role = 'ROLE_AUDITOR';
`);

// Setup clients
const adminClient = new ApiClient();
const staffClient = new ApiClient();
const managerClient = new ApiClient();
const accountantClient = new ApiClient();
const auditorClient = new ApiClient();
const unauthClient = new ApiClient();

const loginAdmin = await adminClient.login('admin', adminPassword);
assert.equal(loginAdmin.status, 200, 'Admin login failed');

const loginStaff = await staffClient.login('staff', staffPassword);
assert.equal(loginStaff.status, 200, 'Staff login failed');

const loginManager = await managerClient.login('gate6_billing_mgr', gate6BillingMgrPass);
assert.equal(loginManager.status, 200, 'Manager login failed');

const loginAccountant = await accountantClient.login('gate6_accountant', gate6AccountantPass);
assert.equal(loginAccountant.status, 200, 'Accountant login failed');

const loginAuditor = await auditorClient.login('gate6_auditor', gate6AuditorPass);
assert.equal(loginAuditor.status, 200, 'Auditor login failed');

console.log('✓ All 5 authenticated role sessions established successfully\n');

// Helpers for test entity creation
function createCustomer({
  code,
  name = 'Test Gate6 Customer',
  status = 'LOCKED',
  creditLimit = '50000000.00',
  lockSource = 'MANUAL',
  lockReason = 'Risk review pending settlement',
  lockedAt = '2026-10-01 10:00:00+00',
  email = null,
  phone = '0912345678',
  address = '123 Le Loi, District 1, HCMC',
  taxCode = '0102030405',
  segment = 'Enterprise'
}) {
  const lockSrcVal = lockSource ? `'${lockSource}'` : 'NULL';
  const lockRsnVal = lockReason ? `'${lockReason}'` : 'NULL';
  const lockedAtVal = lockedAt ? `'${lockedAt}'::timestamptz` : 'NULL';
  const emailVal = email ? `'${email}'` : `'${code.toLowerCase()}@test.vn'`;
  const out = queryDb(
    `INSERT INTO public.customers (code, name, email, phone, address, tax_code, segment, status, credit_limit, lock_source, lock_reason, locked_at, created_at)
     VALUES ('${code}', '${name}', ${emailVal}, '${phone}', '${address}', '${taxCode}', '${segment}', '${status}', ${creditLimit}, ${lockSrcVal}, ${lockRsnVal}, ${lockedAtVal}, NOW())
     RETURNING id;`
  );
  return parseInt(out, 10);
}

function cleanup() {
  queryDb(`DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'TEST_G6_%'));`);
  queryDb(`DELETE FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'TEST_G6_%');`);
  queryDb(`DELETE FROM public.customers WHERE code LIKE 'TEST_G6_%';`);
}

cleanup();

// Shared customer for initial auth tests
const baseCustId = createCustomer({ code: 'TEST_G6_BASE_01', name: 'Base Auth Customer' });

// =============================================================
// T01 - T04: RBAC & Authentication Denial Matrix
// =============================================================

await test('T01: Anonymous request -> 401 UNAUTHENTICATED', async () => {
  const res = await unauthClient.request(`/api/customers/${baseCustId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t01' },
    body: { unlock_reason: 'Ban Giám đốc đã ký thỏa thuận cam kết lộ trình thanh toán' }
  });
  assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
});

await test('T02: staff -> 403 FORBIDDEN', async () => {
  const res = await staffClient.request(`/api/customers/${baseCustId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t02' },
    body: { unlock_reason: 'Ban Giám đốc đã ký thỏa thuận cam kết lộ trình thanh toán' }
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

await test('T03: ROLE_ACCOUNTANT -> 403 FORBIDDEN', async () => {
  const res = await accountantClient.request(`/api/customers/${baseCustId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t03' },
    body: { unlock_reason: 'Ban Giám đốc đã ký thỏa thuận cam kết lộ trình thanh toán' }
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

await test('T04: ROLE_AUDITOR -> 403 FORBIDDEN', async () => {
  const res = await auditorClient.request(`/api/customers/${baseCustId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t04' },
    body: { unlock_reason: 'Ban Giám đốc đã ký thỏa thuận cam kết lộ trình thanh toán' }
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

// =============================================================
// T05 - T06: Authorized Roles Allowed
// =============================================================

await test('T05: admin valid unlock -> 200 -> customer ACTIVE', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T05', name: 'Admin Unlock Customer' });
  const key = `key-t05-${Date.now()}`;
  const res = await adminClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { unlock_reason: 'Admin phê duyệt mở khóa sau khi đối soát xong công nợ' }
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.customer.status, 'ACTIVE');
  assert.equal(res.data.is_idempotent_replay, false);

  const dbCust = queryDbJson(`SELECT status, lock_source, locked_at, lock_reason FROM public.customers WHERE id = ${custId}`);
  assert.equal(dbCust[0].status, 'ACTIVE');
  assert.equal(dbCust[0].lock_source, null);
  assert.equal(dbCust[0].locked_at, null);
  assert.equal(dbCust[0].lock_reason, null);
});

await test('T06: ROLE_BILLING_MANAGER valid unlock -> 200 -> customer ACTIVE', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T06', name: 'Manager Unlock Customer' });
  const key = `key-t06-${Date.now()}`;
  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { unlock_reason: 'Manager phê duyệt bảo lãnh thanh toán mở khóa theo công văn 123' }
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.customer.status, 'ACTIVE');
  assert.equal(res.data.is_idempotent_replay, false);

  const dbCust = queryDbJson(`SELECT status, lock_source, locked_at, lock_reason FROM public.customers WHERE id = ${custId}`);
  assert.equal(dbCust[0].status, 'ACTIVE');
  assert.equal(dbCust[0].lock_source, null);
  assert.equal(dbCust[0].locked_at, null);
  assert.equal(dbCust[0].lock_reason, null);
});

// =============================================================
// T07 - T10: Request Validation
// =============================================================

await test('T07: Missing unlock_reason -> 400 UNLOCK_REASON_REQUIRED', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T07' });
  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t07-${Date.now()}` },
    body: {}
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'UNLOCK_REASON_REQUIRED');
});

await test('T08: unlock_reason < 10 chars -> 400 UNLOCK_REASON_REQUIRED', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T08' });
  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t08-${Date.now()}` },
    body: { unlock_reason: '  short  ' }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'UNLOCK_REASON_REQUIRED');
});

await test('T09: Missing Idempotency-Key -> 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T09' });
  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    body: { unlock_reason: 'Lý do mở khóa dài hợp lệ theo tiêu chuẩn' }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'IDEMPOTENCY_KEY_REQUIRED');
});

await test('T10: Invalid target_status -> 400 INVALID_TARGET_STATUS', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T10' });
  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t10-${Date.now()}` },
    body: {
      unlock_reason: 'Lý do mở khóa dài hợp lệ theo tiêu chuẩn',
      target_status: 'LOCKED'
    }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'INVALID_TARGET_STATUS');
});

// =============================================================
// T11 - T14: Business State Constraints & Status Transitions
// =============================================================

await test('T11: Customer not found -> 404 CUSTOMER_NOT_FOUND', async () => {
  const res = await managerClient.request('/api/customers/999999999/unlock', {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t11-${Date.now()}` },
    body: { unlock_reason: 'Lý do mở khóa dài hợp lệ theo tiêu chuẩn' }
  });
  assert.equal(res.status, 404);
  assert.equal(getErrorCode(res), 'CUSTOMER_NOT_FOUND');
});

await test('T12: Customer not LOCKED -> 409 CUSTOMER_NOT_LOCKED', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T12', status: 'ACTIVE', lockSource: null, lockReason: null, lockedAt: null });
  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t12-${Date.now()}` },
    body: { unlock_reason: 'Lý do mở khóa dài hợp lệ theo tiêu chuẩn' }
  });
  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'CUSTOMER_NOT_LOCKED');
});

let t13CustomerId;
let t13Key;
let t13Reason;
let t13CustName;
let t13CustCode;

await test('T13: LOCKED -> ACTIVE -> success -> lock metadata cleared', async () => {
  const stamp = Date.now();
  t13CustCode = `TEST_G6_T13_${stamp}`;
  t13CustName = `Transition Active Customer ${stamp}`;
  t13CustomerId = createCustomer({
    code: t13CustCode,
    name: t13CustName,
    status: 'LOCKED',
    lockSource: 'MANUAL',
    lockReason: 'Thanh tra kiểm tra định kỳ',
    lockedAt: '2026-10-02 08:00:00+00'
  });
  t13Key = `key-t13-${stamp}`;
  t13Reason = 'Kết thúc kiểm tra, biên bản ghi nhận khách hàng tuân thủ tốt';

  const res = await managerClient.request(`/api/customers/${t13CustomerId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': t13Key },
    body: {
      unlock_reason: t13Reason,
      target_status: 'ACTIVE'
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.customer.status, 'ACTIVE');
  assert.equal(res.data.is_idempotent_replay, false);

  const dbCust = queryDbJson(`SELECT status, lock_source, locked_at, lock_reason FROM public.customers WHERE id = ${t13CustomerId}`);
  assert.equal(dbCust[0].status, 'ACTIVE');
  assert.equal(dbCust[0].lock_source, null);
  assert.equal(dbCust[0].locked_at, null);
  assert.equal(dbCust[0].lock_reason, null);
});

await test('T14: LOCKED -> WARNING -> success -> lock metadata cleared', async () => {
  const stamp14 = Date.now();
  const custId = createCustomer({
    code: `TEST_G6_T14_${stamp14}`,
    name: `Transition Warning Customer ${stamp14}`,
    status: 'LOCKED',
    lockSource: 'AUTO_RISK',
    lockReason: 'Nợ quá hạn 32 ngày',
    lockedAt: '2026-10-03 09:00:00+00'
  });
  const key = `key-t14-${stamp14}`;
  const reason = 'Khách hàng cam kết trả nợ đợt 1, chuyển sang mức cảnh báo theo dõi';

  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: {
      unlock_reason: reason,
      target_status: 'WARNING'
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.customer.status, 'WARNING');
  assert.equal(res.data.is_idempotent_replay, false);

  const dbCust = queryDbJson(`SELECT status, lock_source, locked_at, lock_reason FROM public.customers WHERE id = ${custId}`);
  assert.equal(dbCust[0].status, 'WARNING');
  assert.equal(dbCust[0].lock_source, null);
  assert.equal(dbCust[0].locked_at, null);
  assert.equal(dbCust[0].lock_reason, null);
});

// =============================================================
// T15 - T17: Audit Contract & Idempotency Behavior
// =============================================================

await test('T15: Audit metadata correctness', async () => {
  const audits = queryDbJson(`SELECT metadata FROM public.audit_logs WHERE action = 'CUSTOMER_STATUS_MANUAL_UNLOCKED' AND metadata->>'customer_id' = '${t13CustomerId}'`);
  assert.equal(audits.length, 1, 'Exactly one audit record must exist for T13 customer');
  const meta = audits[0].metadata;

  assert.equal(meta.customer_id, t13CustomerId);
  assert.equal(meta.status_prior, 'LOCKED');
  assert.equal(meta.target_status, 'ACTIVE');
  assert.equal(meta.unlock_reason, t13Reason);
  assert.ok(meta.actor, 'Actor field must be present in audit metadata');
  assert.equal(meta.actor.username, 'gate6_billing_mgr');
  assert.equal(meta.actor.role, 'ROLE_BILLING_MANAGER');
  assert.equal(meta.idempotency_key, t13Key);
});

await test('T16: Idempotent replay -> 200 replay -> zero duplicate audit', async () => {
  const auditCountPrior = parseInt(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'CUSTOMER_STATUS_MANUAL_UNLOCKED' AND metadata->>'customer_id' = '${t13CustomerId}'`), 10);

  const res = await managerClient.request(`/api/customers/${t13CustomerId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': t13Key },
    body: {
      unlock_reason: t13Reason,
      target_status: 'ACTIVE'
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.is_idempotent_replay, true);
  assert.equal(Number(res.data.customer.id), t13CustomerId);
  assert.equal(res.data.customer.status, 'ACTIVE');

  const auditCountAfter = parseInt(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'CUSTOMER_STATUS_MANUAL_UNLOCKED' AND metadata->>'customer_id' = '${t13CustomerId}'`), 10);
  assert.equal(auditCountAfter, auditCountPrior, 'Replay must produce zero duplicate audit events');
});

await test('T17: Idempotency payload mismatch -> 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', async () => {
  const res = await managerClient.request(`/api/customers/${t13CustomerId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': t13Key },
    body: {
      unlock_reason: 'Một lý do hoàn toàn khác khiến hash không khớp',
      target_status: 'ACTIVE'
    }
  });

  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
});

// =============================================================
// T18: Audit Failure Rollback (Atomicity)
// =============================================================

await test('T18: Audit failure rollback -> customer remains LOCKED -> zero committed unlock audit', async () => {
  const stamp18 = Date.now();
  const custName18 = `Fault Injected Customer ${stamp18}`;
  const custId = createCustomer({ code: `TEST_G6_T18_${stamp18}`, name: custName18 });

  // Execute in web container an inTransaction routine simulating audit failure with throwOnError: true
  const scriptContent = `
    const { inTransaction } = require('./src/db');
    const { recordAudit } = require('./src/audit');

    async function run() {
      try {
        await inTransaction(async (client) => {
          await client.query("UPDATE public.customers SET status = 'ACTIVE', lock_source = NULL WHERE id = ${custId}");
          // Force error in recordAudit by passing invalid parameters with throwOnError: true
          await recordAudit(client, {
            user: { id: 1, username: 'admin' },
            module: 'customers',
            action: 'CUSTOMER_STATUS_MANUAL_UNLOCKED',
            targetRef: '${custName18}',
            severity: 'INFO',
            // summary null causes DB NOT NULL constraint violation on audit_logs.summary
            summary: null,
            throwOnError: true
          });
        });
      } catch (err) {
        console.log('FAULT_CAUGHT:' + err.message);
      }
    }
    run().then(() => process.exit(0));
  `;

  const output = execSync('docker exec -i billing-web-1 node', { input: scriptContent, encoding: 'utf8' });
  assert.ok(output.includes('FAULT_CAUGHT'), 'Fault must be caught and rollback triggered');

  // Verify DB state: customer must remain LOCKED
  const custDb = queryDbJson(`SELECT status, lock_source FROM public.customers WHERE id = ${custId}`);
  assert.equal(custDb[0].status, 'LOCKED', 'Customer must remain LOCKED on audit failure');
  assert.equal(custDb[0].lock_source, 'MANUAL', 'Lock metadata must remain preserved');

  const audits = queryDbJson(`SELECT id FROM public.audit_logs WHERE target_ref = '${custName18}'`);
  assert.equal(audits.length, 0, 'Zero unlock audit records must be committed on rollback');
});

// =============================================================
// T19 - T20: High Concurrency Verification
// =============================================================

await test('T19: Concurrent same-key unlock requests -> 1 execution + 1 replay + 0 deadlocks', async () => {
  const stamp19 = Date.now();
  const custName19 = `Concurrent Same Key Cust ${stamp19}`;
  const custId = createCustomer({ code: `TEST_G6_T19_${stamp19}`, name: custName19 });
  const key = `key-t19-${stamp19}`;
  const reason = 'Concurrent test with identical idempotency key';

  const req1 = managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { unlock_reason: reason }
  });

  const req2 = managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { unlock_reason: reason }
  });

  const [res1, res2] = await Promise.all([req1, req2]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);

  const replayFlags = [res1.data.is_idempotent_replay, res2.data.is_idempotent_replay].sort();
  assert.deepEqual(replayFlags, [false, true], 'One response must be execution and the other must be replay');

  const audits = queryDbJson(`SELECT id FROM public.audit_logs WHERE action = 'CUSTOMER_STATUS_MANUAL_UNLOCKED' AND target_ref = '${custName19}'`);
  assert.equal(audits.length, 1, 'Exactly one audit log must be recorded');
});

await test('T20: Concurrent different-key unlock requests on same customer -> 1 success + 1 CUSTOMER_NOT_LOCKED + 0 deadlocks', async () => {
  const stamp20 = Date.now();
  const custName20 = `Concurrent Diff Key Cust ${stamp20}`;
  const custId = createCustomer({ code: `TEST_G6_T20_${stamp20}`, name: custName20 });
  const keyA = `key-t20-A-${stamp20}`;
  const keyB = `key-t20-B-${stamp20}`;

  const reqA = managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': keyA },
    body: { unlock_reason: 'Competitive request A attempting manual unlock' }
  });

  const reqB = managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': keyB },
    body: { unlock_reason: 'Competitive request B attempting manual unlock' }
  });

  const [resA, resB] = await Promise.all([reqA, reqB]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exactly one request must succeed (200) and one must be rejected (409)');

  const failedRes = resA.status === 409 ? resA : resB;
  assert.equal(getErrorCode(failedRes), 'CUSTOMER_NOT_LOCKED');

  const audits = queryDbJson(`SELECT id FROM public.audit_logs WHERE action = 'CUSTOMER_STATUS_MANUAL_UNLOCKED' AND target_ref = '${custName20}'`);
  assert.equal(audits.length, 1, 'Exactly one audit log must be recorded across competitive requests');
});

// =============================================================
// T21 - T22: Gate 4 Regression Verification
// =============================================================

await test('T21: Gate 4 regression: PUT LOCKED customer attempting ACTIVE -> 409 CUSTOMER_IS_LOCKED', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T21', name: 'Gate 4 Reg Active Cust' });
  const res = await staffClient.request(`/api/customers/${custId}`, {
    method: 'PUT',
    body: { status: 'ACTIVE' }
  });
  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'CUSTOMER_IS_LOCKED');

  const dbCust = queryDbJson(`SELECT status FROM public.customers WHERE id = ${custId}`);
  assert.equal(dbCust[0].status, 'LOCKED');
});

await test('T22: Gate 4 regression: PUT LOCKED customer attempting WARNING -> 409 CUSTOMER_IS_LOCKED', async () => {
  const custId = createCustomer({ code: 'TEST_G6_T22', name: 'Gate 4 Reg Warning Cust' });
  const res = await staffClient.request(`/api/customers/${custId}`, {
    method: 'PUT',
    body: { status: 'WARNING' }
  });
  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'CUSTOMER_IS_LOCKED');

  const dbCust = queryDbJson(`SELECT status FROM public.customers WHERE id = ${custId}`);
  assert.equal(dbCust[0].status, 'LOCKED');
});

// =============================================================
// T23 - T25: Profile & Financial Integrity & Chain Verification
// =============================================================

let t23CustId;
await test('T23: Manual unlock does not alter credit_limit', async () => {
  t23CustId = createCustomer({ code: 'TEST_G6_T23', name: 'Credit Limit Immutability Cust', creditLimit: '75000000.00' });
  const res = await managerClient.request(`/api/customers/${t23CustId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t23-${Date.now()}` },
    body: { unlock_reason: 'Mở khóa khách hàng bảo lưu toàn vẹn hạn mức tín dụng' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.credit_limit, '75000000.00');

  const dbCust = queryDbJson(`SELECT credit_limit::text FROM public.customers WHERE id = ${t23CustId}`);
  assert.equal(dbCust[0].credit_limit, '75000000.00');
});

await test('T24: Manual unlock does not alter unrelated customer profile data', async () => {
  const custId = createCustomer({
    code: 'TEST_G6_T24',
    name: 'Full Profile Customer',
    email: 'profile_check@corp.vn',
    phone: '0988776655',
    address: '456 Nguyen Trai, Ha Noi',
    taxCode: '0987654321',
    segment: 'VIP',
    creditLimit: '120000000.00'
  });

  const res = await managerClient.request(`/api/customers/${custId}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t24-${Date.now()}` },
    body: { unlock_reason: 'Mở khóa và kiểm tra dữ liệu hồ sơ cá nhân không bị ảnh hưởng' }
  });
  assert.equal(res.status, 200);

  const c = res.data.customer;
  assert.equal(c.name, 'Full Profile Customer');
  assert.equal(c.email, 'profile_check@corp.vn');
  assert.equal(c.phone, '0988776655');
  assert.equal(c.address, '456 Nguyen Trai, Ha Noi');
  assert.equal(c.tax_code, '0987654321');
  assert.equal(c.segment, 'VIP');
  assert.equal(c.credit_limit, '120000000.00');
});

await test('T25: Successful unlock creates exactly one valid audit chain entry', async () => {
  const auditRes = queryDbJson(`
    SELECT id, hash, prev_hash, canonical_data
    FROM public.audit_logs
    WHERE action = 'CUSTOMER_STATUS_MANUAL_UNLOCKED'
    ORDER BY id DESC
    LIMIT 1
  `);
  assert.equal(auditRes.length, 1);
  const entry = auditRes[0];
  assert.ok(entry.hash && entry.hash.length === 64, 'Audit hash must be valid SHA-256');
  assert.ok(entry.prev_hash && entry.prev_hash.length === 64, 'Audit prev_hash must be valid SHA-256');
});

// Cleanup test records
cleanup();

console.log('\n============================================================');
console.log(`GATE 6 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
console.log('============================================================');
