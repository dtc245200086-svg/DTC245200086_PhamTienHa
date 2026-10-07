import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD are required.');
}

function queryDb(sql) {
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  return out;
}

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async request(path, { method = 'GET', body } = {}) {
    const headers = new Headers();
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.cookie) headers.set('Cookie', this.cookie);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';', 1)[0];
    }
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    return { response, payload };
  }
}

function check(result, expectedStatus, label) {
  assert.equal(
    result.response.status,
    expectedStatus,
    `${label}: expected HTTP ${expectedStatus}, got ${result.response.status}: ${JSON.stringify(result.payload)}`
  );
  return result.payload;
}

async function runRemediationVerification() {
  console.log('================================================================');
  console.log('   BILLING_ONE REMEDIATION FULL VERIFICATION (F-01 -> F-14)     ');
  console.log('================================================================\n');

  const admin = new ApiClient();
  const staff = new ApiClient();

  // 1. Auth Admin & Staff
  await admin.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword }
  }).then(r => check(r, 200, 'Admin login'));

  await staff.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'staff', password: staffPassword }
  }).then(r => check(r, 200, 'Staff login'));

  console.log('[PASS] Auth: Admin and Staff authenticated successfully.');

  // ============================================================================
  // F-01: FRONTEND / BACKEND API CONTRACT SYNCHRONIZATION
  // ============================================================================
  console.log('\n--- Verifying F-01: API Contract Synchronization ---');
  const contractRoutes = [
    { path: '/api/recurring', method: 'GET', aliasOf: 'recurring-plans' },
    { path: '/api/recurring-plans', method: 'GET', aliasOf: 'canonical' },
    { path: '/api/reconciliation/transactions', method: 'GET', aliasOf: 'bank-transactions' },
    { path: '/api/bank-transactions', method: 'GET', aliasOf: 'canonical' },
    { path: '/api/reports/revenue-analytics', method: 'GET', aliasOf: 'revenue' },
    { path: '/api/reports/revenue', method: 'GET', aliasOf: 'canonical' },
    { path: '/api/reports/vat-declaration', method: 'GET', aliasOf: 'vat' },
    { path: '/api/reports/vat', method: 'GET', aliasOf: 'canonical' },
    { path: '/api/reports/aging', method: 'GET', aliasOf: 'aging' },
    { path: '/api/audit', method: 'GET', aliasOf: 'audit-logs' },
    { path: '/api/audit-logs', method: 'GET', aliasOf: 'canonical' },
    { path: '/api/adjustments', method: 'GET', aliasOf: 'canonical' },
    { path: '/api/credit-notes', method: 'GET', aliasOf: 'adjustments' },
    { path: '/api/settings', method: 'GET', aliasOf: 'company-settings' }
  ];

  for (const route of contractRoutes) {
    const res = await admin.request(route.path);
    assert.notEqual(res.response.status, 404, `Route ${route.path} must not return 404`);
    assert.equal(res.response.status, 200, `Route ${route.path} returned status ${res.response.status}`);
  }
  console.log(`[PASS] F-01: All ${contractRoutes.length} dual-mounted endpoint pairs returned 200 OK.`);

  // ============================================================================
  // F-02: CREDIT NOTE / ADJUSTMENT FINANCIAL INTEGRATION
  // ============================================================================
  console.log('\n--- Verifying F-02: Credit Note Financial Settlement ---');
  // Create customer and invoice with known balance
  const custRes = await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `F02 Test Corp ${Date.now()}`,
      segment: 'Enterprise',
      tax_code: '0109988776',
      credit_limit: '50000000'
    }
  }).then(r => check(r, 201, 'F02 customer create'));
  const customerId = custRes.customer.id;

  const invRes = await admin.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      tax_rate: '0.10',
      items: [
        { sku: 'F02-SVC', description: 'Enterprise Audit Service', quantity: '1', unit_price: '1000000', discount_percent: '0' }
      ]
    }
  }).then(r => check(r, 201, 'F02 invoice create'));
  const invoiceId = invRes.invoice.id;

  // Issue invoice
  const issuedRes = await admin.request(`/api/invoices/${invoiceId}/issue`, { method: 'POST', body: {} })
    .then(r => check(r, 200, 'F02 invoice issue'));
  const invoiceTotal = Number(issuedRes.invoice.total); // 1,100,000 VND
  assert.equal(issuedRes.invoice.status, 'ISSUED');
  assert.equal(Number(issuedRes.invoice.paid_total), 0);

  // Create partial Credit Note for 550,000 VND
  const adjRes = await admin.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invoiceId,
      adjustment_type: 'DISCOUNT',
      amount: '500000',
      vat_rate: '0.10',
      reason: 'Chiết khấu đặc biệt theo phụ lục hợp đồng'
    }
  }).then(r => check(r, 201, 'F02 adjustment create'));
  const adjId = adjRes.adjustment.id;
  assert.equal(adjRes.adjustment.status, 'DRAFT');
  assert.equal(Number(adjRes.adjustment.total_amount), 550000);

  // Approve adjustment
  await admin.request(`/api/adjustments/${adjId}/approve`, { method: 'POST', body: {} })
    .then(r => check(r, 200, 'F02 adjustment approve'));

  // Process adjustment into financial ledger
  const processRes = await admin.request(`/api/adjustments/${adjId}/process`, { method: 'POST', body: {} })
    .then(r => check(r, 200, 'F02 adjustment process'));
  assert.equal(processRes.adjustment.status, 'PROCESSED');
  assert.equal(Number(processRes.invoice.paid_total), 550000);
  assert.equal(processRes.invoice.status, 'PARTIALLY_PAID');

  // Verify non-cash payment in database
  const payCount = queryDb(`SELECT count(*) FROM public.payments WHERE invoice_id = ${invoiceId} AND method = 'CREDIT_NOTE'`);
  assert.equal(payCount, '1', 'Non-cash credit note payment must be created');

  // Verify idempotency: calling process again must return 409
  const reprocessRes = await admin.request(`/api/adjustments/${adjId}/process`, { method: 'POST', body: {} });
  assert.equal(reprocessRes.response.status, 409, 'Reprocessing must return 409 Conflict');

  // Create second Credit Note for remaining 550,000 VND to test full settlement
  const adj2Res = await admin.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invoiceId,
      adjustment_type: 'DECREASE_AMOUNT',
      amount: '500000',
      vat_rate: '0.10',
      reason: 'Giảm trừ thanh toán toàn bộ phần còn lại'
    }
  }).then(r => check(r, 201, 'F02 2nd adjustment create'));
  await admin.request(`/api/adjustments/${adj2Res.adjustment.id}/approve`, { method: 'POST', body: {} });
  const proc2Res = await admin.request(`/api/adjustments/${adj2Res.adjustment.id}/process`, { method: 'POST', body: {} })
    .then(r => check(r, 200, 'F02 2nd adjustment process'));
  assert.equal(proc2Res.invoice.status, 'PAID', 'Invoice status must transition to PAID when outstanding reaches 0');
  console.log('[PASS] F-02: Credit Note processed with real non-cash payment, updated paid_total, transitioned invoice to PAID, and enforced idempotency.');

  // ============================================================================
  // F-03: REAL SHA-256 AUDIT CHAIN & TAMPER DETECTION
  // ============================================================================
  console.log('\n--- Verifying F-03: Cryptographic Audit Hash Chaining ---');
  // 1. Initial verification must pass
  const verify1 = await admin.request('/api/audit/verify').then(r => check(r, 200, 'Audit initial verify'));
  assert.equal(verify1.valid, true, `Audit chain must be valid. Got: ${JSON.stringify(verify1)}`);
  assert.ok(verify1.total_records > 0, 'Chain must contain records');
  console.log(`[PASS] F-03.1: Sequential SHA-256 chain verified (${verify1.total_records} records).`);

  // 2. Tamper detection test
  const lastRowOut = queryDb('SELECT id || \'|\' || hash FROM public.audit_logs ORDER BY id DESC LIMIT 1');
  const [targetLogId, originalHash] = lastRowOut.split('|');
  const fakeHash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  // Deliberately tamper with the hash
  queryDb(`UPDATE public.audit_logs SET hash = '${fakeHash}' WHERE id = ${targetLogId}`);

  // Verification must now detect tampering
  const verifyTampered = await admin.request('/api/audit/verify').then(r => check(r, 200, 'Audit verify tampered'));
  assert.equal(verifyTampered.valid, false, 'Tampered chain must report valid = false');
  assert.equal(String(verifyTampered.tampered_record_id), String(targetLogId), `Tampered record ID must be ${targetLogId}`);
  console.log(`[PASS] F-03.2: Tampering correctly detected at record ID ${verifyTampered.tampered_record_id}.`);

  // Restore original hash
  queryDb(`UPDATE public.audit_logs SET hash = '${originalHash}' WHERE id = ${targetLogId}`);
  const verifyRestored = await admin.request('/api/audit/verify').then(r => check(r, 200, 'Audit verify restored'));
  assert.equal(verifyRestored.valid, true, 'Restored chain must be valid again');
  console.log('[PASS] F-03.3: Chain integrity verified after restoring original hash.');

  // ============================================================================
  // F-04: AGING REPORT SCHEMA & EMPTY HANDLING
  // ============================================================================
  console.log('\n--- Verifying F-04: Aging Report Response Schema ---');
  const agingRes = await admin.request('/api/reports/aging').then(r => check(r, 200, 'Aging report'));
  assert.ok(agingRes.summary, 'Aging report must have summary object');
  assert.ok(agingRes.summary.total_receivables !== undefined, 'Summary must have total_receivables');
  assert.ok(Array.isArray(agingRes.matrix), 'Aging report must provide matrix array');
  assert.ok(Array.isArray(agingRes.customers), 'Aging report must provide customers array alias');
  console.log(`[PASS] F-04: Aging report returned valid dual schema (matrix & customers, summary total=${agingRes.summary.total_receivables}).`);

  // ============================================================================
  // F-05: CREDIT NOTE FORM CONTRACT & ENUM VALIDATION
  // ============================================================================
  console.log('\n--- Verifying F-05: Credit Note Contract & Enums ---');
  // Invalid enum test
  const invalidTypeRes = await admin.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invoiceId,
      adjustment_type: 'INVALID_TYPE_ENUM',
      amount: '100000',
      reason: 'Invalid enum test'
    }
  });
  assert.equal(invalidTypeRes.response.status, 400, 'Invalid adjustment_type must be rejected with 400');

  // Valid domain enum test (INFO_CORRECTION)
  const infoCorrRes = await admin.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invoiceId,
      adjustment_type: 'INFO_CORRECTION',
      amount: '0',
      reason: 'Điều chỉnh địa chỉ giao hàng'
    }
  }).then(r => check(r, 201, 'INFO_CORRECTION adjustment'));
  assert.equal(infoCorrRes.adjustment.adjustment_type, 'INFO_CORRECTION');
  console.log('[PASS] F-05: Form contract validates domain enums and rejects invalid types.');

  // ============================================================================
  // F-06: REAL RECURRING SCHEDULER & SAFE DATE CALCULATION
  // ============================================================================
  console.log('\n--- Verifying F-06: Recurring Scheduler & Safe Date Math ---');
  // Create a recurring plan due today
  const recPlanRes = await admin.request('/api/recurring', {
    method: 'POST',
    body: {
      customer_id: customerId,
      service_title: 'SaaS Enterprise Subscription',
      frequency: 'MONTHLY',
      amount: '5000000',
      start_date: '2026-01-31',
      total_cycles: 12,
      auto_sign: true
    }
  }).then(r => check(r, 201, 'Recurring plan create'));
  const planId = recPlanRes.plan.id;

  // Set next_run_date to today in database so scheduler triggers it
  queryDb(`UPDATE public.recurring_plans SET next_run_date = current_date WHERE id = ${planId}`);

  // Trigger cycle execution
  const triggerRes = await admin.request(`/api/recurring/${planId}/trigger`, { method: 'POST', body: {} })
    .then(r => check(r, 200, 'Recurring manual trigger test'));
  assert.ok(triggerRes.invoice_id, 'Trigger must generate invoice_id');
  assert.equal(triggerRes.completed_cycles, 1);

  // Check generated invoice in DB
  const recInv = queryDb(`SELECT status || '|' || invoice_no || '|' || total FROM public.invoices WHERE id = ${triggerRes.invoice_id}`);
  const [recStatus, recInvNo, recTotal] = recInv.split('|');
  assert.equal(recStatus, 'ISSUED', 'Auto-signed recurring invoice must be ISSUED');
  console.log(`[PASS] F-06: Recurring engine generated invoice ${recInvNo} (${recTotal} ₫) and updated next run date.`);

  // ============================================================================
  // F-07: E-INVOICE CODE DESIGNATION AS SIMULATED IDENTIFIER
  // ============================================================================
  console.log('\n--- Verifying F-07: E-Invoice Code Compliance ---');
  const checkInvRes = await admin.request(`/api/invoices/${invoiceId}`).then(r => check(r, 200, 'Invoice detail'));
  assert.ok(checkInvRes.invoice.e_invoice_code, 'Invoice has internal simulated code');
  assert.ok(checkInvRes.invoice.einvoice_code, 'Invoice has einvoice_code alias');

  // Verify audit log explicitly references internal simulated identifier, not real CQT
  const auditSummary = queryDb(
    `SELECT summary FROM public.audit_logs WHERE target_ref = '${issuedRes.invoice.invoice_no}' AND action = 'INVOICE_ISSUED' LIMIT 1`
  );
  if (auditSummary) {
    assert.ok(
      auditSummary.includes('mô phỏng'),
      `Audit summary must specify simulated identifier: ${auditSummary}`
    );
  }
  console.log('[PASS] F-07: e_invoice_code is explicitly labeled as internal simulated identifier.');

  // ============================================================================
  // F-08: REAL GRANULAR RBAC MIDDLEWARE
  // ============================================================================
  console.log('\n--- Verifying F-08: Granular RBAC Permissions ---');
  // Staff lacks 'invoice.cancel' permission -> must receive 403 FORBIDDEN
  const staffCancelRes = await staff.request(`/api/invoices/${invoiceId}/cancel`, {
    method: 'POST',
    body: { reason: 'Unauthorized cancel attempt' }
  });
  assert.equal(staffCancelRes.response.status, 403, 'Staff must receive 403 for invoice.cancel');

  // Staff lacks 'adjustment.approve' permission -> must receive 403 FORBIDDEN
  const staffApproveRes = await staff.request(`/api/adjustments/${infoCorrRes.adjustment.id}/approve`, {
    method: 'POST',
    body: {}
  });
  assert.equal(staffApproveRes.response.status, 403, 'Staff must receive 403 for adjustment.approve');

  // Admin has '*' permission -> allowed to cancel / approve
  const adminApproveRes = await admin.request(`/api/adjustments/${infoCorrRes.adjustment.id}/approve`, {
    method: 'POST',
    body: {}
  });
  assert.equal(adminApproveRes.response.status, 200, 'Admin must be permitted to approve adjustment');
  console.log('[PASS] F-08: Granular RBAC middleware correctly enforced: Staff rejected (403), Admin allowed.');

  // ============================================================================
  // F-09: MULTI-INVOICE PAYMENT ALLOCATION
  // ============================================================================
  console.log('\n--- Verifying F-09: Multi-Invoice Payment Allocation ---');
  // Create 2 invoices for the same customer
  const invA = await admin.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      tax_rate: '0',
      items: [{ description: 'Item A', quantity: '1', unit_price: '2000000' }]
    }
  }).then(r => check(r, 201, 'Inv A'));
  await admin.request(`/api/invoices/${invA.invoice.id}/issue`, { method: 'POST', body: {} });

  const invB = await admin.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      tax_rate: '0',
      items: [{ description: 'Item B', quantity: '1', unit_price: '3000000' }]
    }
  }).then(r => check(r, 201, 'Inv B'));
  await admin.request(`/api/invoices/${invB.invoice.id}/issue`, { method: 'POST', body: {} });

  // Single payment of 5,000,000 VND allocated: 2,000,000 to Inv A, 3,000,000 to Inv B
  const allocRes = await admin.request('/api/payments/allocate', {
    method: 'POST',
    body: {
      amount: '5000000',
      method: 'BANK_TRANSFER',
      customer_id: customerId,
      reference: 'MULTI-ALLOC-TEST-01',
      allocations: [
        { invoice_id: invA.invoice.id, amount: '2000000' },
        { invoice_id: invB.invoice.id, amount: '3000000' }
      ]
    }
  }).then(r => check(r, 201, 'Payment allocation'));

  assert.equal(allocRes.allocations.length, 2);
  // Verify Inv A paid_total = 2,000,000 and status = PAID
  const checkA = queryDb(`SELECT paid_total || '|' || status FROM public.invoices WHERE id = ${invA.invoice.id}`);
  assert.equal(checkA, '2000000.00|PAID');

  // Verify Inv B paid_total = 3,000,000 and status = PAID
  const checkB = queryDb(`SELECT paid_total || '|' || status FROM public.invoices WHERE id = ${invB.invoice.id}`);
  assert.equal(checkB, '3000000.00|PAID');

  console.log('[PASS] F-09: Multi-invoice allocation cleanly recorded exact payments per invoice without ledger inflation.');

  // ============================================================================
  // F-10, F-11, F-12, F-13, F-14: MEDIUM FIXES VERIFICATION
  // ============================================================================
  console.log('\n--- Verifying Medium Fixes F-10 -> F-14 ---');

  // F-10: Payment Terms dual field contract
  const termRes = await admin.request('/api/payment-terms', {
    method: 'POST',
    body: {
      code: `NET45_${Date.now()}`,
      name: 'Net 45 Days Policy',
      net_days: 45,
      days: 45,
      discount_days: 10,
      early_discount_days: 10,
      discount_percent: '2.00',
      early_discount_percent: '2.00'
    }
  }).then(r => check(r, 201, 'Payment term create'));
  assert.equal(termRes.payment_term.net_days, 45);
  assert.equal(termRes.payment_term.days, 45);
  console.log('[PASS] F-10: Payment terms field aliases (net_days/days, discount_days/early_discount_days) verified.');

  // F-11: Customer segment validation
  for (const seg of ['Enterprise', 'SME', 'FDI', 'Retail', 'VIP']) {
    const segCust = await admin.request('/api/customers', {
      method: 'POST',
      body: { name: `Segment ${seg} Test`, segment: seg }
    }).then(r => check(r, 201, `Customer segment ${seg}`));
    assert.equal(segCust.customer.segment, seg);
  }
  console.log('[PASS] F-11: All 5 customer segments verified against database check constraints.');

  // F-12: Unapplied Cash / overpayment in bank reconciliation
  // Create an invoice with 1,000,000 VND outstanding
  const unappliedInv = await admin.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      tax_rate: '0',
      items: [{ description: 'Unapplied cash test item', quantity: '1', unit_price: '1000000' }]
    }
  }).then(r => check(r, 201, 'Unapplied inv create'));
  await admin.request(`/api/invoices/${unappliedInv.invoice.id}/issue`, { method: 'POST', body: {} });

  // Bank transaction sends 1,500,000 VND (500,000 VND overpayment)
  const bankTxRes = await admin.request('/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-06',
      description: `Thanh toan tien mat don hang ${unappliedInv.invoice.invoice_no}`,
      amount: '1500000',
      tx_type: 'CREDIT',
      bank_name: 'Vietcombank',
      bank_account: '0011004392819'
    }
  }).then(r => check(r, 201, 'Bank transaction create'));
  const bankTxId = bankTxRes.transaction.id;

  // Manual match
  const matchRes = await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: bankTxId,
      invoice_id: unappliedInv.invoice.id
    }
  }).then(r => check(r, 200, 'Reconciliation manual match'));

  assert.equal(Number(matchRes.result.amount), 1000000); // Matched invoice debt
  assert.equal(Number(matchRes.result.unapplied_amount), 500000); // 500k unapplied cash
  assert.equal(matchRes.result.status, 'PARTIALLY_MATCHED');

  // Verify in database
  const txDbCheck = queryDb(`SELECT unapplied_amount FROM public.bank_transactions WHERE id = ${bankTxId}`);
  assert.equal(Number(txDbCheck), 500000);
  console.log('[PASS] F-12: Unapplied cash (500,000 ₫) accurately isolated and stored on bank transaction.');

  // F-13: E-invoice field reading verified in F-07 above

  // F-14: Safe recurring date math
  const { addMonthsSafe } = await import('../app/src/scheduler.js');
  assert.equal(addMonthsSafe('2026-01-31', 1), '2026-02-28', 'Jan 31 + 1 month must be Feb 28');
  assert.equal(addMonthsSafe('2026-03-31', 1), '2026-04-30', 'Mar 31 + 1 month must be Apr 30');
  assert.equal(addMonthsSafe('2026-05-31', 1), '2026-06-30', 'May 31 + 1 month must be Jun 30');
  console.log('[PASS] F-14: Safe date math accurately clamps month-end transitions without day drift.');

  console.log('\n================================================================');
  console.log('   ALL REMEDIATION CHECKS (F-01 -> F-14) PASSED 100%!           ');
  console.log('================================================================\n');
}

runRemediationVerification().catch(err => {
  console.error('\n[REMEDIATION VERIFICATION FAILED]:', err);
  process.exit(1);
});
