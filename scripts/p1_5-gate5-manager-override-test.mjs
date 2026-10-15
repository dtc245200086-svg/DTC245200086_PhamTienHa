/**
 * BILLING_ONE — P1.5 GATE 5 TEST SUITE
 * MANAGER OVERRIDE ENDPOINT — CONTROLLED IMPLEMENTATION & FORENSIC VERIFICATION
 *
 * Verifies scenarios T01 - T25:
 * T01: Unauthenticated caller -> HTTP 401
 * T02: staff attempts override -> HTTP 403 FORBIDDEN
 * T03: ROLE_ACCOUNTANT attempts override -> HTTP 403 FORBIDDEN
 * T04: ROLE_AUDITOR attempts override -> HTTP 403 FORBIDDEN
 * T05: admin with valid reason + key -> HTTP 200
 * T06: ROLE_BILLING_MANAGER with valid reason + key -> HTTP 200
 * T07: Missing override_reason -> HTTP 400 OVERRIDE_REASON_REQUIRED
 * T08: Whitespace/short reason under 10 chars -> HTTP 400 OVERRIDE_REASON_REQUIRED
 * T09: Missing Idempotency-Key -> HTTP 400 IDEMPOTENCY_KEY_REQUIRED
 * T10: Idempotency-Key > 255 chars -> HTTP 400 INVALID_IDEMPOTENCY_KEY
 * T11: Manager overrides credit-limit breach -> HTTP 200 + ISSUED + INVOICE_ISSUE_OVERRIDDEN
 * T12: Manager overrides LOCKED customer -> HTTP 200 + ISSUED + customer remains LOCKED
 * T13: Override does not alter credit_limit
 * T14: Override does not alter lock_source / locked_at / lock_reason
 * T15: Audit metadata contains all 12 mandatory fields
 * T16: Replay identical request with same key -> HTTP 200 + is_idempotent_replay: true + 0 duplicate audit
 * T17: Same key + modified override_reason -> HTTP 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH
 * T18: Invoice not found -> HTTP 404 INVOICE_NOT_FOUND
 * T19: Invoice status != DRAFT -> HTTP 409 INVOICE_NOT_DRAFT
 * T20: DRAFT invoice with no line items -> HTTP 409 INVOICE_REQUIRES_ITEM + 0 audit
 * T21: Zero/negative invoice total -> HTTP 409 INVOICE_TOTAL_MUST_BE_POSITIVE + 0 audit
 * T22: Invalid due date -> HTTP 409 INVOICE_DUE_DATE_INVALID + 0 audit
 * T23: Concurrent identical requests with SAME Idempotency-Key -> 1 execution + 1 replay + 0 deadlocks
 * T24: Concurrent different-key requests targeting SAME invoice -> 1 success + 1 INVOICE_NOT_DRAFT + 0 deadlocks
 * T25: Successful override preserves exact financial snapshot precision
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
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await this.request('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      });
      if (res.status === 429) {
        console.log('[TEST_HARNESS] 429 encountered during login. Backing off 12s...');
        await new Promise(r => setTimeout(r, 12000));
        continue;
      }
      return res;
    }
    throw new Error('Login failed after maximum retries due to 429 rate limiting.');
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
console.log('BILLING_ONE — P1.5 GATE 5 MANAGER OVERRIDE SUITE (T01 - T25)');
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
const gate5BillingMgrPass = process.env.TEST_GATE5_BILLING_MGR_PASSWORD || 'Test_gate5_billing_mgr_Pass!2026';
const gate5AccountantPass = process.env.TEST_GATE5_ACCOUNTANT_PASSWORD || 'Test_gate5_accountant_Pass!2026';
const gate5AuditorPass = process.env.TEST_GATE5_AUDITOR_PASSWORD || 'Test_gate5_auditor_Pass!2026';

queryDb(`
  INSERT INTO public.users (username, password_hash, role)
  VALUES ('gate5_billing_mgr', crypt('${gate5BillingMgrPass}', gen_salt('bf', 10)), 'ROLE_BILLING_MANAGER')
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate5BillingMgrPass}', gen_salt('bf', 10)), role = 'ROLE_BILLING_MANAGER';
`);

queryDb(`
  INSERT INTO public.users (username, password_hash, role)
  VALUES ('gate5_accountant', crypt('${gate5AccountantPass}', gen_salt('bf', 10)), 'ROLE_ACCOUNTANT')
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate5AccountantPass}', gen_salt('bf', 10)), role = 'ROLE_ACCOUNTANT';
`);

queryDb(`
  INSERT INTO public.users (username, password_hash, role)
  VALUES ('gate5_auditor', crypt('${gate5AuditorPass}', gen_salt('bf', 10)), 'ROLE_AUDITOR')
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate5AuditorPass}', gen_salt('bf', 10)), role = 'ROLE_AUDITOR';
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

const loginManager = await managerClient.login('gate5_billing_mgr', gate5BillingMgrPass);
assert.equal(loginManager.status, 200, 'Manager login failed');

const loginAccountant = await accountantClient.login('gate5_accountant', gate5AccountantPass);
assert.equal(loginAccountant.status, 200, 'Accountant login failed');

const loginAuditor = await auditorClient.login('gate5_auditor', gate5AuditorPass);
assert.equal(loginAuditor.status, 200, 'Auditor login failed');

console.log('✓ All 5 authenticated role sessions established successfully\n');

// Helpers for test entity creation
function createCustomer({
  code,
  name = 'Test Gate5 Customer',
  status = 'ACTIVE',
  creditLimit = '50000000.00',
  lockSource = null,
  lockReason = null,
  lockedAt = null
}) {
  const lockSrcVal = lockSource ? `'${lockSource}'` : 'NULL';
  const lockRsnVal = lockReason ? `'${lockReason}'` : 'NULL';
  const lockedAtVal = lockedAt ? `'${lockedAt}'::timestamptz` : 'NULL';
  const out = queryDb(
    `INSERT INTO public.customers (code, name, status, credit_limit, lock_source, lock_reason, locked_at, created_at)
     VALUES ('${code}', '${name}', '${status}', ${creditLimit}, ${lockSrcVal}, ${lockRsnVal}, ${lockedAtVal}, NOW())
     RETURNING id;`
  );
  return parseInt(out, 10);
}

function createDraftInvoice({ customerId, total = '10000000.00', dueDate = '2026-12-31' }) {
  const invId = parseInt(
    queryDb(
      `INSERT INTO public.invoices (customer_id, status, due_date, subtotal, tax_amount, total, created_by, created_at)
       VALUES (${customerId}, 'DRAFT', '${dueDate}', ${total}, 0, ${total}, 1, NOW())
       RETURNING id;`
    ),
    10
  );

  queryDb(
    `INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
     VALUES (${invId}, 'Gate 5 Test Item', 1, ${total}, ${total});`
  );

  return invId;
}

function createOpenInvoice({ customerId, invoiceNo, total = '10000000.00', status = 'ISSUED' }) {
  const invId = parseInt(
    queryDb(
      `INSERT INTO public.invoices (customer_id, invoice_no, status, issue_date, due_date, subtotal, tax_amount, total, paid_total, adjusted_total, created_by, created_at)
       VALUES (${customerId}, '${invoiceNo}', '${status}', CURRENT_DATE, CURRENT_DATE + 30, ${total}, 0, ${total}, 0, 0, 1, NOW())
       RETURNING id;`
    ),
    10
  );

  queryDb(
    `INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
     VALUES (${invId}, 'Gate 5 Open Invoice Item', 1, ${total}, ${total});`
  );

  return invId;
}

// Cleanup helper
function cleanup() {
  queryDb(`DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'TEST_G5_%'));`);
  queryDb(`DELETE FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'TEST_G5_%');`);
  queryDb(`DELETE FROM public.customers WHERE code LIKE 'TEST_G5_%';`);
}

cleanup();

// Shared customer & invoice for initial tests
const baseCustId = createCustomer({ code: 'TEST_G5_BASE_01', name: 'Base Auth Customer' });
const baseDraftId = createDraftInvoice({ customerId: baseCustId });

// =============================================================
// T01 - T04: RBAC & Authentication Denial Matrix
// =============================================================

await test('T01: Unauthenticated caller -> HTTP 401', async () => {
  const res = await unauthClient.request(`/api/invoices/${baseDraftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t01' },
    body: { override_reason: 'Legitimate business reason for invoice issuance' }
  });
  assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
});

await test('T02: staff attempts override -> HTTP 403 FORBIDDEN', async () => {
  const res = await staffClient.request(`/api/invoices/${baseDraftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t02' },
    body: { override_reason: 'Legitimate business reason for invoice issuance' }
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

await test('T03: ROLE_ACCOUNTANT attempts override -> HTTP 403 FORBIDDEN', async () => {
  const res = await accountantClient.request(`/api/invoices/${baseDraftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t03' },
    body: { override_reason: 'Legitimate business reason for invoice issuance' }
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

await test('T04: ROLE_AUDITOR attempts override -> HTTP 403 FORBIDDEN', async () => {
  const res = await auditorClient.request(`/api/invoices/${baseDraftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-t04' },
    body: { override_reason: 'Legitimate business reason for invoice issuance' }
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

// =============================================================
// T05 - T06: Authorized Roles Allowed
// =============================================================

await test('T05: admin with valid reason + key -> HTTP 200', async () => {
  const custId = createCustomer({ code: 'TEST_G5_T05', name: 'Admin Override Customer' });
  const draftId = createDraftInvoice({ customerId: custId });
  const key = `key-t05-${Date.now()}`;
  const res = await adminClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: 'Admin authorization for urgent enterprise delivery' }
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.invoice.status, 'ISSUED');
  assert.equal(res.data.is_idempotent_replay, false);
});

await test('T06: ROLE_BILLING_MANAGER with valid reason + key -> HTTP 200', async () => {
  const custId = createCustomer({ code: 'TEST_G5_T06', name: 'Manager Override Customer' });
  const draftId = createDraftInvoice({ customerId: custId });
  const key = `key-t06-${Date.now()}`;
  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: 'Manager authorization for contract milestone payment' }
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.invoice.status, 'ISSUED');
  assert.equal(res.data.is_idempotent_replay, false);
});

// =============================================================
// T07 - T10: Request Contract Validation
// =============================================================

await test('T07: Missing override_reason -> HTTP 400 OVERRIDE_REASON_REQUIRED', async () => {
  const draftId = createDraftInvoice({ customerId: baseCustId });
  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t07-${Date.now()}` },
    body: {}
  });
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.equal(getErrorCode(res), 'OVERRIDE_REASON_REQUIRED');
});

await test('T08: Whitespace/short reason under 10 chars -> HTTP 400 OVERRIDE_REASON_REQUIRED', async () => {
  const draftId = createDraftInvoice({ customerId: baseCustId });
  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t08-${Date.now()}` },
    body: { override_reason: '   short   ' }
  });
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.equal(getErrorCode(res), 'OVERRIDE_REASON_REQUIRED');
});

await test('T09: Missing Idempotency-Key -> HTTP 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
  const draftId = createDraftInvoice({ customerId: baseCustId });
  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    body: { override_reason: 'Valid long enough justification string' }
  });
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.equal(getErrorCode(res), 'IDEMPOTENCY_KEY_REQUIRED');
});

await test('T10: Idempotency-Key > 255 chars -> HTTP 400 INVALID_IDEMPOTENCY_KEY', async () => {
  const draftId = createDraftInvoice({ customerId: baseCustId });
  const excessiveKey = 'k'.repeat(256);
  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': excessiveKey },
    body: { override_reason: 'Valid long enough justification string' }
  });
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.equal(getErrorCode(res), 'INVALID_IDEMPOTENCY_KEY');
});

// =============================================================
// T11 - T15: Credit Breach & Customer Status Isolation
// =============================================================

let t11Customer;
let t11DraftInvoiceId;
let t11Key;
let t11Response;

await test('T11: Manager overrides credit-limit breach -> HTTP 200 + ISSUED + INVOICE_ISSUE_OVERRIDDEN', async () => {
  // Customer limit = 50M, existing open invoice = 45M
  const custId = createCustomer({ code: 'TEST_G5_T11', name: 'Credit Breach Customer', creditLimit: '50000000.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV-T11-PRIOR', total: '45000000.00' });
  // New invoice = 15M (projected debt = 60M > 50M, breach = 10M)
  const draftId = createDraftInvoice({ customerId: custId, total: '15000000.00' });
  const key = `key-t11-${Date.now()}`;

  // Normal issue must be rejected
  const normalRes = await staffClient.request(`/api/invoices/${draftId}/issue`, { method: 'POST' });
  assert.equal(normalRes.status, 409, 'Normal issue should have been rejected');
  assert.equal(getErrorCode(normalRes), 'CREDIT_LIMIT_EXCEEDED');

  // Manager override must succeed
  const overrideReason = 'Phê duyệt bảo lãnh thanh toán vượt hạn mức theo quyết định số 45';
  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: overrideReason }
  });

  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.invoice.status, 'ISSUED');
  assert.equal(res.data.is_idempotent_replay, false);

  // Check audit record
  const audits = queryDbJson(`SELECT * FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN' AND target_ref = '${res.data.invoice.invoice_no}'`);
  assert.equal(audits.length, 1, 'Exactly one INVOICE_ISSUE_OVERRIDDEN audit record must exist');
  assert.equal(audits[0].severity, 'WARNING');

  t11Customer = custId;
  t11DraftInvoiceId = draftId;
  t11Key = key;
  t11Response = res.data;
});

let t12Customer;
let t12LockedAt;
let t12LockReason;

await test('T12: Manager overrides LOCKED customer -> HTTP 200 + ISSUED + customer remains LOCKED', async () => {
  t12LockReason = 'Tạm dừng xuất hóa đơn do tranh chấp hợp đồng';
  t12LockedAt = '2026-10-01 10:00:00+00';
  const custId = createCustomer({
    code: 'TEST_G5_T12',
    name: 'Locked Customer Co',
    status: 'LOCKED',
    creditLimit: '100000000.00',
    lockSource: 'MANUAL',
    lockReason: t12LockReason,
    lockedAt: t12LockedAt
  });
  const draftId = createDraftInvoice({ customerId: custId, total: '20000000.00' });
  const key = `key-t12-${Date.now()}`;

  // Normal issue must be rejected
  const normalRes = await staffClient.request(`/api/invoices/${draftId}/issue`, { method: 'POST' });
  assert.equal(normalRes.status, 409, 'Normal issue should have been rejected for locked customer');
  assert.equal(getErrorCode(normalRes), 'CUSTOMER_IS_LOCKED');

  // Manager override succeeds
  const overrideReason = 'Ban Giám đốc chỉ đạo xuất hóa đơn đặc thù cho khách hàng đang tranh chấp';
  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: overrideReason }
  });

  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  assert.equal(res.data.invoice.status, 'ISSUED');

  // Verify customer remains LOCKED
  const custDb = queryDbJson(`SELECT status, lock_source, lock_reason, locked_at FROM public.customers WHERE id = ${custId}`);
  assert.equal(custDb[0].status, 'LOCKED', 'Customer must remain LOCKED');

  t12Customer = custId;
});

await test('T13: Override does not alter credit_limit', async () => {
  const cust11 = queryDbJson(`SELECT credit_limit::text FROM public.customers WHERE id = ${t11Customer}`);
  assert.equal(cust11[0].credit_limit, '50000000.00', 'Credit limit of T11 customer must not change');

  const cust12 = queryDbJson(`SELECT credit_limit::text FROM public.customers WHERE id = ${t12Customer}`);
  assert.equal(cust12[0].credit_limit, '100000000.00', 'Credit limit of T12 customer must not change');
});

await test('T14: Override does not alter lock_source / locked_at / lock_reason', async () => {
  const cust12 = queryDbJson(`SELECT lock_source, lock_reason, locked_at::timestamptz::text FROM public.customers WHERE id = ${t12Customer}`);
  assert.equal(cust12[0].lock_source, 'MANUAL');
  assert.equal(cust12[0].lock_reason, t12LockReason);
  assert.ok(cust12[0].locked_at, 'locked_at must be preserved');
});

await test('T15: Audit metadata contains all 12 mandatory fields', async () => {
  const audits = queryDbJson(`SELECT metadata FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN' AND target_ref = '${t11Response.invoice.invoice_no}'`);
  assert.equal(audits.length, 1);
  const meta = audits[0].metadata;

  const requiredFields = [
    'invoice_id',
    'invoice_no',
    'customer_id',
    'customer_name',
    'customer_status',
    'credit_limit',
    'current_debt',
    'invoice_total',
    'projected_debt',
    'amount_over_limit',
    'override_reason',
    'idempotency_key'
  ];

  for (const field of requiredFields) {
    assert.ok(meta[field] !== undefined && meta[field] !== null, `Missing field in metadata: ${field}`);
  }

  assert.equal(meta.invoice_id, t11DraftInvoiceId);
  assert.equal(meta.invoice_no, t11Response.invoice.invoice_no);
  assert.equal(meta.customer_id, t11Customer);
  assert.equal(meta.credit_limit, '50000000.00');
  assert.equal(meta.current_debt, '45000000.00');
  assert.equal(meta.invoice_total, '15000000.00');
  assert.equal(meta.projected_debt, '60000000.00');
  assert.equal(meta.amount_over_limit, '10000000.00');
  assert.equal(meta.idempotency_key, t11Key);
});

// =============================================================
// T16 - T17: Idempotency Replay & Fingerprint Mismatch
// =============================================================

await test('T16: Replay identical request with same key -> HTTP 200 + is_idempotent_replay: true', async () => {
  const auditCountPrior = parseInt(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN' AND target_ref = '${t11Response.invoice.invoice_no}'`), 10);

  const res = await managerClient.request(`/api/invoices/${t11DraftInvoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': t11Key },
    body: { override_reason: 'Phê duyệt bảo lãnh thanh toán vượt hạn mức theo quyết định số 45' }
  });

  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  assert.equal(res.data.is_idempotent_replay, true);
  assert.equal(res.data.invoice.invoice_no, t11Response.invoice.invoice_no);

  const auditCountAfter = parseInt(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN' AND target_ref = '${t11Response.invoice.invoice_no}'`), 10);
  assert.equal(auditCountAfter, auditCountPrior, 'Replay must produce zero duplicate audit events');
});

await test('T17: Same key + modified override_reason -> HTTP 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', async () => {
  const res = await managerClient.request(`/api/invoices/${t11DraftInvoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': t11Key },
    body: { override_reason: 'A completely different justification text that causes hash mismatch' }
  });

  assert.equal(res.status, 409, `Expected 409, got ${res.status}`);
  assert.equal(getErrorCode(res), 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
});

// =============================================================
// T18 - T22: Invoice State & Integrity Validations
// =============================================================

await test('T18: Invoice not found -> HTTP 404 INVOICE_NOT_FOUND', async () => {
  const res = await managerClient.request('/api/invoices/999999999/issue-override', {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t18-${Date.now()}` },
    body: { override_reason: 'Legitimate business reason for invoice issuance' }
  });
  assert.equal(res.status, 404);
  assert.equal(getErrorCode(res), 'INVOICE_NOT_FOUND');
});

await test('T19: Invoice status != DRAFT -> HTTP 409 INVOICE_NOT_DRAFT', async () => {
  // Use t11 invoice which is now ISSUED
  const res = await managerClient.request(`/api/invoices/${t11DraftInvoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `key-t19-${Date.now()}` },
    body: { override_reason: 'Attempting to override an already issued invoice' }
  });
  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'INVOICE_NOT_DRAFT');
});

await test('T20: DRAFT invoice with no line items -> HTTP 409 INVOICE_REQUIRES_ITEM + 0 audit', async () => {
  const custId = createCustomer({ code: 'TEST_G5_T20', name: 'No Item Customer' });
  const invId = parseInt(
    queryDb(`INSERT INTO public.invoices (customer_id, status, due_date, subtotal, tax_amount, total, created_by, created_at)
             VALUES (${custId}, 'DRAFT', '2026-12-31', 10000000.00, 0, 10000000.00, 1, NOW()) RETURNING id;`),
    10
  );
  const key = `key-t20-${Date.now()}`;
  const auditsBefore = parseInt(queryDb("SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN'"), 10);

  const res = await managerClient.request(`/api/invoices/${invId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: 'Override without items should fail validation' }
  });

  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'INVOICE_REQUIRES_ITEM');

  const auditsAfter = parseInt(queryDb("SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN'"), 10);
  assert.equal(auditsAfter, auditsBefore, 'No audit record should be created on rejection');
});

await test('T21: Zero/negative invoice total -> HTTP 409 INVOICE_TOTAL_MUST_BE_POSITIVE + 0 audit', async () => {
  const custId = createCustomer({ code: 'TEST_G5_T21', name: 'Zero Total Customer' });
  const invId = parseInt(
    queryDb(`INSERT INTO public.invoices (customer_id, status, due_date, subtotal, tax_amount, total, created_by, created_at)
             VALUES (${custId}, 'DRAFT', '2026-12-31', 0, 0, 0, 1, NOW()) RETURNING id;`),
    10
  );
  queryDb(`INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
           VALUES (${invId}, 'Zero Price Item', 1, 0, 0);`);
  const key = `key-t21-${Date.now()}`;
  const auditsBefore = parseInt(queryDb("SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN'"), 10);

  const res = await managerClient.request(`/api/invoices/${invId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: 'Override with zero total should fail validation' }
  });

  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'INVOICE_TOTAL_MUST_BE_POSITIVE');

  const auditsAfter = parseInt(queryDb("SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN'"), 10);
  assert.equal(auditsAfter, auditsBefore);
});

await test('T22: Invalid due date -> HTTP 409 INVOICE_DUE_DATE_INVALID + 0 audit', async () => {
  const custId = createCustomer({ code: 'TEST_G5_T22', name: 'Past Due Date Customer' });
  const invId = parseInt(
    queryDb(`INSERT INTO public.invoices (customer_id, status, due_date, subtotal, tax_amount, total, created_by, created_at)
             VALUES (${custId}, 'DRAFT', '2020-01-01', 10000000.00, 0, 10000000.00, 1, NOW()) RETURNING id;`),
    10
  );
  queryDb(`INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
           VALUES (${invId}, 'Item with past due date', 1, 10000000.00, 10000000.00);`);
  const key = `key-t22-${Date.now()}`;
  const auditsBefore = parseInt(queryDb("SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN'"), 10);

  const res = await managerClient.request(`/api/invoices/${invId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: 'Override with past due date should fail validation' }
  });

  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'INVOICE_DUE_DATE_INVALID');

  const auditsAfter = parseInt(queryDb("SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN'"), 10);
  assert.equal(auditsAfter, auditsBefore);
});

// =============================================================
// T23 - T24: High-Concurrency & Lock Order Verification
// =============================================================

await test('T23: Two concurrent identical requests with SAME Idempotency-Key -> 1 execution + 1 replay + 0 deadlocks', async () => {
  const custId = createCustomer({ code: 'TEST_G5_T23', name: 'Concurrent Same Key Customer', status: 'LOCKED' });
  const invId = createDraftInvoice({ customerId: custId, total: '25000000.00' });
  const key = `key-t23-same-${Date.now()}`;
  const reason = 'Concurrent execution test for same idempotency key';

  const req1 = managerClient.request(`/api/invoices/${invId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: reason }
  });

  const req2 = managerClient.request(`/api/invoices/${invId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: reason }
  });

  const [res1, res2] = await Promise.all([req1, req2]);

  assert.equal(res1.status, 200, `res1 status ${res1.status}: ${JSON.stringify(res1.data)}`);
  assert.equal(res2.status, 200, `res2 status ${res2.status}: ${JSON.stringify(res2.data)}`);

  const replayFlags = [res1.data.is_idempotent_replay, res2.data.is_idempotent_replay].sort();
  assert.deepEqual(replayFlags, [false, true], 'One response must be original execution and the other must be replay');

  const invNo = res1.data.invoice.invoice_no;
  const audits = queryDbJson(`SELECT id FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN' AND target_ref = '${invNo}'`);
  assert.equal(audits.length, 1, 'Exactly one audit record must be generated');
});

await test('T24: Two concurrent different-key requests targeting SAME invoice -> 1 success + 1 INVOICE_NOT_DRAFT + 0 deadlocks', async () => {
  const custId = createCustomer({ code: 'TEST_G5_T24', name: 'Concurrent Diff Key Customer', status: 'LOCKED' });
  const invId = createDraftInvoice({ customerId: custId, total: '35000000.00' });
  const keyA = `key-t24-A-${Date.now()}`;
  const keyB = `key-t24-B-${Date.now()}`;

  const reqA = managerClient.request(`/api/invoices/${invId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': keyA },
    body: { override_reason: 'Competitive request A attempting invoice override' }
  });

  const reqB = managerClient.request(`/api/invoices/${invId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': keyB },
    body: { override_reason: 'Competitive request B attempting invoice override' }
  });

  const [resA, resB] = await Promise.all([reqA, reqB]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exactly one request must succeed (200) and one must be rejected (409)');

  const failedRes = resA.status === 409 ? resA : resB;
  assert.equal(getErrorCode(failedRes), 'INVOICE_NOT_DRAFT', 'Failed request must receive INVOICE_NOT_DRAFT');

  const successRes = resA.status === 200 ? resA : resB;
  const invNo = successRes.data.invoice.invoice_no;
  const audits = queryDbJson(`SELECT id FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN' AND target_ref = '${invNo}'`);
  assert.equal(audits.length, 1, 'Exactly one audit record must be generated across the two competitive requests');
});

// =============================================================
// T25: Financial Snapshot Precision Preservation
// =============================================================

await test('T25: Successful override preserves exact financial snapshot precision', async () => {
  // Limit = 100M, Debt = 85M, Invoice = 30M -> Projected Debt = 115M, Over Limit = 15M
  const custId = createCustomer({ code: 'TEST_G5_T25', name: 'Financial Precision Customer', creditLimit: '100000000.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV-T25-PRIOR', total: '85000000.00' });
  const draftId = createDraftInvoice({ customerId: custId, total: '30000000.00' });
  const key = `key-t25-${Date.now()}`;

  const res = await managerClient.request(`/api/invoices/${draftId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { override_reason: 'Phê duyệt hạn mức bổ sung cho hợp đồng thiết bị viễn thông' }
  });

  assert.equal(res.status, 200);
  const invNo = res.data.invoice.invoice_no;

  const audits = queryDbJson(`SELECT metadata FROM public.audit_logs WHERE action = 'INVOICE_ISSUE_OVERRIDDEN' AND target_ref = '${invNo}'`);
  assert.equal(audits.length, 1);
  const meta = audits[0].metadata;

  assert.equal(meta.credit_limit, '100000000.00');
  assert.equal(meta.current_debt, '85000000.00');
  assert.equal(meta.invoice_total, '30000000.00');
  assert.equal(meta.projected_debt, '115000000.00');
  assert.equal(meta.amount_over_limit, '15000000.00');
});

// Clean up test data
cleanup();

console.log('\n============================================================');
console.log(`GATE 5 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
console.log('============================================================');
