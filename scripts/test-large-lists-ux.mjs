import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error('ADMIN_PASSWORD is required.');
}

async function runTest() {
  console.log('================================================================');
  console.log('       LARGE LISTS UX & SERVER-SIDE PAGINATION VERIFICATION     ');
  console.log('================================================================\n');

  // 1. Authenticate as admin
  console.log('1. Authenticating as admin...');
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPassword })
  });
  assert.equal(loginRes.status, 200, 'Login must succeed');
  const cookie = loginRes.headers.get('set-cookie').split(';', 1)[0];
  console.log('[PASS] Admin authenticated successfully.\n');

  const headers = { Cookie: cookie };

  // 2. Test server-side pagination across all major modules
  console.log('2. Verifying Server-Side Pagination (default 20, 15, 50) and total count...');

  const modules = [
    { name: 'Invoices', url: '/api/invoices' },
    { name: 'Customers', url: '/api/customers' },
    { name: 'Products', url: '/api/products' },
    { name: 'Payments', url: '/api/payments' },
    { name: 'Adjustments', url: '/api/adjustments' },
    { name: 'Recurring Plans', url: '/api/recurring' },
    { name: 'Reconciliation', url: '/api/reconciliation/transactions' },
    { name: 'Audit Logs', url: '/api/audit' },
    { name: 'Users', url: '/api/users' }
  ];

  for (const mod of modules) {
    // Default page size = 20
    const resDefault = await fetch(`${baseUrl}${mod.url}`, { headers });
    assert.equal(resDefault.status, 200, `${mod.name} GET must return 200`);
    const dataDefault = await resDefault.json();
    assert.ok('total' in dataDefault, `${mod.name} response must include total count`);
    assert.equal(typeof dataDefault.total, 'number', `${mod.name} total must be a number`);
    assert.equal(dataDefault.page, 1, `${mod.name} default page must be 1`);
    assert.equal(dataDefault.limit, 20, `${mod.name} default limit must be 20`);
    assert.equal(dataDefault.page_size, 20, `${mod.name} default page_size must be 20`);
    const items = dataDefault.items || dataDefault.transactions || dataDefault.users || [];
    assert.ok(Array.isArray(items), `${mod.name} items must be an array`);
    assert.ok(items.length <= 20, `${mod.name} items count must be <= 20`);

    // Page size = 15
    const res15 = await fetch(`${baseUrl}${mod.url}?page=1&page_size=15`, { headers });
    assert.equal(res15.status, 200);
    const data15 = await res15.json();
    assert.equal(data15.limit, 15, `${mod.name} limit for page_size=15 must be 15`);
    assert.equal(data15.page_size, 15, `${mod.name} page_size for page_size=15 must be 15`);

    // Page size = 50
    const res50 = await fetch(`${baseUrl}${mod.url}?page=1&page_size=50`, { headers });
    assert.equal(res50.status, 200);
    const data50 = await res50.json();
    assert.equal(data50.limit, 50, `${mod.name} limit for page_size=50 must be 50`);
    assert.equal(data50.page_size, 50, `${mod.name} page_size for page_size=50 must be 50`);

    console.log(` [PASS] ${mod.name}: total=${dataDefault.total}, page=1, page_size (20, 15, 50) verified.`);
  }

  // 3. Test Backend Search (?q=...) across modules
  console.log('\n3. Verifying Backend Search functionality (?q=...)...');
  const searchTests = [
    { mod: 'Invoices', url: '/api/invoices?q=INV' },
    { mod: 'Customers', url: '/api/customers?q=CUST' },
    { mod: 'Products', url: '/api/products?q=Gói' },
    { mod: 'Payments', url: '/api/payments?q=PAY' },
    { mod: 'Adjustments', url: '/api/adjustments?q=ADJ' },
    { mod: 'Recurring', url: '/api/recurring?q=REC' },
    { mod: 'Reconciliation', url: '/api/reconciliation/transactions?q=FT' },
    { mod: 'Audit', url: '/api/audit?q=AUTH' },
    { mod: 'Users', url: '/api/users?q=admin' }
  ];

  for (const st of searchTests) {
    const res = await fetch(`${baseUrl}${st.url}`, { headers });
    assert.equal(res.status, 200, `Search on ${st.mod} must return 200`);
    const data = await res.json();
    assert.ok(typeof data.total === 'number', `${st.mod} search response must include total`);
    console.log(` [PASS] Search ${st.mod} (q): total=${data.total}`);
  }

  // 4. Test Module-Specific Filters
  console.log('\n4. Verifying Module Filters...');
  const filterTests = [
    { name: 'Invoices status & date', url: '/api/invoices?status=ISSUED&from=2026-01-01&to=2026-12-31' },
    { name: 'Customers status', url: '/api/customers?status=ACTIVE' },
    { name: 'Products status', url: '/api/products?status=ACTIVE' },
    { name: 'Payments method', url: '/api/payments?method=BANK_TRANSFER' },
    { name: 'Adjustments status & type', url: '/api/adjustments?status=DRAFT&type=DISCOUNT' },
    { name: 'Recurring status & freq', url: '/api/recurring?status=ACTIVE&frequency=MONTHLY' },
    { name: 'Reconciliation status', url: '/api/reconciliation/transactions?status=UNMATCHED' },
    { name: 'Audit severity', url: '/api/audit?severity=INFO' },
    { name: 'Users role & status', url: '/api/users?role=admin&status=ACTIVE' }
  ];

  for (const ft of filterTests) {
    const res = await fetch(`${baseUrl}${ft.url}`, { headers });
    assert.equal(res.status, 200, `Filter ${ft.name} must return 200`);
    const data = await res.json();
    assert.ok(typeof data.total === 'number', `Filter ${ft.name} response must include total`);
    console.log(` [PASS] Filter ${ft.name}: total=${data.total}`);
  }

  // 5. Test Edge Cases & Input Validation
  console.log('\n5. Verifying Backend Edge Cases...');

  // Invalid page: negative or non-integer returns 400 INVALID_PAGINATION
  const invPageRes = await fetch(`${baseUrl}/api/invoices?page=-5`, { headers });
  assert.equal(invPageRes.status, 400, 'Negative page must return 400 INVALID_PAGINATION');
  const invPageData = await invPageRes.json();
  assert.equal(invPageData.error.code, 'INVALID_PAGINATION');

  const abcPageRes = await fetch(`${baseUrl}/api/invoices?page=invalid`, { headers });
  assert.equal(abcPageRes.status, 400, 'Non-integer page must return 400 INVALID_PAGINATION');

  // Invalid page_size: <= 0 or > 100 returns 400 INVALID_PAGINATION
  const zeroSizeRes = await fetch(`${baseUrl}/api/invoices?page_size=0`, { headers });
  assert.equal(zeroSizeRes.status, 400, 'Zero page_size must return 400 INVALID_PAGINATION');

  const hugeSizeRes = await fetch(`${baseUrl}/api/invoices?page_size=500`, { headers });
  assert.equal(hugeSizeRes.status, 400, 'Excessive page_size (>100) must return 400 INVALID_PAGINATION');

  // Valid large page number within integer bounds: returns 200 with empty items
  const hugePageRes = await fetch(`${baseUrl}/api/invoices?page=999999`, { headers });
  assert.equal(hugePageRes.status, 200, 'Large page number must return 200 with empty items');
  const hugePageData = await hugePageRes.json();
  assert.equal(hugePageData.items.length, 0, 'Items should be empty for out-of-range page');
  assert.ok(hugePageData.total >= 0, 'Total should still be correct');

  // Vietnamese diacritics search
  const vnSearchRes = await fetch(`${baseUrl}/api/customers?q=${encodeURIComponent('Việt Nam')}`, { headers });
  assert.equal(vnSearchRes.status, 200, 'Vietnamese Unicode search should succeed');

  // Special characters in search
  const specSearchRes = await fetch(`${baseUrl}/api/invoices?q=${encodeURIComponent("'; DROP TABLE invoices;--")}`, { headers });
  assert.equal(specSearchRes.status, 200, 'SQL injection probe in search should safely return 200');

  console.log(' [PASS] Edge cases (negative page 400, page_size bounds 400, large page empty 200, Vietnamese, SQL injection) handled safely.');

  // 6. Security Invariant: Verify NO password, hash, or secrets leaked
  console.log('\n6. Verifying Security Invariant (No sensitive credentials in responses)...');
  const usersRes = await fetch(`${baseUrl}/api/users`, { headers });
  const usersData = await usersRes.json();
  for (const user of usersData.items || usersData.users || []) {
    assert.equal(user.password, undefined, 'User object MUST NOT contain password');
    assert.equal(user.password_hash, undefined, 'User object MUST NOT contain password_hash');
    assert.equal(user.token, undefined, 'User object MUST NOT contain token');
    assert.equal(user.secret, undefined, 'User object MUST NOT contain secret');
  }
  console.log(' [PASS] User list endpoint strictly excludes all password/secret fields.');

  // 7. Frontend bundle checks: UTF-8 BOM CSV, Toolbar, Pagination, URL persistence
  console.log('\n7. Verifying Frontend app.js Core UX Components...');
  const jsRes = await fetch(`${baseUrl}/app.js`);
  assert.equal(jsRes.status, 200);
  const jsText = await jsRes.text();

  assert.ok(jsText.includes('\\uFEFF'), 'app.js downloadCsv must prepend UTF-8 BOM (\\uFEFF) for Excel Vietnamese support');
  assert.ok(jsText.includes('function renderPagination'), 'app.js must define renderPagination');
  assert.ok(jsText.includes('function renderTableToolbar'), 'app.js must define renderTableToolbar');
  assert.ok(jsText.includes('function parseUrlQuery'), 'app.js must define parseUrlQuery');
  assert.ok(jsText.includes('function updateUrlQuery'), 'app.js must define updateUrlQuery');
  assert.ok(jsText.includes('downloadCsv'), 'app.js must include CSV export functionality');
  assert.ok(jsText.includes('pagination-size-select'), 'app.js must include page size selector options 15, 20, 50');

  console.log(' [PASS] All frontend UX components (BOM CSV, Toolbar, Pagination, URL query sync) verified in bundle.');

  console.log('\n================================================================');
  console.log('       ALL LARGE LISTS UX & PAGINATION VERIFICATIONS PASSED!    ');
  console.log('================================================================');
}

runTest().catch((err) => {
  console.error('\n[FAIL] Test encountered error:', err);
  process.exit(1);
});
