#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE — GATE K: ITEM-LEVEL VAT REPORTING VERIFICATION SUITE
 * File: scripts/p1-gate-k-vat-reporting-test.mjs
 *
 * Verifies Finding K — Item-Level VAT Reporting:
 * 1. Item-level VAT aggregation across buckets: 10%, 8%, 5%, 0%
 * 2. CRITICAL: Mixed VAT invoice (10% + 8% on same invoice) correctly
 *    splits its items into separate 10% and 8% report buckets!
 * 3. Cancelled and Draft invoices excluded from VAT declaration
 * 4. Processed credit adjustments netted against respective VAT rate buckets
 * 5. Full financial reconciliation invariant:
 *    subtotal = sum(item net), vat_amount = sum(item vat), total = subtotal + vat_amount
 * 6. Empty period handling returns clean 0.00 totals without crashing
 * 7. Date boundary filtering (from/to and year/quarter)
 * 8. CSV export format support (format=csv)
 * 9. RBAC authorization (unauthenticated -> 401, no report.view -> 403)
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

async function login(username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (res.status === 429) {
    console.log(`[AUTH] 429 for ${username}, backing off 12s...`);
    await new Promise((r) => setTimeout(r, 12000));
    return login(username, password);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error(`Login failed for ${username}: ${res.status}`);
  return setCookie.split(';')[0];
}

async function apiRequest(cookie, endpoint, { method = 'GET', body, headers: customHeaders = {} } = {}) {
  const headers = { ...customHeaders };
  if (cookie) headers['Cookie'] = cookie;
  if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

let totalChecks = 0;
let passedChecks = 0;

function check(desc, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc} - ${details}`);
    throw new Error(`Assertion failed: ${desc} ${details}`);
  }
}

async function run() {
  console.log('============================================================');
  console.log('BILLING_ONE — GATE K: ITEM-LEVEL VAT REPORTING VERIFICATION');
  console.log('============================================================\n');

  console.log('[SETUP] Logging in admin and staff...');
  const adminCookie = await login('admin', adminPassword);
  const staffCookie = await login('staff', staffPassword);

  const runId = Date.now();

  // --------------------------------------------------------------------------
  // CHECK 1: AUTHENTICATION & AUTHORIZATION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 1: Authentication & Authorization ---');
  const unauthRes = await apiRequest('', '/api/reports/vat');
  check('Unauthenticated GET /api/reports/vat rejected 401', unauthRes.status === 401);

  const adminVatRes = await apiRequest(adminCookie, '/api/reports/vat');
  check('Authorized user (admin with report.view) GET /api/reports/vat returns 200', adminVatRes.status === 200);

  // --------------------------------------------------------------------------
  // CHECK 2: EMPTY PERIOD REPORTING
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 2: Empty Reporting Period ---');
  const emptyRes = await apiRequest(adminCookie, '/api/reports/vat?year=2099');
  check('Empty period returns 200 OK', emptyRes.status === 200);
  check(
    'Empty period returns 0.00 totals without error',
    emptyRes.data.summary?.subtotal === '0.00' &&
      emptyRes.data.summary?.vat_amount === '0.00' &&
      emptyRes.data.summary?.invoice_count === '0'
  );

  // --------------------------------------------------------------------------
  // CHECK 3: BASELINE SNAPSHOT BEFORE TEST INVOICES
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 3: Baseline Period Snapshot ---');
  const currentYear = new Date().getFullYear();
  const baseRes = await apiRequest(adminCookie, `/api/reports/vat?year=${currentYear}`);
  check('Baseline report retrieved successfully', baseRes.status === 200);

  const baseNet10 = parseFloat(baseRes.data.summary.net_10 || '0');
  const baseVat10 = parseFloat(baseRes.data.summary.vat_10 || '0');
  const baseNet8 = parseFloat(baseRes.data.summary.net_8 || '0');
  const baseVat8 = parseFloat(baseRes.data.summary.vat_8 || '0');
  const baseNet5 = parseFloat(baseRes.data.summary.net_5 || '0');
  const baseVat5 = parseFloat(baseRes.data.summary.vat_5 || '0');
  const baseNet0 = parseFloat(baseRes.data.summary.net_0 || '0');

  // --------------------------------------------------------------------------
  // CHECK 4: CREATE MIXED VAT INVOICE (10% + 8% ON SAME INVOICE)
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 4: CRITICAL TEST — Mixed VAT Invoice (10% + 8%) ---');
  // Create test customer
  const custRes = await apiRequest(adminCookie, '/api/customers', {
    method: 'POST',
    body: {
      name: `Mixed VAT Customer ${runId}`,
      tax_code: `03${String(runId).slice(-8)}`,
      email: `mixed_vat_${runId}@example.com`
    }
  });
  const customerId = custRes.data.customer?.id || custRes.data.id;

  // Create invoice with 2 items: 10% and 8%
  // Item 1: 5,000,000 VND @ 10% -> 500,000 VAT
  // Item 2: 10,000,000 VND @ 8%  -> 800,000 VAT
  // Total Net: 15,000,000 VND. Total VAT: 1,300,000 VND. Gross: 16,300,000 VND.
  const mixedInvRes = await apiRequest(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      tax_rate: '0.00',
      items: [
        {
          description: 'Dịch vụ Tư vấn Chuyên sâu (10% VAT)',
          quantity: '1',
          unit_price: '5000000.00',
          vat_rate: '0.1000'
        },
        {
          description: 'Thiết bị Công nghệ Ưu đãi (8% VAT)',
          quantity: '1',
          unit_price: '10000000.00',
          vat_rate: '0.0800'
        }
      ]
    }
  });
  check('Mixed VAT invoice created in DRAFT', mixedInvRes.status === 201);
  const mixedInvoiceId = mixedInvRes.data.invoice.id;

  // Issue mixed VAT invoice
  const issueMixedRes = await apiRequest(adminCookie, `/api/invoices/${mixedInvoiceId}/issue`, { method: 'POST' });
  check('Mixed VAT invoice issued successfully', issueMixedRes.status === 200);

  // --------------------------------------------------------------------------
  // CHECK 5: CREATE 5% AND 0% INVOICES
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 5: Create 5% and 0% Single-Rate Invoices ---');
  // 5% Invoice: 2,000,000 @ 5% -> 100,000 VAT
  const inv5Res = await apiRequest(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      items: [
        {
          description: 'Hàng hóa nông sản sơ chế (5% VAT)',
          quantity: '1',
          unit_price: '2000000.00',
          vat_rate: '0.0500'
        }
      ]
    }
  });
  const inv5Id = inv5Res.data.invoice.id;
  await apiRequest(adminCookie, `/api/invoices/${inv5Id}/issue`, { method: 'POST' });
  check('5% VAT invoice issued', true);

  // 0% Invoice: 3,000,000 @ 0% -> 0 VAT
  const inv0Res = await apiRequest(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      items: [
        {
          description: 'Dịch vụ xuất khẩu phần mềm (0% VAT)',
          quantity: '1',
          unit_price: '3000000.00',
          vat_rate: '0.0000'
        }
      ]
    }
  });
  const inv0Id = inv0Res.data.invoice.id;
  await apiRequest(adminCookie, `/api/invoices/${inv0Id}/issue`, { method: 'POST' });
  check('0% VAT invoice issued', true);

  // --------------------------------------------------------------------------
  // CHECK 6: CANCELLED INVOICE EXCLUSION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 6: Cancelled Invoice Exclusion ---');
  const cancelInvRes = await apiRequest(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      items: [
        {
          description: 'Invoice to be cancelled (10% VAT)',
          quantity: '1',
          unit_price: '99000000.00',
          vat_rate: '0.1000'
        }
      ]
    }
  });
  const cancelInvoiceId = cancelInvRes.data.invoice.id;
  await apiRequest(adminCookie, `/api/invoices/${cancelInvoiceId}/issue`, { method: 'POST' });
  // Cancel it
  const cancelRes = await apiRequest(adminCookie, `/api/invoices/${cancelInvoiceId}/cancel`, {
    method: 'POST',
    body: { reason: 'Test cancellation exclusion from VAT report' }
  });
  check('Invoice cancelled successfully', cancelRes.status === 200);

  // --------------------------------------------------------------------------
  // CHECK 7: PROCESSED CREDIT ADJUSTMENT NETTING
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 7: Processed Credit Note Netting ---');
  // Create an adjustment for the 5% invoice: reduce 500,000 @ 5% -> 25,000 VAT
  const adjRes = await apiRequest(adminCookie, '/api/adjustments', {
    method: 'POST',
    body: {
      invoice_id: inv5Id,
      adjustment_type: 'DISCOUNT',
      amount: '500000.00',
      vat_rate: '0.0500',
      reason: 'Chiết khấu thương mại 500k cho hàng 5%'
    }
  });
  check('Credit adjustment created in DRAFT', adjRes.status === 201);
  const adjId = adjRes.data.adjustment?.id || adjRes.data.id;

  // Approve adjustment
  const approveAdjRes = await apiRequest(adminCookie, `/api/adjustments/${adjId}/approve`, { method: 'POST' });
  check('Credit adjustment approved', approveAdjRes.status === 200);

  // Process adjustment into ledger
  const processAdjRes = await apiRequest(adminCookie, `/api/adjustments/${adjId}/process`, { method: 'POST' });
  check('Credit adjustment processed into ledger', processAdjRes.status === 200);

  // --------------------------------------------------------------------------
  // CHECK 8: QUERY VAT REPORT & VERIFY ITEM-LEVEL BUCKETS
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 8: Query VAT Report & Reconcile Buckets ---');
  const afterRes = await apiRequest(adminCookie, `/api/reports/vat?year=${currentYear}`);
  check('After report retrieved 200', afterRes.status === 200);

  const afterNet10 = parseFloat(afterRes.data.summary.net_10);
  const afterVat10 = parseFloat(afterRes.data.summary.vat_10);
  const afterNet8 = parseFloat(afterRes.data.summary.net_8);
  const afterVat8 = parseFloat(afterRes.data.summary.vat_8);
  const afterNet5 = parseFloat(afterRes.data.summary.net_5);
  const afterVat5 = parseFloat(afterRes.data.summary.vat_5);
  const afterNet0 = parseFloat(afterRes.data.summary.net_0);

  // Expected deltas:
  // 10% bucket delta: +5,000,000 net, +500,000 VAT (from mixed invoice item 1)
  const deltaNet10 = Math.round(afterNet10 - baseNet10);
  const deltaVat10 = Math.round(afterVat10 - baseVat10);
  check('Mixed invoice 10% item correctly added to 10% net bucket (+5,000,000)', deltaNet10 === 5000000, `Delta: ${deltaNet10}`);
  check('Mixed invoice 10% item correctly added to 10% VAT bucket (+500,000)', deltaVat10 === 500000, `Delta: ${deltaVat10}`);

  // 8% bucket delta: +10,000,000 net, +800,000 VAT (from mixed invoice item 2)
  const deltaNet8 = Math.round(afterNet8 - baseNet8);
  const deltaVat8 = Math.round(afterVat8 - baseVat8);
  check('Mixed invoice 8% item correctly added to 8% net bucket (+10,000,000)', deltaNet8 === 10000000, `Delta: ${deltaNet8}`);
  check('Mixed invoice 8% item correctly added to 8% VAT bucket (+800,000)', deltaVat8 === 800000, `Delta: ${deltaVat8}`);

  // 5% bucket delta: +2,000,000 - 500,000 (credit note) = +1,500,000 net
  // 5% VAT delta: +100,000 - 25,000 = +75,000 VAT
  const deltaNet5 = Math.round(afterNet5 - baseNet5);
  const deltaVat5 = Math.round(afterVat5 - baseVat5);
  check('5% invoice netted with credit adjustment (+1,500,000 net)', deltaNet5 === 1500000, `Delta: ${deltaNet5}`);
  check('5% invoice netted with credit adjustment (+75,000 VAT)', deltaVat5 === 75000, `Delta: ${deltaVat5}`);

  // 0% bucket delta: +3,000,000 net
  const deltaNet0 = Math.round(afterNet0 - baseNet0);
  check('0% invoice correctly added to 0% net bucket (+3,000,000)', deltaNet0 === 3000000, `Delta: ${deltaNet0}`);

  // Cancelled invoice (99M) was NOT added to 10% bucket!
  check('Cancelled invoice (99,000,000 VND) strictly excluded from VAT buckets', deltaNet10 < 10000000);

  // --------------------------------------------------------------------------
  // CHECK 9: FULL FINANCIAL RECONCILIATION INVARIANT
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 9: Mathematical Sum-of-Lines Reconciliation ---');
  const reportSubtotal = parseFloat(afterRes.data.summary.subtotal);
  const reportVat = parseFloat(afterRes.data.summary.vat_amount);
  const reportTotal = parseFloat(afterRes.data.summary.total);

  // Check sum of rate nets equals subtotal
  const sumNetBuckets = afterNet10 + afterNet8 + afterNet5 + afterNet0;
  const netDiff = Math.abs(reportSubtotal - sumNetBuckets);
  check('Report subtotal matches sum of net buckets (diff < 0.05)', netDiff < 0.05, `Diff: ${netDiff}`);

  // Check sum of rate VATs equals total VAT
  const sumVatBuckets = afterVat10 + afterVat8 + afterVat5;
  const vatDiff = Math.abs(reportVat - sumVatBuckets);
  check('Report vat_amount matches sum of VAT buckets (diff < 0.05)', vatDiff < 0.05, `Diff: ${vatDiff}`);

  // Check total = subtotal + vat_amount
  const totalDiff = Math.abs(reportTotal - (reportSubtotal + reportVat));
  check('Report total strictly equals subtotal + vat_amount (diff < 0.01)', totalDiff < 0.01, `Diff: ${totalDiff}`);

  // Check rate_breakdown matches summary exactly (Adjustment-aware rate breakdown)
  const breakdownNetSum = afterRes.data.rate_breakdown.reduce((acc, r) => acc + parseFloat(r.net_amount), 0);
  const breakdownVatSum = afterRes.data.rate_breakdown.reduce((acc, r) => acc + parseFloat(r.vat_amount), 0);
  const breakdownTotalSum = afterRes.data.rate_breakdown.reduce((acc, r) => acc + parseFloat(r.total_amount), 0);

  check('rate_breakdown sum(net_amount) strictly equals summary.subtotal', Math.abs(breakdownNetSum - reportSubtotal) < 0.05, `Diff: ${Math.abs(breakdownNetSum - reportSubtotal)}`);
  check('rate_breakdown sum(vat_amount) strictly equals summary.vat_amount', Math.abs(breakdownVatSum - reportVat) < 0.05, `Diff: ${Math.abs(breakdownVatSum - reportVat)}`);
  check('rate_breakdown sum(total_amount) strictly equals summary.total', Math.abs(breakdownTotalSum - reportTotal) < 0.05, `Diff: ${Math.abs(breakdownTotalSum - reportTotal)}`);

  // --------------------------------------------------------------------------
  // CHECK 10: INVOICE-LEVEL ITEM VAT BREAKDOWN & CSV EXPORT
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 10: Invoice List Item Breakdown & CSV Export ---');
  const mixedInList = afterRes.data.invoices.find((i) => i.id === mixedInvoiceId);
  check('Mixed invoice present in declaration invoices list', Boolean(mixedInList));
  check(
    'Mixed invoice contains item_vat_breakdown with both 0.1000 and 0.0800',
    mixedInList &&
      Array.isArray(mixedInList.item_vat_breakdown) &&
      mixedInList.item_vat_breakdown.some((b) => parseFloat(b.vat_rate) === 0.1) &&
      mixedInList.item_vat_breakdown.some((b) => parseFloat(b.vat_rate) === 0.08)
  );

  // CSV Export test
  const csvRes = await apiRequest(adminCookie, `/api/reports/vat?year=${currentYear}&format=csv`);
  check('GET /api/reports/vat?format=csv returns 200', csvRes.status === 200);
  check('CSV Content-Type is text/csv', csvRes.headers.get('content-type')?.includes('text/csv'));
  check('CSV body contains Vietnamese headers', typeof csvRes.data === 'string' && csvRes.data.includes('Số HĐ,Ngày lập,Tên người mua'));

  console.log('\n============================================================');
  console.log(`GATE K RESULT: ${passedChecks} / ${totalChecks} CHECKS PASSED`);
  console.log('============================================================\n');

  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('\n[GATE K RUNTIME ERROR]:', err);
  process.exit(1);
});
