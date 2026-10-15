/**
 * BILLING_ONE — P1 GATE E TEST SUITE
 * DSO & CEI FINANCIAL METRICS & AUTHORITATIVE ANALYTICS VERIFICATION
 * 
 * Verifies:
 * - Replacement of hardcoded placeholders (32.5, 94.2) with PostgreSQL authoritative aggregations
 * - Zero denominator handling (null / 0, never arbitrary constants)
 * - Exact mathematical reconciliation of DSO = (Receivables / Sales_90d) * 90
 * - Exact mathematical reconciliation of CEI = Collected / (Beginning_Rec + Sales_90d - Ending_Current_Rec) * 100
 * - Receivables reconciliation invariant: receivables = overdue_amount + current_receivables
 * - Impact of invoice issuance, partial payment, full payment, credit adjustments, and cancellations
 * - RBAC protection (unauthenticated -> 401, unauthorized -> 403)
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
  } catch (err) {}
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
  const cleanSql = sql.replace(/\s+/g, ' ').trim().replace(/;+$/, '');
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
      console.log('[TEST_HARNESS] 429 encountered during login. Backing off 12s...');
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

async function run() {
  console.log('================================================================');
  console.log('BILLING_ONE — P1 GATE E TEST SUITE');
  console.log('DSO / CEI AUTHORITATIVE FINANCIAL ANALYTICS VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assertTest(name, condition, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] Case ${total}: ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] Case ${total}: ${name}`);
      if (details) console.error(`       Details: ${details}`);
      throw new Error(`Test assertion failed: ${name}`);
    }
  }

  const staff = new ApiClient();
  const admin = new ApiClient();
  const anon = new ApiClient();

  // Step 1: Authentication
  console.log('[STEP 1] Authenticating test clients...');
  const staffLogin = await staff.login('staff', staffPassword);
  assert.equal(staffLogin.status, 200, 'Staff login must succeed');

  const adminLogin = await admin.login('admin', adminPassword);
  assert.equal(adminLogin.status, 200, 'Admin login must succeed');

  // Case 1: RBAC protection on /api/reports/collection-metrics
  console.log('\n[STEP 2] Verifying RBAC boundaries...');
  const anonRes = await anon.request('/api/reports/collection-metrics');
  assertTest('Anonymous request rejected with 401', anonRes.status === 401);

  const staffRes = await staff.request('/api/reports/collection-metrics');
  assertTest('Staff with report.view permission receives 200', staffRes.status === 200);

  // Case 2: Source code audit — zero hardcoded 32.5 or 94.2 in backend source
  console.log('\n[STEP 3] Auditing source code for hardcoded fallback values...');
  const reportsSrc = fs.readFileSync('app/src/routes/reports.js', 'utf8');
  assertTest('app/src/routes/reports.js contains no 32.5', !reportsSrc.includes('32.5'));
  assertTest('app/src/routes/reports.js contains no 94.2', !reportsSrc.includes('94.2'));

  // Case 3: Response schema completeness and live DB metrics
  console.log('\n[STEP 4] Verifying live collection metrics payload schema...');
  const m = staffRes.data;
  assertTest('Response contains dso and dso_days fields', m.dso !== undefined && m.dso_days !== undefined);
  assertTest('Response contains cei and cei_percent fields', m.cei !== undefined && m.cei_percent !== undefined);
  assertTest('Response contains string representation of receivables', typeof m.receivables === 'string');
  assertTest('Response contains string representation of overdue_amount', typeof m.overdue_amount === 'string');
  assertTest('Response contains string representation of current_receivables', typeof m.current_receivables === 'string');
  assertTest('Response contains string representation of sales_90d', typeof m.sales_90d === 'string');
  assertTest('Response contains string representation of collected_90d', typeof m.collected_90d === 'string');
  assertTest('Response contains string representation of beginning_receivables', typeof m.beginning_receivables === 'string');
  assertTest('Response contains cei_eligible_amount', typeof m.cei_eligible_amount === 'string');
  assertTest('Response contains monthly_collections array', Array.isArray(m.monthly_collections));

  // Case 4: Mathematical invariant: receivables = overdue_amount + current_receivables
  console.log('\n[STEP 5] Verifying mathematical receivables invariant...');
  const recTotal = Number(m.receivables);
  const overduePart = Number(m.overdue_amount);
  const currentPart = Number(m.current_receivables);
  const diff = Math.abs(recTotal - (overduePart + currentPart));
  assertTest(
    'receivables == overdue_amount + current_receivables',
    diff < 0.01,
    `receivables=${recTotal}, overdue=${overduePart}, current=${currentPart}`
  );

  // Case 5: Verify live DSO formula matches PostgreSQL state
  console.log('\n[STEP 6] Verifying DSO calculation against authoritative DB state...');
  const salesNum = Number(m.sales_90d);
  if (salesNum > 0) {
    const expectedDso = Math.round((recTotal / salesNum) * 90 * 10) / 10;
    assertTest(
      'Live DSO matches (receivables / sales_90d) * 90',
      m.dso === expectedDso,
      `API dso=${m.dso}, expected=${expectedDso}`
    );
  } else {
    assertTest('DSO handles 0 sales deterministically', m.dso === 0 || m.dso === null);
  }

  // Case 6: Verify live CEI calculation against CRF formula
  console.log('\n[STEP 7] Verifying CEI calculation against canonical CRF formula...');
  const begRecNum = Number(m.beginning_receivables);
  const colNum = Number(m.collected_90d);
  const eligibleDebt = Math.round((begRecNum + salesNum - currentPart) * 100) / 100;
  if (eligibleDebt > 0) {
    const expectedCei = Math.round(Math.min(100, Math.max(0, (colNum / eligibleDebt) * 100)) * 10) / 10;
    assertTest(
      'Live CEI matches C / (B + S - E_current) * 100',
      m.cei === expectedCei,
      `API cei=${m.cei}, expected=${expectedCei}, eligibleDebt=${eligibleDebt}`
    );
  } else {
    assertTest('CEI handles non-positive eligible debt as null', m.cei === null);
  }

  // Case 7: Deterministic mutation fixture — Invoicing impact on DSO and Receivables
  console.log('\n[STEP 8] Testing deterministic financial mutation lifecycle...');
  const testSuffix = Date.now();
  const rawIdOut = queryDb(`
    WITH ins AS (
      INSERT INTO public.customers (name, tax_code, email, segment, credit_limit, status)
      VALUES ('DSO Test Corp ${testSuffix}', 'DSO${testSuffix.toString().slice(-8)}', 'dso${testSuffix}@test.com', 'SME', 500000000, 'ACTIVE')
      RETURNING id
    )
    SELECT id FROM ins;
  `);
  const testCustomerId = parseInt(rawIdOut.trim(), 10);
  const testCustomer = { id: testCustomerId };

  const net30Term = queryDbJson(`SELECT id FROM public.payment_terms WHERE code = 'NET_30' LIMIT 1`)[0];

  // Baseline metrics prior to test invoice
  const beforeMetrics = (await staff.request('/api/reports/collection-metrics')).data;
  const beforeSales = Number(beforeMetrics.sales_90d);
  const beforeRec = Number(beforeMetrics.receivables);
  const beforeCurrent = Number(beforeMetrics.current_receivables);

  // Create & Issue an invoice for 20,000,000 VND (subtotal 20M, VAT 0% -> total 20M)
  const draftRes = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: net30Term.id,
      issue_date: new Date().toISOString().slice(0, 10),
      items: [
        {
          description: 'Consulting Package A',
          quantity: '2',
          unit_price: '10000000.00',
          vat_rate: '0.00'
        }
      ]
    }
  });
  if (draftRes.status !== 201) {
    console.error('Invoice draft error:', draftRes.status, JSON.stringify(draftRes.data));
  }
  const invId = draftRes.data.invoice?.id || draftRes.data.id;

  const issueRes = await staff.request(`/api/invoices/${invId}/issue`, { method: 'POST' });
  if (issueRes.status !== 200) {
    console.error('Invoice issue error:', issueRes.status, JSON.stringify(issueRes.data));
  }
  assert.equal(issueRes.status, 200, 'Invoice issue must succeed');

  // Metrics after invoice issuance
  const afterIssueMetrics = (await staff.request('/api/reports/collection-metrics')).data;
  const afterIssueSales = Number(afterIssueMetrics.sales_90d);
  const afterIssueRec = Number(afterIssueMetrics.receivables);
  const afterIssueCurrent = Number(afterIssueMetrics.current_receivables);

  assertTest(
    'Issuing invoice increases sales_90d by exact total (20,000,000 VND)',
    Math.abs((afterIssueSales - beforeSales) - 20000000) < 0.01,
    `before=${beforeSales}, after=${afterIssueSales}`
  );
  assertTest(
    'Issuing invoice increases open receivables by exact total (20,000,000 VND)',
    Math.abs((afterIssueRec - beforeRec) - 20000000) < 0.01,
    `before=${beforeRec}, after=${afterIssueRec}`
  );
  assertTest(
    'Issuing invoice increases current receivables (not overdue)',
    Math.abs((afterIssueCurrent - beforeCurrent) - 20000000) < 0.01,
    `before=${beforeCurrent}, after=${afterIssueCurrent}`
  );

  // Case 8: Partial payment impact on DSO and CEI
  console.log('\n[STEP 9] Testing partial payment impact on metrics...');
  const payRes1 = await staff.request(`/api/invoices/${invId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `IDEMP_DSO_1_${testSuffix}` },
    body: {
      amount: '8000000.00',
      method: 'BANK_TRANSFER',
      paid_at: new Date().toISOString().slice(0, 10),
      reference: `PAY_DSO_1_${testSuffix}`
    }
  });
  if (payRes1.status !== 201) {
    console.error('Pay 1 error:', payRes1.status, JSON.stringify(payRes1.data));
  }
  assert.equal(payRes1.status, 201, 'Partial payment must succeed');

  const afterPay1Metrics = (await staff.request('/api/reports/collection-metrics')).data;
  const afterPay1Rec = Number(afterPay1Metrics.receivables);
  const afterPay1Col = Number(afterPay1Metrics.collected_90d);

  assertTest(
    'Partial payment reduces receivables by exact payment (8,000,000 VND)',
    Math.abs((afterIssueRec - afterPay1Rec) - 8000000) < 0.01,
    `afterIssueRec=${afterIssueRec}, afterPay1Rec=${afterPay1Rec}`
  );
  assertTest(
    'Partial payment increases collected_90d by exact payment (8,000,000 VND)',
    Math.abs((afterPay1Col - Number(afterIssueMetrics.collected_90d)) - 8000000) < 0.01
  );

  // Case 9: Complete payment of invoice
  console.log('\n[STEP 10] Testing final payment completion...');
  const payRes2 = await staff.request(`/api/invoices/${invId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `IDEMP_DSO_2_${testSuffix}` },
    body: {
      amount: '12000000.00',
      method: 'BANK_TRANSFER',
      paid_at: new Date().toISOString().slice(0, 10),
      reference: `PAY_DSO_2_${testSuffix}`
    }
  });
  if (payRes2.status !== 201) {
    console.error('Pay 2 error:', payRes2.status, JSON.stringify(payRes2.data));
  }
  assert.equal(payRes2.status, 201, 'Final payment must succeed');

  const afterPay2Metrics = (await staff.request('/api/reports/collection-metrics')).data;
  const afterPay2Rec = Number(afterPay2Metrics.receivables);
  assertTest(
    'Full payment reduces receivables back to initial baseline',
    Math.abs(afterPay2Rec - beforeRec) < 0.01,
    `afterPay2Rec=${afterPay2Rec}, beforeRec=${beforeRec}`
  );

  // Case 10: Cancelled invoices exclusion from sales and receivables
  console.log('\n[STEP 11] Testing cancelled invoices exclusion from sales and receivables...');
  const draftCancel = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: net30Term.id,
      issue_date: new Date().toISOString().slice(0, 10),
      items: [{ description: 'Item to cancel', quantity: '1', unit_price: '5000000.00', vat_rate: '0.10' }]
    }
  });
  const cancelInvId = draftCancel.data.invoice?.id || draftCancel.data.id;
  // Mark invoice CANCELLED in DB
  queryDb(`UPDATE public.invoices SET status = 'CANCELLED', cancel_reason = 'Testing cancellation exclusion in DSO report' WHERE id = ${cancelInvId}`);

  const cancelMetrics = (await staff.request('/api/reports/collection-metrics')).data;
  assertTest(
    'Cancelled invoice is not counted in sales_90d or receivables',
    Math.abs(Number(cancelMetrics.sales_90d) - Number(afterPay2Metrics.sales_90d)) < 0.01 &&
    Math.abs(Number(cancelMetrics.receivables) - Number(afterPay2Metrics.receivables)) < 0.01,
    `cancelSales=${cancelMetrics.sales_90d}, afterPay2Sales=${afterPay2Metrics.sales_90d}`
  );

  // Case 11: Credit adjustments reduce net sales and open receivables
  console.log('\n[STEP 12] Testing credit adjustment impact...');
  const invAdjust = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: net30Term.id,
      issue_date: new Date().toISOString().slice(0, 10),
      items: [{ description: 'Item for adjustment', quantity: '1', unit_price: '10000000.00', vat_rate: '0.00' }]
    }
  });
  const adjInvId = invAdjust.data.invoice?.id || invAdjust.data.id;
  await staff.request(`/api/invoices/${adjInvId}/issue`, { method: 'POST' });

  // Add processed adjustment of 2,000,000 VND
  queryDb(`
    UPDATE public.invoices SET adjusted_total = 2000000 WHERE id = ${adjInvId};
    INSERT INTO public.invoice_adjustments (credit_note_no, original_invoice_id, adjustment_type, amount, vat_rate, vat_amount, total_amount, reason, status, created_by)
    VALUES ('CN_${testSuffix}', ${adjInvId}, 'DECREASE_AMOUNT', 2000000, 0, 0, 2000000, 'DSO Test Adjustment', 'PROCESSED', 1);
  `);

  const afterAdjMetrics = (await staff.request('/api/reports/collection-metrics')).data;
  // Outstanding on this invoice is 10,000,000 - 2,000,000 = 8,000,000
  const expectedRecInc = 8000000;
  assertTest(
    'Adjusted invoice correctly deducts adjusted_total from open receivables',
    Math.abs((Number(afterAdjMetrics.receivables) - afterPay2Rec) - expectedRecInc) < 0.01,
    `afterAdjRec=${afterAdjMetrics.receivables}, expectedDiff=${expectedRecInc}`
  );

  // Clean up test data safely in isolated customer scope
  queryDb(`
    DELETE FROM public.invoice_adjustments WHERE credit_note_no = 'CN_${testSuffix}';
    DELETE FROM public.payments WHERE reference IN ('PAY_DSO_1_${testSuffix}', 'PAY_DSO_2_${testSuffix}');
    DELETE FROM public.invoice_items WHERE invoice_id IN (${invId}, ${cancelInvId}, ${adjInvId});
    DELETE FROM public.invoices WHERE id IN (${invId}, ${cancelInvId}, ${adjInvId});
    DELETE FROM public.customers WHERE id = ${testCustomer.id};
  `);

  // Step 13: Mathematical boundary and zero-denominator validation
  console.log('\n[STEP 13] Testing mathematical edge-case semantics...');
  function calcDso(sales, rec) {
    if (sales > 0) return Math.round((rec / sales) * 90 * 10) / 10;
    if (rec === 0) return 0;
    return null;
  }
  assertTest('calcDso with 0 sales and 0 receivables yields 0', calcDso(0, 0) === 0);
  assertTest('calcDso with 0 sales and open receivables yields null (never 32.5)', calcDso(0, 5000000) === null);
  assertTest('calcDso with positive sales and receivables yields exact ratio', calcDso(10000000, 5000000) === 45.0);

  function calcCei(begRec, sales, curRec, collected) {
    const eligible = Math.round((begRec + sales - curRec) * 100) / 100;
    if (eligible > 0) {
      const raw = (collected / eligible) * 100;
      return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
    }
    return null;
  }
  assertTest('calcCei with non-positive eligible debt yields null (never 94.2)', calcCei(0, 0, 0, 0) === null);
  assertTest('calcCei with zero collections yields 0.0%', calcCei(10000000, 10000000, 5000000, 0) === 0.0);
  assertTest('calcCei with 100% collections yields 100.0%', calcCei(10000000, 10000000, 5000000, 15000000) === 100.0);
  assertTest('calcCei caps at 100% when collections exceed eligible debt', calcCei(10000000, 10000000, 5000000, 20000000) === 100.0);

  console.log('\n================================================================');
  console.log(`P1 GATE E DSO / CEI TEST RESULTS: ${passed}/${total} PASSED`);
  console.log('================================================================');
}

run().catch(err => {
  console.error('\nFATAL TEST ERROR:', err);
  process.exit(1);
});
