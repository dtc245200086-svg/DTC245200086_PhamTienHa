/**
 * BILLING_ONE — P1.5 GATE 3 TEST SUITE
 * RBAC / PERMISSION VERIFICATION + INVOICE ISSUE INTEGRATION
 * 
 * Verifies:
 * T00: RBAC Matrix in Database (permissions, roles, role_permissions)
 * T00-Auth: Endpoint Authorization (requireAuth, requirePermission('invoice.issue'))
 * T01: Standard issue ACTIVE customer within credit limit -> HTTP 200
 * T02: Standard issue WARNING customer within credit limit -> HTTP 200
 * T03: Exact credit limit boundary (debt + total == limit) -> HTTP 200
 * T04: Credit limit exceeded by 0.01 -> HTTP 409 CREDIT_LIMIT_EXCEEDED with exact details
 * T05: LOCKED customer -> HTTP 409 CUSTOMER_IS_LOCKED
 * T06: credit_limit = 0 -> normal issue allowed (unlimited credit) -> HTTP 200
 * T07/T08: High-concurrency issue race (Customer limit 100M, debt 70M, two 30M invoices)
 *          -> Exactly 1 success (200), exactly 1 rejection (409), 0 over-limit, 0 40P01
 * T09: Sequence protection: nextval(invoice_no_seq) is NOT called on rejected issue
 * T10: Forensic snapshot in INVOICE_ISSUED audit record (decision-time metadata)
 * T11: Audit failure fault injection triggers transaction rollback (invoice remains DRAFT)
 * T12: Successful issue produces exactly one INVOICE_ISSUED audit entry
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

function parseToCents(val) {
  if (val === null || val === undefined) return 0n;
  const s = String(val).trim();
  if (!s || s === '0' || s === '0.00') return 0n;
  const isNegative = s.startsWith('-');
  const raw = isNegative ? s.slice(1) : s;
  const parts = raw.split('.');
  const intPart = parts[0] || '0';
  let fracPart = parts[1] || '';
  if (fracPart.length > 2) {
    const extra = Number(fracPart.charAt(2));
    fracPart = fracPart.slice(0, 2);
    let cents = BigInt(intPart) * 100n + BigInt(fracPart.padEnd(2, '0'));
    if (extra >= 5) cents += 1n;
    return isNegative ? -cents : cents;
  }
  const cents = BigInt(intPart) * 100n + BigInt(fracPart.padEnd(2, '0'));
  return isNegative ? -cents : cents;
}

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

console.log('============================================================');
console.log('BILLING_ONE — P1.5 GATE 3 RBAC & INVOICE ISSUE SUITE');
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

// Helper to create test customer in DB
function createCustomer({ code, name = 'Test Gate3 Customer', status = 'ACTIVE', creditLimit = '50000000.00', lockSource = null, lockReason = null }) {
  const lockSrcVal = lockSource ? `'${lockSource}'` : 'NULL';
  const lockRsnVal = lockReason ? `'${lockReason}'` : 'NULL';
  const out = queryDb(
    `INSERT INTO public.customers (code, name, status, credit_limit, lock_source, lock_reason, created_at)
     VALUES ('${code}', '${name}', '${status}', ${creditLimit}, ${lockSrcVal}, ${lockRsnVal}, NOW())
     RETURNING id;`
  );
  return parseInt(out, 10);
}

// Helper to create test invoice with items in DB
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
     VALUES (${invId}, 'Standard Gate 3 Item', 1, ${total}, ${total});`
  );

  return invId;
}

// Helper to create open committed invoice for existing debt
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
     VALUES (${invId}, 'Existing Debt Item', 1, ${total}, ${total});`
  );

  return invId;
}

// Clean up test customers
function cleanup() {
  queryDb(`DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'TEST_G3_%'));`);
  queryDb(`DELETE FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'TEST_G3_%');`);
  queryDb(`DELETE FROM public.customers WHERE code LIKE 'TEST_G3_%';`);
}

cleanup();

const staffClient = new ApiClient();
const adminClient = new ApiClient();

// -------------------------------------------------------------
// T00: RBAC Database & Session Verification
// -------------------------------------------------------------

await test('T00: RBAC Matrix Verification in Database', async () => {
  const rp = queryDbJson(
    `SELECT r.code as role, p.code as permission
     FROM public.role_permissions rp
     JOIN public.roles r ON r.id = rp.role_id
     JOIN public.permissions p ON p.id = rp.permission_id
     ORDER BY r.code, p.code`
  );

  const rolePermMap = {};
  for (const row of rp) {
    if (!rolePermMap[row.role]) rolePermMap[row.role] = new Set();
    rolePermMap[row.role].add(row.permission);
  }

  // 1. admin must have invoice.issue, invoice.issue_override, customer.unlock, customer.update
  assert.ok(rolePermMap['admin'].has('invoice.issue'), 'admin must have invoice.issue');
  assert.ok(rolePermMap['admin'].has('invoice.issue_override'), 'admin must have invoice.issue_override');
  assert.ok(rolePermMap['admin'].has('customer.unlock'), 'admin must have customer.unlock');
  assert.ok(rolePermMap['admin'].has('customer.update'), 'admin must have customer.update');

  // 2. ROLE_BILLING_MANAGER must have invoice.issue, invoice.issue_override, customer.unlock, customer.update
  assert.ok(rolePermMap['ROLE_BILLING_MANAGER'].has('invoice.issue'), 'ROLE_BILLING_MANAGER must have invoice.issue');
  assert.ok(rolePermMap['ROLE_BILLING_MANAGER'].has('invoice.issue_override'), 'ROLE_BILLING_MANAGER must have invoice.issue_override');
  assert.ok(rolePermMap['ROLE_BILLING_MANAGER'].has('customer.unlock'), 'ROLE_BILLING_MANAGER must have customer.unlock');
  assert.ok(rolePermMap['ROLE_BILLING_MANAGER'].has('customer.update'), 'ROLE_BILLING_MANAGER must have customer.update');

  // 3. staff must have invoice.issue, customer.update; but LACK invoice.issue_override and customer.unlock
  assert.ok(rolePermMap['staff'].has('invoice.issue'), 'staff must have invoice.issue');
  assert.ok(rolePermMap['staff'].has('customer.update'), 'staff must have customer.update');
  assert.ok(!rolePermMap['staff'].has('invoice.issue_override'), 'staff must NOT have invoice.issue_override');
  assert.ok(!rolePermMap['staff'].has('customer.unlock'), 'staff must NOT have customer.unlock');

  // 4. ROLE_ACCOUNTANT must LACK invoice.issue, invoice.issue_override, customer.unlock
  assert.ok(!rolePermMap['ROLE_ACCOUNTANT'].has('invoice.issue'), 'ROLE_ACCOUNTANT must NOT have invoice.issue');
  assert.ok(!rolePermMap['ROLE_ACCOUNTANT'].has('invoice.issue_override'), 'ROLE_ACCOUNTANT must NOT have invoice.issue_override');
  assert.ok(!rolePermMap['ROLE_ACCOUNTANT'].has('customer.unlock'), 'ROLE_ACCOUNTANT must NOT have customer.unlock');

  // 5. ROLE_AUDITOR must LACK invoice.issue, invoice.issue_override, customer.unlock
  assert.ok(!rolePermMap['ROLE_AUDITOR'].has('invoice.issue'), 'ROLE_AUDITOR must NOT have invoice.issue');
  assert.ok(!rolePermMap['ROLE_AUDITOR'].has('invoice.issue_override'), 'ROLE_AUDITOR must NOT have invoice.issue_override');
  assert.ok(!rolePermMap['ROLE_AUDITOR'].has('customer.unlock'), 'ROLE_AUDITOR must NOT have customer.unlock');
});

await test('T00-Auth: Endpoint Authorization & Login Verification', async () => {
  const unauthClient = new ApiClient();
  const unauthRes = await unauthClient.request('/api/invoices/1/issue', { method: 'POST' });
  assert.equal(unauthRes.status, 401, 'Unauthenticated request must return 401 UNAUTHENTICATED');
  assert.equal(unauthRes.data.error.code, 'UNAUTHENTICATED');

  const staffLoginRes = await staffClient.login('staff', staffPassword);
  assert.equal(staffLoginRes.status, 200, 'Staff login must succeed');

  const adminLoginRes = await adminClient.login('admin', adminPassword);
  assert.equal(adminLoginRes.status, 200, 'Admin login must succeed');
});

// -------------------------------------------------------------
// T01: Standard issue ACTIVE customer within limit -> HTTP 200
// -------------------------------------------------------------

await test('T01: Standard issue ACTIVE customer within limit -> HTTP 200', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T01', creditLimit: '50000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '10000000.00' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.invoice.status, 'ISSUED');
  assert.ok(res.data.invoice.invoice_no.startsWith('INV-'));
});

// -------------------------------------------------------------
// T02: Standard issue WARNING customer within limit -> HTTP 200
// -------------------------------------------------------------

await test('T02: Standard issue WARNING customer within limit -> HTTP 200', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T02', status: 'WARNING', creditLimit: '50000000.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV_G3_T02_PREV', total: '10000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '5000000.00' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.data.invoice.status, 'ISSUED');
});

// -------------------------------------------------------------
// T03: Exact credit limit boundary -> HTTP 200
// -------------------------------------------------------------

await test('T03: Exact credit limit boundary (debt + total == limit) -> HTTP 200', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T03', creditLimit: '50000000.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV_G3_T03_PREV', total: '40000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '10000000.00' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 200, `Exact boundary issue must succeed: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.invoice.status, 'ISSUED');
});

// -------------------------------------------------------------
// T04: Credit limit exceeded by 0.01 -> HTTP 409 CREDIT_LIMIT_EXCEEDED
// -------------------------------------------------------------

await test('T04: Credit limit exceeded by 0.01 -> HTTP 409 CREDIT_LIMIT_EXCEEDED', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T04', creditLimit: '50000000.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV_G3_T04_PREV', total: '40000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '10000000.01' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 409, `Expected 409, got ${res.status}`);
  assert.equal(res.data.error.code, 'CREDIT_LIMIT_EXCEEDED');

  const details = res.data.error.details;
  assert.ok(details, 'Error details must be present');
  assert.equal(details.excess_amount, '0.01');
  assert.equal(details.projected_debt, '50000000.01');
  assert.equal(details.current_debt, '40000000.00');
  assert.equal(details.invoice_total, '10000000.01');
  assert.equal(details.credit_limit, '50000000.00');

  // Verify invoice remains DRAFT
  const dbStatus = queryDb(`SELECT status FROM public.invoices WHERE id = ${invId}`);
  assert.equal(dbStatus, 'DRAFT', 'Invoice must remain DRAFT after rejected issue attempt');
});

// -------------------------------------------------------------
// T05: LOCKED customer -> HTTP 409 CUSTOMER_IS_LOCKED
// -------------------------------------------------------------

await test('T05: LOCKED customer -> HTTP 409 CUSTOMER_IS_LOCKED', async () => {
  const custId = createCustomer({
    code: 'TEST_G3_T05',
    status: 'LOCKED',
    creditLimit: '50000000.00',
    lockSource: 'AUTO_RISK',
    lockReason: 'Delinquency lock'
  });
  const invId = createDraftInvoice({ customerId: custId, total: '1000000.00' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 409);
  assert.equal(res.data.error.code, 'CUSTOMER_IS_LOCKED');

  // Verify invoice remains DRAFT
  const dbStatus = queryDb(`SELECT status FROM public.invoices WHERE id = ${invId}`);
  assert.equal(dbStatus, 'DRAFT');
});

// -------------------------------------------------------------
// T06: credit_limit = 0 -> normal issue allowed (unlimited credit)
// -------------------------------------------------------------

await test('T06: credit_limit = 0 -> normal issue allowed (unlimited credit) -> HTTP 200', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T06', creditLimit: '0.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV_G3_T06_PREV', total: '500000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '250000000.00' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 200, `Unlimited credit issue must succeed: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.invoice.status, 'ISSUED');
});

// -------------------------------------------------------------
// T07/T08: High-Concurrency Double-Issue Race (Section 15)
// -------------------------------------------------------------

await test('T07/T08: High-concurrency issue race (Customer limit 100M, debt 70M, two 30M invoices)', async () => {
  const custId = createCustomer({ code: 'TEST_G3_CONCURRENCY', creditLimit: '100000000.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV_G3_CONCUR_70M', total: '70000000.00' });

  const invA = createDraftInvoice({ customerId: custId, total: '30000000.00' });
  const invB = createDraftInvoice({ customerId: custId, total: '30000000.00' });

  // Issue simultaneously via two distinct requests
  const [resA, resB] = await Promise.all([
    staffClient.request(`/api/invoices/${invA}/issue`, { method: 'POST' }),
    staffClient.request(`/api/invoices/${invB}/issue`, { method: 'POST' })
  ]);

  const statuses = [resA.status, resB.status];
  assert.ok(statuses.includes(200), 'Exactly one request must succeed with HTTP 200');
  assert.ok(statuses.includes(409), 'Exactly one request must fail with HTTP 409');

  const successRes = resA.status === 200 ? resA : resB;
  const failureRes = resA.status === 409 ? resA : resB;

  assert.equal(failureRes.data.error.code, 'CREDIT_LIMIT_EXCEEDED');
  assert.equal(failureRes.data.error.details.excess_amount, '30000000.00');
  assert.equal(failureRes.data.error.details.projected_debt, '130000000.00');

  // Verify DB state: exactly 1 ISSUED, exactly 1 remains DRAFT
  const statusA = queryDb(`SELECT status FROM public.invoices WHERE id = ${invA}`);
  const statusB = queryDb(`SELECT status FROM public.invoices WHERE id = ${invB}`);

  assert.ok(
    (statusA === 'ISSUED' && statusB === 'DRAFT') || (statusA === 'DRAFT' && statusB === 'ISSUED'),
    `Exactly one invoice must be ISSUED and one must remain DRAFT (got A: ${statusA}, B: ${statusB})`
  );

  // Verify total debt is exactly 100M
  const totalDebt = queryDb(
    `SELECT sum(total - paid_total - adjusted_total)::numeric(14,2)::text
     FROM public.invoices
     WHERE customer_id = ${custId} AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')`
  );
  assert.equal(totalDebt, '100000000.00', 'Total committed debt must not exceed 100M');
});

// -------------------------------------------------------------
// T09: Sequence Protection (Zero nextval on rejection)
// -------------------------------------------------------------

await test('T09: Sequence protection: nextval(invoice_no_seq) is NOT called on rejected issue', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T09', status: 'LOCKED', creditLimit: '50000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '1000000.00' });

  const seqBefore = queryDb(`SELECT last_value FROM public.invoice_no_seq`);

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 409);

  const seqAfter = queryDb(`SELECT last_value FROM public.invoice_no_seq`);
  assert.equal(
    seqAfter,
    seqBefore,
    `Sequence last_value must remain identical (before: ${seqBefore}, after: ${seqAfter})`
  );
});

// -------------------------------------------------------------
// T10: Forensic Snapshot in INVOICE_ISSUED audit record
// -------------------------------------------------------------

await test('T10: Forensic snapshot in INVOICE_ISSUED audit record', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T10', status: 'ACTIVE', creditLimit: '50000000.00' });
  createOpenInvoice({ customerId: custId, invoiceNo: 'INV_G3_T10_PREV', total: '15000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '20000000.00' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 200);
  const issuedInvoice = res.data.invoice;

  const auditRows = queryDbJson(
    `SELECT action, target_ref, metadata
     FROM public.audit_logs
     WHERE action = 'INVOICE_ISSUED' AND target_ref = '${issuedInvoice.invoice_no}'
     ORDER BY id DESC LIMIT 1`
  );

  assert.equal(auditRows.length, 1, 'Must find exactly one INVOICE_ISSUED audit log');
  const metadata = auditRows[0].metadata;

  assert.equal(metadata.invoice_id, invId);
  assert.equal(metadata.invoice_no, issuedInvoice.invoice_no);
  assert.equal(metadata.customer_id, custId);
  assert.equal(metadata.customer_status_prior, 'ACTIVE');
  assert.equal(metadata.credit_limit, '50000000.00');
  assert.equal(metadata.current_debt_prior, '15000000.00');
  assert.equal(metadata.invoice_total, '20000000.00');
  assert.equal(metadata.projected_debt, '35000000.00');
  assert.equal(metadata.issue_decision, 'NORMAL');

  // Exact math invariant check: current_debt_prior + invoice_total == projected_debt
  const priorCents = parseToCents(metadata.current_debt_prior);
  const totalCents = parseToCents(metadata.invoice_total);
  const projCents = parseToCents(metadata.projected_debt);
  assert.equal(priorCents + totalCents, projCents, 'Audit metadata debt sum invariant must hold exactly');
});

// -------------------------------------------------------------
// T11: Audit Failure Fault-Injection (Atomicity Verification)
// -------------------------------------------------------------

await test('T11: Audit failure fault injection triggers transaction rollback (invoice remains DRAFT)', async () => {
  // Test transaction rollback when audit recording fails inside transaction
  const custId = createCustomer({ code: 'TEST_G3_T11_FAULT', creditLimit: '50000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '10000000.00' });

  // Execute a simulated issue where recordAudit throws with throwOnError: true
  const faultScript = `
    const { inTransaction } = require('./src/db');
    const { recordAudit } = require('./src/audit');
    const CustomerCreditService = require('./src/services/customerCreditService');

    async function testFault() {
      try {
        await inTransaction(async (client) => {
          // 1. Lock invoice
          const locked = await client.query('SELECT id, customer_id, total::text FROM public.invoices WHERE id = $1 FOR UPDATE', [${invId}]);
          const inv = locked.rows[0];

          // 2. Check eligibility
          await CustomerCreditService.checkInvoiceIssueEligibility(client, {
            customerId: inv.customer_id,
            invoiceTotal: inv.total
          });

          // 3. Mutate invoice
          await client.query("UPDATE public.invoices SET status = 'ISSUED', invoice_no = 'INV-FAULT-999' WHERE id = $1", [${invId}]);

          // 4. Injected Audit Failure: omit required summary, causing audit insert constraint failure
          await recordAudit(client, {
            user: { id: 1, username: 'test' },
            module: 'invoices',
            action: 'INVOICE_ISSUED',
            targetRef: 'INV-FAULT-999',
            // summary is intentionally omitted to trigger database NOT NULL failure
            throwOnError: true
          });
        });
      } catch (err) {
        console.log('CAUGHT_AUDIT_FAILURE:' + err.message);
      }
    }
    testFault().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  `;

  fs.writeFileSync('temp_fault_test.js', faultScript);
  execSync('docker cp temp_fault_test.js billing-web-1:/app/temp_fault_test.js');
  const output = execSync('docker exec -i billing-web-1 node /app/temp_fault_test.js', { encoding: 'utf8' });
  if (fs.existsSync('temp_fault_test.js')) fs.unlinkSync('temp_fault_test.js');
  execSync('docker exec -u 0 billing-web-1 rm -f /app/temp_fault_test.js');

  assert.ok(output.includes('CAUGHT_AUDIT_FAILURE:'), 'Audit failure must be caught and rethrown');

  // Verify that the invoice was ROLLED BACK and remains DRAFT!
  const invoiceStatus = queryDb(`SELECT status FROM public.invoices WHERE id = ${invId}`);
  assert.equal(invoiceStatus, 'DRAFT', 'Invoice must remain DRAFT because transaction rolled back');

  const invoiceNo = queryDb(`SELECT invoice_no FROM public.invoices WHERE id = ${invId}`);
  assert.equal(invoiceNo, '', 'invoice_no must be NULL/empty because mutation was rolled back');
});

// -------------------------------------------------------------
// T12: Successful issue produces exactly one INVOICE_ISSUED audit entry
// -------------------------------------------------------------

await test('T12: Successful issue produces exactly one INVOICE_ISSUED audit entry', async () => {
  const custId = createCustomer({ code: 'TEST_G3_T12', creditLimit: '50000000.00' });
  const invId = createDraftInvoice({ customerId: custId, total: '12000000.00' });

  const res = await staffClient.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  assert.equal(res.status, 200);
  const invoiceNo = res.data.invoice.invoice_no;

  const count = parseInt(
    queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'INVOICE_ISSUED' AND target_ref = '${invoiceNo}'`),
    10
  );
  assert.equal(count, 1, `Must have exactly 1 audit entry, got ${count}`);
});

cleanup();

console.log('\n============================================================');
console.log(`GATE 3 TEST SUITE: ALL ${passedTests}/${totalTests} TESTS PASSED`);
console.log('============================================================\n');
process.exit(0);
