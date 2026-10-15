/**
 * BILLING_ONE — REMEDIATION CLOSURE VERIFICATION SUITE
 * 
 * Verifies the 2 targeted remediation objectives:
 * 1. Backend Authorization for Dashboard / Analytics (ADMIN vs DIRECTOR vs STAFF vs Unauthenticated)
 * 2. Dedicated Server-side CSV Export decoupled from pagination (supports >100 rows, filters, UTF-8 BOM, zero credential leak)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load .env
const env = {};
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
} catch (e) {}

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = env.ADMIN_PASSWORD;
const staffPassword = env.STAFF_PASSWORD;
const directorPassword = 'Test_gate8_billing_mgr_Pass!2026';

class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }

  async login(username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookie) headers['Cookie'] = this.cookie;
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];

    const contentType = res.headers.get('content-type') || '';
    let body;
    let hasBom = false;
    let rawBytes = null;
    if (contentType.includes('application/json')) {
      body = await res.json().catch(() => null);
    } else {
      const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
      rawBytes = new Uint8Array(buf);
      hasBom = rawBytes.length >= 3 && rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF;
      const dec = new TextDecoder('utf-8', { ignoreBOM: true });
      body = dec.decode(rawBytes);
    }
    return {
      status: res.status,
      headers: res.headers,
      contentType,
      body,
      hasBom,
      rawBytes
    };
  }
}

async function run() {
  console.log('======================================================================');
  console.log('BILLING_ONE — CONTROLLED REMEDIATION CLOSURE VERIFICATION');
  console.log('======================================================================\n');

  const unauthClient = new Client('Unauthenticated');
  const adminClient = new Client('Admin');
  const staffClient = new Client('Staff');
  const directorClient = new Client('Director');

  console.log('--- STEP 1: AUTHENTICATION PRE-FLIGHT ---');
  const adminLogin = await adminClient.login('admin', adminPassword);
  assert.equal(adminLogin.status, 200, 'Admin login must succeed');
  console.log('✓ Admin authenticated:', adminLogin.data.user.username, `(${adminLogin.data.user.role})`);

  const staffLogin = await staffClient.login('staff', staffPassword);
  assert.equal(staffLogin.status, 200, 'Staff login must succeed');
  console.log('✓ Staff authenticated:', staffLogin.data.user.username, `(${staffLogin.data.user.role})`);

  const dirLogin = await directorClient.login('gate8_billing_mgr', directorPassword);
  assert.equal(dirLogin.status, 200, 'Director login must succeed');
  console.log('✓ Director authenticated:', dirLogin.data.user.username, `(${dirLogin.data.user.role})`);
  console.log('');

  console.log('--- STEP 2: FIX 1 — BACKEND DASHBOARD / ANALYTICS AUTHORIZATION ---');

  // Test Matrix Definitions
  const endpoints = [
    {
      name: 'Admin Analytics (/api/dashboard/admin-analytics)',
      path: '/api/dashboard/admin-analytics',
      expected: { unauth: 401, staff: 403, director: 403, admin: 200 }
    },
    {
      name: 'Admin Metrics (/api/admin/analytics)',
      path: '/api/admin/analytics',
      expected: { unauth: 401, staff: 403, director: 403, admin: 200 }
    },
    {
      name: 'Executive Analytics (/api/dashboard/director-analytics)',
      path: '/api/dashboard/director-analytics',
      expected: { unauth: 401, staff: 403, director: 200, admin: 200 }
    },
    {
      name: 'Reconciliation Analytics (/api/dashboard/reconciliation-analytics)',
      path: '/api/dashboard/reconciliation-analytics',
      expected: { unauth: 401, staff: 403, director: 200, admin: 200 }
    },
    {
      name: 'Staff Operational Analytics (/api/dashboard/staff-analytics)',
      path: '/api/dashboard/staff-analytics',
      expected: { unauth: 401, staff: 200, director: 200, admin: 200 }
    },
    {
      name: 'Invoices Analytics (/api/dashboard/invoices-analytics)',
      path: '/api/dashboard/invoices-analytics',
      expected: { unauth: 401, staff: 200, director: 200, admin: 200 }
    },
    {
      name: 'Payments Analytics (/api/dashboard/payments-analytics)',
      path: '/api/dashboard/payments-analytics',
      expected: { unauth: 401, staff: 200, director: 200, admin: 200 }
    },
    {
      name: 'Aging Report (/api/reports/aging)',
      path: '/api/reports/aging',
      expected: { unauth: 401, staff: 200, director: 200, admin: 200 }
    },
    {
      name: 'Collection Metrics (/api/reports/collection-metrics)',
      path: '/api/reports/collection-metrics',
      expected: { unauth: 401, staff: 200, director: 200, admin: 200 }
    },
    {
      name: 'Revenue Analytics (/api/reports/revenue-analytics)',
      path: '/api/reports/revenue-analytics',
      expected: { unauth: 401, staff: 200, director: 200, admin: 200 }
    }
  ];

  for (const ep of endpoints) {
    const rUnauth = await unauthClient.request(ep.path);
    assert.equal(rUnauth.status, ep.expected.unauth, `Unauthenticated on ${ep.name} expected ${ep.expected.unauth}, got ${rUnauth.status}`);

    const rStaff = await staffClient.request(ep.path);
    assert.equal(rStaff.status, ep.expected.staff, `Staff on ${ep.name} expected ${ep.expected.staff}, got ${rStaff.status}`);

    const rDir = await directorClient.request(ep.path);
    assert.equal(rDir.status, ep.expected.director, `Director on ${ep.name} expected ${ep.expected.director}, got ${rDir.status}`);

    const rAdmin = await adminClient.request(ep.path);
    assert.equal(rAdmin.status, ep.expected.admin, `Admin on ${ep.name} expected ${ep.expected.admin}, got ${rAdmin.status}`);

    console.log(`✓ [AUTH PASS] ${ep.name.padEnd(55)}: Unauth=${rUnauth.status} | Staff=${rStaff.status} | Director=${rDir.status} | Admin=${rAdmin.status}`);
  }
  console.log('\n--- ALL BACKEND DASHBOARD/ANALYTICS AUTHORIZATION TESTS PASSED! ---\n');

  console.log('--- STEP 3: FIX 2 — SERVER-SIDE CSV EXPORT ARCHITECTURE ---');

  // 3.1 Test Pagination limit strictly <= 100
  const rPage1000 = await adminClient.request('/api/invoices?page=1&limit=1000');
  assert.equal(rPage1000.status, 400, 'Requesting limit=1000 on paginated list must be rejected with 400 LIMIT_OUT_OF_RANGE');
  console.log('✓ Paginated list strictly enforces limit <= 100: page_size=1000 correctly rejected with HTTP 400');

  const rPage20 = await adminClient.request('/api/invoices?page=1&limit=20');
  assert.equal(rPage20.status, 200, 'Requesting limit=20 on paginated list must succeed');
  assert.equal(rPage20.body.items.length, 20, 'Limit 20 must return exactly 20 items');
  console.log('✓ Standard pagination preserved: limit=20 returns 20 items (total available:', rPage20.body.total, ')');

  // Helper to parse CSV rows count and check BOM
  function inspectCsv(resOrBody, resHeaders) {
    const isRes = typeof resOrBody === 'object' && resOrBody !== null && 'body' in resOrBody;
    const body = isRes ? resOrBody.body : resOrBody;
    const hasBom = isRes ? (resOrBody.hasBom || body.startsWith('\uFEFF')) : (body.startsWith('\uFEFF') || (resHeaders && resHeaders.hasBom));
    const content = body.startsWith('\uFEFF') ? body.slice(1) : body;
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    const headerLine = lines[0] || '';
    const dataLines = lines.slice(1);
    return {
      hasBom,
      totalLines: lines.length,
      dataRowCount: dataLines.length,
      headerLine,
      headers: headerLine.split(',').map(h => h.replace(/^"|"$/g, '')),
      firstDataRow: dataLines[0] || ''
    };
  }

  // 3.2 Invoices CSV Export (>100 rows + filter consistency)
  console.log('\nTesting Invoices CSV Export...');
  const invCsvAll = await adminClient.request('/api/invoices/export.csv');
  assert.equal(invCsvAll.status, 200);
  assert.ok(invCsvAll.contentType.includes('text/csv'));
  const invParsed = inspectCsv(invCsvAll);
  assert.ok(invParsed.hasBom, 'Invoices CSV must include UTF-8 BOM');
  assert.ok(invParsed.dataRowCount > 100, `Invoices CSV must export full dataset (>100 rows), got ${invParsed.dataRowCount}`);
  console.log(`✓ /api/invoices/export.csv returned ${invParsed.dataRowCount} rows (>100 rows) with UTF-8 BOM: YES`);

  // Invoices filtered export
  const invCsvFiltered = await adminClient.request('/api/invoices/export.csv?status=OVERDUE');
  assert.equal(invCsvFiltered.status, 200);
  const invFiltParsed = inspectCsv(invCsvFiltered);
  assert.ok(invFiltParsed.dataRowCount > 0, 'Filtered OVERDUE should return rows');
  assert.ok(invFiltParsed.dataRowCount < invParsed.dataRowCount, 'Filtered rows should be subset of all rows');
  console.log(`✓ /api/invoices/export.csv?status=OVERDUE properly applied filter: ${invFiltParsed.dataRowCount} overdue rows exported`);

  // 3.3 Customers CSV Export (>100 rows)
  console.log('\nTesting Customers CSV Export...');
  const custCsv = await adminClient.request('/api/customers/export.csv');
  assert.equal(custCsv.status, 200);
  const custParsed = inspectCsv(custCsv);
  assert.ok(custParsed.hasBom, 'Customers CSV must include UTF-8 BOM');
  assert.ok(custParsed.dataRowCount > 100, `Customers CSV must export full dataset (>100 rows), got ${custParsed.dataRowCount}`);
  console.log(`✓ /api/customers/export.csv returned ${custParsed.dataRowCount} rows (>100 rows) with UTF-8 BOM: YES`);

  // 3.4 Payments CSV Export (>100 rows)
  console.log('\nTesting Payments CSV Export...');
  const payCsv = await adminClient.request('/api/payments/export.csv');
  assert.equal(payCsv.status, 200);
  const payParsed = inspectCsv(payCsv);
  assert.ok(payParsed.hasBom, 'Payments CSV must include UTF-8 BOM');
  assert.ok(payParsed.dataRowCount > 100, `Payments CSV must export full dataset (>100 rows), got ${payParsed.dataRowCount}`);
  console.log(`✓ /api/payments/export.csv returned ${payParsed.dataRowCount} rows (>100 rows) with UTF-8 BOM: YES`);

  // 3.5 Products CSV Export
  console.log('\nTesting Products CSV Export...');
  const prodCsv = await adminClient.request('/api/products/export.csv');
  assert.equal(prodCsv.status, 200);
  const prodParsed = inspectCsv(prodCsv);
  assert.ok(prodParsed.hasBom, 'Products CSV must include UTF-8 BOM');
  console.log(`✓ /api/products/export.csv returned ${prodParsed.dataRowCount} rows with UTF-8 BOM: YES`);

  // 3.6 Adjustments CSV Export
  console.log('\nTesting Adjustments CSV Export...');
  const adjCsv = await adminClient.request('/api/adjustments/export.csv');
  assert.equal(adjCsv.status, 200);
  const adjParsed = inspectCsv(adjCsv);
  assert.ok(adjParsed.hasBom, 'Adjustments CSV must include UTF-8 BOM');
  console.log(`✓ /api/adjustments/export.csv returned ${adjParsed.dataRowCount} rows with UTF-8 BOM: YES`);

  // 3.7 Recurring Plans CSV Export (>100 rows)
  console.log('\nTesting Recurring Plans CSV Export...');
  const recCsv = await adminClient.request('/api/recurring/export.csv');
  assert.equal(recCsv.status, 200);
  const recParsed = inspectCsv(recCsv);
  assert.ok(recParsed.hasBom, 'Recurring CSV must include UTF-8 BOM');
  assert.ok(recParsed.dataRowCount > 100, `Recurring CSV must export full dataset (>100 rows), got ${recParsed.dataRowCount}`);
  console.log(`✓ /api/recurring/export.csv returned ${recParsed.dataRowCount} rows (>100 rows) with UTF-8 BOM: YES`);

  // 3.8 Reconciliation CSV Export
  console.log('\nTesting Reconciliation CSV Export...');
  const reconCsv = await adminClient.request('/api/reconciliation/export.csv');
  assert.equal(reconCsv.status, 200);
  const reconParsed = inspectCsv(reconCsv);
  assert.ok(reconParsed.hasBom, 'Reconciliation CSV must include UTF-8 BOM');
  console.log(`✓ /api/reconciliation/export.csv returned ${reconParsed.dataRowCount} rows with UTF-8 BOM: YES`);

  // 3.9 Aging Report CSV Export
  console.log('\nTesting Aging Report CSV Export...');
  const agingCsv = await adminClient.request('/api/reports/aging/export.csv');
  assert.equal(agingCsv.status, 200);
  const agingParsed = inspectCsv(agingCsv);
  assert.ok(agingParsed.hasBom, 'Aging Report CSV must include UTF-8 BOM');
  console.log(`✓ /api/reports/aging/export.csv returned ${agingParsed.dataRowCount} rows with UTF-8 BOM: YES`);

  // 3.10 VAT Report CSV Export
  console.log('\nTesting VAT Report CSV Export...');
  const vatCsv = await adminClient.request('/api/reports/vat/export.csv');
  assert.equal(vatCsv.status, 200);
  const vatParsed = inspectCsv(vatCsv);
  assert.ok(vatParsed.hasBom, 'VAT Report CSV must include UTF-8 BOM');
  console.log(`✓ /api/reports/vat/export.csv returned ${vatParsed.dataRowCount} rows with UTF-8 BOM: YES`);

  // 3.11 Audit Logs CSV Export (>100 rows)
  console.log('\nTesting Audit Logs CSV Export...');
  const auditCsv = await adminClient.request('/api/audit/export.csv');
  assert.equal(auditCsv.status, 200);
  const auditParsed = inspectCsv(auditCsv);
  assert.ok(auditParsed.hasBom, 'Audit Logs CSV must include UTF-8 BOM');
  assert.ok(auditParsed.dataRowCount > 100, `Audit CSV must export full dataset (>100 rows), got ${auditParsed.dataRowCount}`);
  console.log(`✓ /api/audit/export.csv returned ${auditParsed.dataRowCount} rows (>100 rows) with UTF-8 BOM: YES`);

  // 3.12 Users CSV Export + Strict Security Check
  console.log('\nTesting Users CSV Export & Security Invariants...');
  const usersCsv = await adminClient.request('/api/users/export.csv');
  assert.equal(usersCsv.status, 200);
  const usersParsed = inspectCsv(usersCsv);
  assert.ok(usersParsed.hasBom, 'Users CSV must include UTF-8 BOM');

  // Verify Security: NEVER export password, password_hash, token, secret
  const lowerBody = usersCsv.body.toLowerCase();
  assert.ok(!lowerBody.includes('password_hash'), 'Users CSV MUST NOT leak password_hash');
  assert.ok(!lowerBody.includes('$2a$'), 'Users CSV MUST NOT leak bcrypt hash fragments');
  assert.ok(!lowerBody.includes('$2b$'), 'Users CSV MUST NOT leak bcrypt hash fragments');
  assert.ok(!lowerBody.includes('session'), 'Users CSV MUST NOT leak session tokens');
  assert.ok(!lowerBody.includes('secret'), 'Users CSV MUST NOT leak secret fields');
  console.log(`✓ /api/users/export.csv returned ${usersParsed.dataRowCount} users with zero credential/secret leak: VERIFIED SAFE`);

  // 3.13 Permission Enforcement on CSV Export
  console.log('\nTesting Permission Enforcement on CSV Exports...');
  const unauthInvCsv = await unauthClient.request('/api/invoices/export.csv');
  assert.equal(unauthInvCsv.status, 401, 'Unauthenticated CSV export must return 401');

  const staffUsersCsv = await staffClient.request('/api/users/export.csv');
  assert.equal(staffUsersCsv.status, 403, 'Staff calling Users CSV export must return 403 FORBIDDEN');

  const staffAuditCsv = await staffClient.request('/api/audit/export.csv');
  assert.equal(staffAuditCsv.status, 403, 'Staff calling Audit Logs CSV export must return 403 FORBIDDEN');

  console.log('✓ Unauthenticated CSV export -> 401 UNAUTHENTICATED: PASS');
  console.log('✓ Staff without admin permissions on Users/Audit CSV -> 403 FORBIDDEN: PASS');

  console.log('\n======================================================================');
  console.log('ALL REMEDIATION CHECKS COMPLETED AND VERIFIED 100% SUCCESSFUL!');
  console.log('======================================================================');
}

run().catch((err) => {
  console.error('\n❌ REMEDIATION VERIFICATION FAILED:', err);
  process.exit(1);
});
