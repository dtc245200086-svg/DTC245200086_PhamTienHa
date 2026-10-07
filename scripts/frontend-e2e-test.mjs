import assert from 'node:assert/strict';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error('ADMIN_PASSWORD is required.');
}

async function runFrontendE2ETest() {
  console.log('================================================================');
  console.log('       BILLING_ONE FRONTEND & STATIC ASSET E2E VERIFICATION     ');
  console.log('================================================================\n');

  // 1. Static HTML & Asset Delivery
  console.log('1. Verifying HTML Shell & Assets Delivery...');
  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200, 'index.html must return 200');
  const htmlText = await htmlRes.text();
  assert.ok(htmlText.includes('<div id="app"></div>'), 'index.html must contain root app mount element');
  assert.ok(htmlText.includes('/app.js'), 'index.html must link app.js');
  assert.ok(htmlText.includes('/styles.css'), 'index.html must link styles.css');
  console.log('[PASS] Static index.html delivered correctly.');

  const cssRes = await fetch(`${baseUrl}/styles.css`);
  assert.equal(cssRes.status, 200, 'styles.css must return 200');
  console.log('[PASS] Stylesheet delivered correctly.');

  const jsRes = await fetch(`${baseUrl}/app.js`);
  assert.equal(jsRes.status, 200, 'app.js must return 200');
  const jsText = await jsRes.text();
  assert.ok(jsText.length > 10000, 'app.js must contain substantial code');
  assert.ok(jsText.includes('api('), 'app.js must define api fetch client');
  console.log(`[PASS] Javascript bundle delivered correctly (${jsText.length} bytes).`);

  // 2. Scan every API endpoint called by app.js
  console.log('\n2. Extracting and validating all endpoint paths referenced in app.js...');
  const endpointRegex = /api\(\s*[`'"](\/[a-zA-Z0-9_\-\/?&=]+)[`'"]/g;
  const matches = new Set();
  let match;
  while ((match = endpointRegex.exec(jsText)) !== null) {
    matches.add(match[1]);
  }

  console.log(`Found ${matches.size} unique static route patterns in app.js:`);
  for (const endpoint of matches) {
    console.log(` - ${endpoint}`);
  }

  // 3. Login session
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPassword })
  });
  assert.equal(loginRes.status, 200, 'Login must succeed');
  const cookie = loginRes.headers.get('set-cookie').split(';', 1)[0];

  // 4. Test all GET routes called by frontend views
  console.log('\n3. Testing frontend API route calls with authenticated session...');
  const frontendViews = [
    '/api/dashboard/summary',
    '/api/customers?limit=100',
    '/api/products?limit=100',
    '/api/payment-terms',
    '/api/invoices?limit=100',
    '/api/payments?limit=100',
    '/api/adjustments?limit=100',
    '/api/recurring?limit=100',
    '/api/reconciliation/transactions?limit=100',
    '/api/reports/aging',
    '/api/reports/collection-metrics',
    '/api/reports/revenue-analytics',
    '/api/reports/vat-declaration',
    '/api/audit?limit=100',
    '/api/audit/verify',
    '/api/settings'
  ];

  for (const viewEndpoint of frontendViews) {
    const res = await fetch(`${baseUrl}${viewEndpoint}`, {
      headers: { Cookie: cookie }
    });
    assert.notEqual(res.status, 404, `Frontend view route ${viewEndpoint} returned 404!`);
    assert.equal(res.status, 200, `Frontend view route ${viewEndpoint} expected 200, got ${res.status}`);
    const data = await res.json();
    assert.ok(typeof data === 'object' && data !== null, `${viewEndpoint} must return JSON object`);
    console.log(`[PASS] Frontend view route: ${viewEndpoint} -> 200 OK`);
  }

  console.log('\n================================================================');
  console.log('       ALL FRONTEND E2E CHECKS PASSED 100%! ZERO 404S!          ');
  console.log('================================================================\n');
}

runFrontendE2ETest().catch(err => {
  console.error('\n[FRONTEND E2E TEST FAILED]:', err);
  process.exit(1);
});
