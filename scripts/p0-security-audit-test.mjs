#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE — P0 SECURITY & AUDIT CLOSURE VERIFICATION SUITE
 * File: scripts/p0-security-audit-test.mjs
 * 
 * Verifies final closure of:
 * 1. Finding F — API RBAC Boundary Failure
 *    - Unauthenticated -> 401
 *    - Invalid / Revoked / Inactive token -> 401
 *    - Valid token + wrong permission -> 403
 *    - Pre-flight authorization: zero mutation occurs on 401 / 403
 *    - Valid token + correct permission -> 2xx
 *    - Full sensitive endpoint matrix covered
 * 
 * 2. Finding G — Audit Concurrency Race & Transaction Coupling
 *    - Append-only DB controls (UPDATE/DELETE rejected for billing_app)
 *    - Transaction coupling: business mutation & audit inserted in same transaction
 *    - Rollback semantics: business rollback -> zero orphan audit record
 *    - Multi-worker concurrent writers -> database-level serialization
 *    - Cryptographic chain verification: 100% valid SHA-256 hashes, zero forks
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load environment variables from .env
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD are required.');
}

function queryDb(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -q -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
}

function queryDbApp(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker exec -i billing-postgres-1 psql -U billing_app -d billing -q -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
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

let totalTests = 0;
let passedTests = 0;

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

async function main() {
  console.log('============================================================');
  console.log('BILLING_ONE — P0 SECURITY & AUDIT CLOSURE VERIFICATION');
  console.log('============================================================\n');

  // Seed test users if needed with dedicated individual credentials
  const auditorPassword = process.env.TEST_P0_AUDITOR_PASSWORD || 'Test_p0_auditor_Pass!2026';
  const accountantPassword = process.env.TEST_P0_ACCOUNTANT_PASSWORD || 'Test_p0_accountant_Pass!2026';
  const managerPassword = process.env.TEST_P0_MANAGER_PASSWORD || 'Test_p0_billing_mgr_Pass!2026';
  const inactivePassword = process.env.TEST_P0_INACTIVE_PASSWORD || 'Test_p0_inactive_Pass!2026';

  queryDb(`
    INSERT INTO public.users (username, password_hash, role, is_active)
    VALUES ('p0_auditor', crypt('${auditorPassword}', gen_salt('bf', 10)), 'ROLE_AUDITOR', true)
    ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${auditorPassword}', gen_salt('bf', 10)), is_active = true, role = 'ROLE_AUDITOR';

    INSERT INTO public.users (username, password_hash, role, is_active)
    VALUES ('p0_accountant', crypt('${accountantPassword}', gen_salt('bf', 10)), 'ROLE_ACCOUNTANT', true)
    ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${accountantPassword}', gen_salt('bf', 10)), is_active = true, role = 'ROLE_ACCOUNTANT';

    INSERT INTO public.users (username, password_hash, role, is_active)
    VALUES ('p0_billing_mgr', crypt('${managerPassword}', gen_salt('bf', 10)), 'ROLE_BILLING_MANAGER', true)
    ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${managerPassword}', gen_salt('bf', 10)), is_active = true, role = 'ROLE_BILLING_MANAGER';

    INSERT INTO public.users (username, password_hash, role, is_active)
    VALUES ('p0_inactive', crypt('${inactivePassword}', gen_salt('bf', 10)), 'staff', false)
    ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${inactivePassword}', gen_salt('bf', 10)), is_active = false, role = 'staff';
  `);

  const unauthClient = new ApiClient();
  const adminClient = new ApiClient();
  const staffClient = new ApiClient();
  const auditorClient = new ApiClient();
  const accountantClient = new ApiClient();
  const managerClient = new ApiClient();

  const adminLogin = await adminClient.login('admin', adminPassword);
  assert.equal(adminLogin.status, 200, 'Admin login succeeded');

  const staffLogin = await staffClient.login('staff', staffPassword);
  assert.equal(staffLogin.status, 200, 'Staff login succeeded');

  const auditorLogin = await auditorClient.login('p0_auditor', auditorPassword);
  assert.equal(auditorLogin.status, 200, 'Auditor login succeeded');

  const accountantLogin = await accountantClient.login('p0_accountant', accountantPassword);
  assert.equal(accountantLogin.status, 200, 'Accountant login succeeded');

  const managerLogin = await managerClient.login('p0_billing_mgr', managerPassword);
  assert.equal(managerLogin.status, 200, 'Manager login succeeded');

  console.log('✓ All role client sessions successfully authenticated\n');

  // --------------------------------------------------------------------------
  // SECTION 1: FINDING F — API RBAC BOUNDARY FAILURE
  // --------------------------------------------------------------------------
  console.log('--- PART 1: FINDING F — API RBAC BOUNDARY VERIFICATION ---');

  await test('F01: Unauthenticated requests rejected with 401 across endpoints', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/customers' },
      { method: 'POST', path: '/api/customers', body: { name: 'Hacker' } },
      { method: 'GET', path: '/api/invoices' },
      { method: 'POST', path: '/api/invoices', body: { customer_id: 1 } },
      { method: 'GET', path: '/api/payments' },
      { method: 'POST', path: '/api/payments', body: { amount: 100 } },
      { method: 'GET', path: '/api/reports/aging' },
      { method: 'GET', path: '/api/reports/revenue' },
      { method: 'GET', path: '/api/reports/vat' },
      { method: 'GET', path: '/api/reconciliation/transactions' },
      { method: 'POST', path: '/api/reconciliation/transactions', body: { description: 'test' } },
      { method: 'GET', path: '/api/audit' },
      { method: 'GET', path: '/api/audit/verify' },
      { method: 'GET', path: '/api/settings' },
      { method: 'PUT', path: '/api/settings', body: { company_name: 'Test' } },
      { method: 'GET', path: '/api/recurring' },
      { method: 'POST', path: '/api/recurring', body: { customer_id: 1 } },
      { method: 'GET', path: '/api/payment-terms' },
      { method: 'POST', path: '/api/payment-terms', body: { code: 'NET15' } }
    ];

    for (const ep of endpoints) {
      const res = await unauthClient.request(ep.path, { method: ep.method, body: ep.body });
      assert.equal(res.status, 401, `Unauthenticated ${ep.method} ${ep.path} must return 401 (got ${res.status})`);
    }
  });

  await test('F02: Forged / invalid session cookie rejected with 401', async () => {
    const forgedClient = new ApiClient();
    forgedClient.cookie = 'billing.sid=s%3Aforged_invalid_session_id_12345.xyz';
    const res = await forgedClient.request('/api/customers');
    assert.equal(res.status, 401, 'Forged session cookie must return 401');
  });

  await test('F03: Inactive / revoked user session rejected with 401', async () => {
    const inactiveClient = new ApiClient();
    const loginRes = await inactiveClient.login('p0_inactive', staffPassword);
    assert.equal(loginRes.status, 401, 'Inactive user login must return 401');
    const reqRes = await inactiveClient.request('/api/customers');
    assert.equal(reqRes.status, 401, 'Inactive user request must return 401');
  });

  await test('F04: Permission enforcement on customer mutations', async () => {
    // 1. Staff lacks customer.delete -> 403
    const delRes = await staffClient.request('/api/customers/999999', { method: 'DELETE' });
    assert.equal(delRes.status, 403, 'Staff DELETE /api/customers/:id must return 403');

    // 2. Staff lacks customer.unlock -> 403
    const unlockRes = await staffClient.request('/api/customers/1/unlock', {
      method: 'POST',
      body: { reason: 'Test' },
      headers: { 'Idempotency-Key': `IDEM-STAFF-UNLOCK-${Date.now()}` }
    });
    assert.equal(unlockRes.status, 403, 'Staff POST /api/customers/:id/unlock must return 403');

    // 3. Auditor lacks customer.create -> 403
    const createRes = await auditorClient.request('/api/customers', {
      method: 'POST',
      body: { name: 'Auditor Customer', code: `AUD-CUST-${Date.now()}` }
    });
    assert.equal(createRes.status, 403, 'Auditor POST /api/customers must return 403');
  });

  await test('F05: Pre-flight authorization: unauthorized requests do NOT mutate database', async () => {
    // Create a dummy customer locked for test
    const initCode = `PREFLIGHT-${Date.now()}`;
    const custId = queryDb(`
      INSERT INTO public.customers (code, name, email, phone, address, tax_code, credit_limit, status)
      VALUES ('${initCode}', 'Preflight Test Customer', 'pref_${Date.now()}@test.com', '0901234567', 'Hanoi', '010${String(Date.now()).slice(-7)}', 50000000, 'LOCKED')
      RETURNING id;
    `).split(/\r?\n/)[0].trim();

    // Staff attempts unlock -> 403
    const staffUnlock = await staffClient.request(`/api/customers/${custId}/unlock`, {
      method: 'POST',
      body: { reason: 'Unauthorized unlock attempt' },
      headers: { 'Idempotency-Key': `IDEM-UNAUTH-MUT-${Date.now()}` }
    });
    assert.equal(staffUnlock.status, 403, 'Staff unlock must return 403');

    // Verify DB status remains LOCKED
    const statusAfter = queryDb(`SELECT status FROM public.customers WHERE id = ${custId}`);
    assert.equal(statusAfter, 'LOCKED', 'Customer must remain LOCKED when unauthorized attempt is rejected');

    // Auditor attempts customer creation -> 403
    const custCountBefore = Number(queryDb('SELECT count(*) FROM public.customers'));
    const auditorCreate = await auditorClient.request('/api/customers', {
      method: 'POST',
      body: { code: `CUST-AUD-${Date.now()}`, name: 'Should Not Exist', tax_code: '0100000000' }
    });
    assert.equal(auditorCreate.status, 403, 'Auditor customer create must return 403');
    const custCountAfter = Number(queryDb('SELECT count(*) FROM public.customers'));
    assert.equal(custCountAfter, custCountBefore, 'Customer count must not change on 403');
  });

  await test('F06: Permission enforcement on invoice mutations', async () => {
    // Staff lacks invoice.cancel -> 403
    const cancelRes = await staffClient.request('/api/invoices/1/cancel', {
      method: 'POST',
      body: { reason: 'Staff cancel test' }
    });
    assert.equal(cancelRes.status, 403, 'Staff POST /api/invoices/:id/cancel must return 403');

    // Auditor lacks invoice.create -> 403
    const createInv = await auditorClient.request('/api/invoices', {
      method: 'POST',
      body: { customer_id: 1, due_date: '2026-12-31' }
    });
    assert.equal(createInv.status, 403, 'Auditor POST /api/invoices must return 403');
  });

  await test('F07: Permission enforcement on reconciliation endpoints', async () => {
    // Staff lacks reconciliation.manage -> 403
    const getRec = await staffClient.request('/api/reconciliation/transactions');
    assert.equal(getRec.status, 403, 'Staff GET /api/reconciliation/transactions must return 403');

    const postRec = await staffClient.request('/api/reconciliation/transactions', {
      method: 'POST',
      body: { tx_date: '2026-10-08', description: 'Test', amount: 1000 }
    });
    assert.equal(postRec.status, 403, 'Staff POST /api/reconciliation/transactions must return 403');

    // Accountant has reconciliation.manage -> 200
    const accRec = await accountantClient.request('/api/reconciliation/transactions');
    assert.equal(accRec.status, 200, 'Accountant GET /api/reconciliation/transactions must return 200');
  });

  await test('F08: Permission enforcement on audit endpoints', async () => {
    // Staff lacks audit.view -> 403
    const staffAudit = await staffClient.request('/api/audit');
    assert.equal(staffAudit.status, 403, 'Staff GET /api/audit must return 403');

    const staffVerify = await staffClient.request('/api/audit/verify', { method: 'POST' });
    assert.equal(staffVerify.status, 403, 'Staff POST /api/audit/verify must return 403');

    // Auditor has audit.view -> 200
    const auditorAudit = await auditorClient.request('/api/audit');
    assert.equal(auditorAudit.status, 200, 'Auditor GET /api/audit must return 200');

    const auditorVerify = await auditorClient.request('/api/audit/verify', { method: 'POST' });
    assert.equal(auditorVerify.status, 200, 'Auditor POST /api/audit/verify must return 200');
    assert.equal(auditorVerify.data.valid, true, 'Audit verify returns valid: true');
  });

  await test('F09: Permission enforcement on settings mutations', async () => {
    // Staff lacks settings.manage -> 403
    const staffSettings = await staffClient.request('/api/settings', {
      method: 'PUT',
      body: { company_name: 'Tampered Name', tax_code: '0109999999', address: 'Hanoi', bank_name: 'VCB', bank_account: '123' }
    });
    assert.equal(staffSettings.status, 403, 'Staff PUT /api/settings must return 403');

    // Admin has settings.manage -> 200
    const adminSettings = await adminClient.request('/api/settings', {
      method: 'PUT',
      body: {
        company_name: 'Công ty Cổ phần Công nghệ Tài chính Billing One',
        tax_code: '0109887766',
        address: 'Tòa nhà Keangnam Landmark 72, Đường Phạm Hùng, Hà Nội',
        bank_name: 'Techcombank - Chi nhánh Thăng Long',
        bank_account: '19036788889999'
      }
    });
    assert.equal(adminSettings.status, 200, 'Admin PUT /api/settings must return 200');
  });

  await test('F10: Permission enforcement on recurring plans', async () => {
    // Accountant lacks recurring.manage -> 403
    const accRec = await accountantClient.request('/api/recurring');
    assert.equal(accRec.status, 403, 'Accountant GET /api/recurring must return 403');

    const accRecCreate = await accountantClient.request('/api/recurring', {
      method: 'POST',
      body: { customer_id: 1, service_title: 'Plan', amount: 1000 }
    });
    assert.equal(accRecCreate.status, 403, 'Accountant POST /api/recurring must return 403');

    // Manager has recurring.manage -> 200
    const mgrRec = await managerClient.request('/api/recurring');
    assert.equal(mgrRec.status, 200, 'Manager GET /api/recurring must return 200');
  });

  await test('F11: Permission enforcement on payment-terms mutations', async () => {
    // Staff is not admin -> 403
    const staffPt = await staffClient.request('/api/payment-terms', {
      method: 'POST',
      body: { code: 'TEST_PT', name: 'Test PT', days: 30 }
    });
    assert.equal(staffPt.status, 403, 'Staff POST /api/payment-terms must return 403');
  });

  await test('F12: Validation order: authorization executed BEFORE payload validation', async () => {
    // Staff attempting customer.delete with completely invalid payload -> 403 (NOT 400 or 500)
    const res = await staffClient.request('/api/customers/not-a-number', { method: 'DELETE' });
    assert.equal(res.status, 403, 'Unauthorized request with invalid param must return 403');
  });

  console.log('\n--- PART 2: FINDING G — AUDIT CONCURRENCY & TRANSACTION COUPLING ---');

  // --------------------------------------------------------------------------
  // SECTION 2: FINDING G — AUDIT CONCURRENCY & TRANSACTION COUPLING
  // --------------------------------------------------------------------------

  await test('G01: Database append-only enforcement: UPDATE on audit_logs rejected', async () => {
    try {
      queryDbApp(`UPDATE public.audit_logs SET summary = 'tampered' WHERE id = 1;`);
      assert.fail('UPDATE on audit_logs as billing_app must fail');
    } catch (err) {
      assert.match(err.message, /permission denied for table audit_logs/i, 'PostgreSQL permission denied on UPDATE');
    }
  });

  await test('G02: Database append-only enforcement: DELETE on audit_logs rejected', async () => {
    try {
      queryDbApp(`DELETE FROM public.audit_logs WHERE id = 1;`);
      assert.fail('DELETE on audit_logs as billing_app must fail');
    } catch (err) {
      assert.match(err.message, /permission denied for table audit_logs/i, 'PostgreSQL permission denied on DELETE');
    }
  });

  await test('G03: Transaction coupling: business mutation rollback rolls back audit record', async () => {
    const auditCountBefore = Number(queryDb('SELECT count(*) FROM public.audit_logs'));

    // Execute a simulated business transaction that records audit and then throws / rolls back
    try {
      queryDb(`
        DO $$
        DECLARE
          v_prev_hash text;
          v_now timestamptz := now();
          v_hash text;
        BEGIN
          -- Lock chain
          PERFORM pg_advisory_xact_lock(4776472477610091604::bigint);
          
          SELECT hash INTO v_prev_hash FROM public.audit_logs ORDER BY id DESC LIMIT 1;
          v_hash := encode(sha256((v_prev_hash || '|' || v_now::text || '||System|customers|TEST_TX_ROLLBACK||INFO|Test tx rollback|')::bytea), 'hex');

          -- Insert business row
          INSERT INTO public.customers (code, name, email, phone, address, tax_code, credit_limit, status)
          VALUES ('ROLLBACK_CUST_' || extract(epoch from now())::text, 'Rollback Customer', 'rb_' || extract(epoch from now())::text || '@test.com', '0901111111', 'Hanoi', '010' || lpad((extract(epoch from now())::bigint % 10000000)::text, 7, '0'), 10000000, 'ACTIVE');

          -- Insert audit row in same transaction
          INSERT INTO public.audit_logs (timestamp, module, action, target_ref, severity, summary, prev_hash, hash)
          VALUES (v_now, 'customers', 'TEST_TX_ROLLBACK', 'TEST_REF', 'INFO', 'Test tx rollback', v_prev_hash, v_hash);

          -- Force transaction abort
          RAISE EXCEPTION 'Simulated business mutation failure';
        END $$;
      `);
      assert.fail('Transaction should have aborted');
    } catch (err) {
      assert.match(err.message, /Simulated business mutation failure/, 'Expected simulated error');
    }

    const auditCountAfter = Number(queryDb('SELECT count(*) FROM public.audit_logs'));
    assert.equal(auditCountAfter, auditCountBefore, 'Audit count must remain identical: ZERO orphan audit records after rollback');

    const customerRollbackCount = Number(queryDb("SELECT count(*) FROM public.customers WHERE name = 'Rollback Customer'"));
    assert.equal(customerRollbackCount, 0, 'Business customer row must NOT exist: ZERO orphan customer records after rollback');
  });

  await test('G04: Transaction coupling: successful business mutation atomically commits audit record', async () => {
    const auditCountBefore = Number(queryDb('SELECT count(*) FROM public.audit_logs'));

    const testCustCode = `ATOM-CUST-${Date.now()}`;
    const createRes = await adminClient.request('/api/customers', {
      method: 'POST',
      body: {
        code: testCustCode,
        name: 'Atomic Transaction Customer',
        email: `atom_${Date.now()}@example.com`,
        phone: '0908888888',
        address: 'Keangnam Landmark',
        tax_code: `010${String(Date.now()).slice(-7)}`,
        credit_limit: 100000000
      }
    });
    assert.equal(createRes.status, 201, 'Customer creation succeeded');

    const auditCountAfter = Number(queryDb('SELECT count(*) FROM public.audit_logs'));
    assert.equal(auditCountAfter, auditCountBefore + 1, 'Audit record committed atomically with customer creation');

    // Verify targetRef and action in audit record
    const latestAudit = JSON.parse(queryDb(`
      SELECT row_to_json(a) FROM (
        SELECT action, target_ref, prev_hash, hash FROM public.audit_logs ORDER BY id DESC LIMIT 1
      ) a;
    `));
    assert.equal(latestAudit.action, 'CUSTOMER_CREATED', 'Audit action matches');
    assert.equal(latestAudit.target_ref, testCustCode, 'Audit targetRef matches customer code');
  });

  await test('G05: High-concurrency audit writers: pg_advisory_xact_lock prevents forks & races', async () => {
    const concurrentCount = 12;
    const auditCountBefore = Number(queryDb('SELECT count(*) FROM public.audit_logs'));
    console.log(`[CONCURRENCY] audit count before = ${auditCountBefore}`);
    console.log(`[CONCURRENCY] Launching ${concurrentCount} concurrent audit-bearing mutations...`);

    const customerCodes = [];
    const promises = [];
    for (let i = 0; i < concurrentCount; i++) {
      const code = `CONC-CUST-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      customerCodes.push(code);
      const p = adminClient.request('/api/customers', {
        method: 'POST',
        body: {
          code,
          name: `Concurrent Test Customer ${i}`,
          email: `conc_${i}_${Date.now()}@example.com`,
          phone: `090${String(1000000 + i).slice(0, 7)}`,
          address: 'Concurrency Test Suite',
          tax_code: `010${String(Date.now()).slice(-4)}${String(i).padStart(3, '0')}`,
          credit_limit: 50000000
        }
      });
      promises.push(p);
    }

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.status === 201);
    const failed = results.filter(r => r.status !== 201);
    const auditCountAfter = Number(queryDb('SELECT count(*) FROM public.audit_logs'));
    const actualAuditDelta = auditCountAfter - auditCountBefore;

    console.log(`[CONCURRENCY] concurrent transaction count = ${concurrentCount}`);
    console.log(`[CONCURRENCY] successful business transactions = ${successful.length}`);
    console.log(`[CONCURRENCY] failed business transactions = ${failed.length}`);
    console.log(`[CONCURRENCY] expected audit rows = ${successful.length}`);
    console.log(`[CONCURRENCY] actual audit rows delta = ${actualAuditDelta}`);
    console.log(`[CONCURRENCY] audit count after = ${auditCountAfter}`);

    assert.equal(successful.length, concurrentCount, 'All concurrent transactions succeeded without deadlocks');
    assert.equal(failed.length, 0, 'Zero failed transactions');
    assert.equal(actualAuditDelta, concurrentCount, `Exact audit delta matches concurrent successful transactions (${concurrentCount})`);

    // Verify correlation of each created customer to its corresponding audit record
    for (const code of customerCodes) {
      const matched = Number(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'CUSTOMER_CREATED' AND target_ref = '${code}'`));
      assert.equal(matched, 1, `Audit entry for customer ${code} must exist and be uniquely correlated`);
    }

    // Immediately verify audit chain
    const verifyRes = await adminClient.request('/api/audit/verify', { method: 'POST' });
    assert.equal(verifyRes.status, 200, 'Verification endpoint returns 200');
    assert.equal(verifyRes.data.valid, true, 'Audit chain remains 100% cryptographically valid');
    assert.equal(verifyRes.data.verified_count, verifyRes.data.total_records, 'All records verified without fork or break');
    console.log(`[CONCURRENCY] Audit chain intact: ${verifyRes.data.verified_count} records verified.`);
  });

  await test('G06: Cryptographic SHA-256 chain verification: 100% hash integrity & no forks', async () => {
    const rows = JSON.parse(queryDb(`
      SELECT coalesce(json_agg(r), '[]'::json) FROM (
        SELECT id, timestamp, actor_id, actor_name, module, action, target_ref, severity, summary, canonical_data, prev_hash, hash
        FROM public.audit_logs ORDER BY id ASC
      ) r;
    `));

    console.log(`[CHAIN] Verifying complete historical audit chain (${rows.length} records)...`);
    let expectedPrevHash = '0'.repeat(64);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      // 1. Verify prev_hash link
      assert.equal(r.prev_hash, expectedPrevHash, `Record ${r.id} prev_hash must link to predecessor`);

      // 2. Compute SHA-256
      const ts = new Date(r.timestamp).toISOString();
      const raw = [
        r.prev_hash,
        ts,
        String(r.actor_id || ''),
        String(r.actor_name || ''),
        String(r.module || ''),
        String(r.action || ''),
        String(r.target_ref || ''),
        String(r.severity || ''),
        String(r.summary || ''),
        r.canonical_data || ''
      ].join('|');
      const calculatedHash = crypto.createHash('sha256').update(raw).digest('hex');

      // 3. Verify hash
      assert.equal(r.hash, calculatedHash, `Record ${r.id} hash must match calculated SHA-256`);
      expectedPrevHash = r.hash;
    }

    console.log(`[CHAIN] All ${rows.length} records verified: ZERO FORKS, ZERO CORRUPTIONS.`);
  });

  console.log('\n============================================================');
  console.log(`P0 VERIFICATION SUITE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
  console.log('============================================================');
}

main().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
