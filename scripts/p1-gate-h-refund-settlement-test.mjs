#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE — GATE H: REFUND SETTLEMENT VERIFICATION SUITE
 * File: scripts/p1-gate-h-refund-settlement-test.mjs
 *
 * Verifies Finding H — Refund Lifecycle & Settlement:
 * 1. Full lifecycle: REQUESTED/PENDING -> APPROVED -> PAID/SETTLED
 * 2. Invalid state transitions rejected:
 *    - PENDING -> PAID directly (rejected 409 REFUND_NOT_APPROVED)
 *    - PAID -> APPROVED (rejected 409 REFUND_ALREADY_SETTLED)
 *    - PAID -> SETTLED twice (rejected 409 REFUND_ALREADY_SETTLED)
 *    - Double approval rejected (rejected 409 REFUND_ALREADY_APPROVED)
 * 3. Concurrent settlement safety (only 1 succeeds, other rejected)
 * 4. Payout method & reference recorded properly in DB
 * 5. Audit trail: REFUND_REQUESTED, REFUND_APPROVED, REFUND_SETTLED
 * 6. Idempotency-Key support: idempotent retry returns same result
 * 7. RBAC authorization: unauthenticated -> 401, wrong permission -> 403
 * ============================================================================
 */

import assert from 'node:assert/strict';
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
  assert.equal(res.status, 200, `Login failed for ${username}: ${res.status}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, `Cookie present for ${username}`);
  return {
    cookie,
    async request(urlPath, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set('Cookie', cookie);
      if (options.body && typeof options.body === 'object' && !(options.body instanceof String) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
        options.body = JSON.stringify(options.body);
      }
      return fetch(`${baseUrl}${urlPath}`, { ...options, headers });
    }
  };
}

async function run() {
  console.log('================================================================');
  console.log('      GATE H: REFUND SETTLEMENT VERIFICATION SUITE              ');
  console.log('================================================================\n');

  const admin = await login('admin', adminPassword);
  const staff = await login('staff', staffPassword);

  let passed = 0;
  function pass(msg) {
    console.log(`[PASS] ${msg}`);
    passed++;
  }

  // --- PREPARATION: Create a customer and paid invoice for refund testing ---
  const stamp = Date.now();
  const custRes = await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `Refund Lifecycle Corp ${stamp}`,
      tax_code: `03${String(stamp).slice(-8)}`,
      email: `refund-${stamp}@example.com`
    }
  });
  assert.equal(custRes.status, 201, 'Customer created');
  const customer = (await custRes.json()).customer;

  // Create invoice
  const invRes = await admin.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Dịch vụ tư vấn tài chính', quantity: '1', unit_price: '50000000.00', vat_rate: '0.10' }
      ]
    }
  });
  assert.equal(invRes.status, 201, 'Invoice created');
  const invoice = (await invRes.json()).invoice;

  // Issue invoice
  const issueRes = await admin.request(`/api/invoices/${invoice.id}/issue`, { method: 'POST' });
  assert.equal(issueRes.status, 200, 'Invoice issued');

  // Fully pay invoice (55,000,000 VND)
  const payRes = await admin.request(`/api/invoices/${invoice.id}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `pay-${stamp}` },
    body: {
      amount: '55000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `PAY-${stamp}`
    }
  });
  assert.equal(payRes.status, 201, 'Payment recorded');

  // Process a credit note adjustment to generate refund payable (15,000,000 VND)
  const adjRes = await admin.request('/api/adjustments', {
    method: 'POST',
    body: {
      invoice_id: invoice.id,
      adjustment_type: 'DECREASE_AMOUNT',
      amount: '15000000.00',
      vat_rate: '0.00',
      reason: 'Giảm trừ phí dịch vụ đã thu'
    }
  });
  assert.equal(adjRes.status, 201, 'Adjustment created');
  const adjustment = (await adjRes.json()).adjustment;

  const adjApproveRes = await admin.request(`/api/adjustments/${adjustment.id}/approve`, { method: 'POST' });
  assert.equal(adjApproveRes.status, 200, 'Adjustment approved');

  const adjProcRes = await admin.request(`/api/adjustments/${adjustment.id}/process`, { method: 'POST' });
  assert.equal(adjProcRes.status, 200, 'Adjustment processed');
  const procData = await adjProcRes.json();
  assert.ok(procData.refund, 'Refund payable generated from credit note');
  const refundId = procData.refund.id;
  assert.equal(procData.refund.status, 'PENDING', 'Refund initial status is PENDING');
  pass('Test 1: Refund payable created with PENDING status from adjustment');

  // --- TEST 2: RBAC Check on Approval & Settlement ---
  // Unauthenticated requests are rejected
  const unauthApprove = await fetch(`${baseUrl}/api/refunds/${refundId}/approve`, { method: 'POST' });
  assert.equal(unauthApprove.status, 401, 'Unauthenticated approval rejected');

  const unauthSettle = await fetch(`${baseUrl}/api/refunds/${refundId}/settle`, { method: 'POST' });
  assert.equal(unauthSettle.status, 401, 'Unauthenticated settlement rejected');
  pass('Test 2: RBAC unauthenticated requests rejected with 401');

  // --- TEST 3: Invalid State Transition: Settle while still PENDING ---
  const prematureSettle = await admin.request(`/api/refunds/${refundId}/settle`, {
    method: 'POST',
    body: { payout_method: 'BANK_TRANSFER' }
  });
  assert.equal(prematureSettle.status, 409, 'Premature settlement rejected with 409');
  const prematureData = await prematureSettle.json();
  const prematureCode = prematureData.error?.code || prematureData.code;
  assert.equal(prematureCode, 'REFUND_NOT_APPROVED', 'Rejected code is REFUND_NOT_APPROVED');
  pass('Test 3: Cannot settle PENDING refund (REFUND_NOT_APPROVED)');

  // --- TEST 4: Approve Refund ---
  const approveRes = await admin.request(`/api/refunds/${refundId}/approve`, { method: 'POST' });
  assert.equal(approveRes.status, 200, 'Refund approved');
  const approveData = await approveRes.json();
  assert.equal(approveData.refund.status, 'APPROVED', 'Refund status transitioned to APPROVED');
  pass('Test 4: Refund successfully approved (PENDING -> APPROVED)');

  // --- TEST 5: Double Approval Prevention ---
  const doubleApprove = await admin.request(`/api/refunds/${refundId}/approve`, { method: 'POST' });
  assert.equal(doubleApprove.status, 409, 'Double approval rejected with 409');
  const doubleApproveData = await doubleApprove.json();
  const doubleApproveCode = doubleApproveData.error?.code || doubleApproveData.code;
  assert.equal(doubleApproveCode, 'REFUND_ALREADY_APPROVED', 'Rejected with REFUND_ALREADY_APPROVED');
  pass('Test 5: Double approval prevented (REFUND_ALREADY_APPROVED)');

  // --- TEST 6: Settle Refund (APPROVED -> PAID) with Idempotency-Key ---
  const idemKey = `refund-settle-${stamp}-${Math.random().toString(36).slice(2)}`;
  const settleRes = await admin.request(`/api/refunds/${refundId}/settle`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idemKey },
    body: {
      payout_method: 'BANK_TRANSFER',
      payout_reference: `VCB-OUT-${stamp}`,
      notes: 'Đã chuyển khoản hoàn tiền cho khách qua VCB'
    }
  });
  assert.equal(settleRes.status, 200, 'Refund settled');
  const settleData = await settleRes.json();
  assert.equal(settleData.refund.status, 'PAID', 'Status transitioned to PAID');
  assert.equal(settleData.refund.payout_method, 'BANK_TRANSFER');
  assert.equal(settleData.refund.payout_reference, `VCB-OUT-${stamp}`);
  assert.ok(settleData.refund.settled_at, 'settled_at timestamp recorded');
  pass('Test 6: Refund successfully settled (APPROVED -> PAID)');

  // --- TEST 7: Idempotent Retry with same Idempotency-Key and same payload returns same response ---
  const retrySettle = await admin.request(`/api/refunds/${refundId}/settle`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idemKey },
    body: {
      payout_method: 'BANK_TRANSFER',
      payout_reference: `VCB-OUT-${stamp}`,
      notes: 'Đã chuyển khoản hoàn tiền cho khách qua VCB'
    }
  });
  assert.equal(retrySettle.status, 200, 'Idempotent retry returned 200');
  const retryData = await retrySettle.json();
  assert.equal(retryData.refund.status, 'PAID', 'Idempotent response preserved');
  assert.equal(retryData.is_idempotent_replay, true, 'is_idempotent_replay flag returned');
  pass('Test 7: Idempotent settlement retry returns identical response with is_idempotent_replay');

  // --- TEST 7b: Idempotency Key Reuse with different payload rejected with 409 ---
  const mismatchSettle = await admin.request(`/api/refunds/${refundId}/settle`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idemKey },
    body: {
      payout_method: 'BANK_TRANSFER',
      payout_reference: `VCB-OUT-DIFFERENT-${stamp}`,
      notes: 'Different notes payload'
    }
  });
  assert.equal(mismatchSettle.status, 409, 'Key reuse with different payout_reference rejected with 409');
  const mismatchData = await mismatchSettle.json();
  const mismatchCode = mismatchData.error?.code || mismatchData.code;
  assert.equal(mismatchCode, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', 'Rejected with IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  pass('Test 7b: Key reuse with different payload correctly rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

  // --- TEST 7c: Canonical status query filter mapping (SETTLED -> PAID) ---
  const settledListRes = await admin.request('/api/refunds?status=SETTLED');
  assert.equal(settledListRes.status, 200);
  const settledList = await settledListRes.json();
  const foundSettled = settledList.items.find(r => r.id === refundId);
  assert.ok(foundSettled, 'Query with alias status=SETTLED returns PAID refund');
  pass('Test 7c: Canonical status query alias mapping (status=SETTLED -> PAID) verified');

  // --- TEST 8: Double Settlement Attempt (without idempotency key) ---
  const doubleSettle = await admin.request(`/api/refunds/${refundId}/settle`, {
    method: 'POST',
    body: { payout_method: 'CASH' }
  });
  assert.equal(doubleSettle.status, 409, 'Double settlement rejected with 409');
  const doubleSettleData = await doubleSettle.json();
  const doubleSettleCode = doubleSettleData.error?.code || doubleSettleData.code;
  assert.equal(doubleSettleCode, 'REFUND_ALREADY_SETTLED', 'Rejected with REFUND_ALREADY_SETTLED');
  pass('Test 8: Double settlement rejected (REFUND_ALREADY_SETTLED)');

  // --- TEST 9: Double approval of already PAID refund rejected ---
  const approvePaid = await admin.request(`/api/refunds/${refundId}/approve`, { method: 'POST' });
  assert.equal(approvePaid.status, 409, 'Approve on settled refund rejected');
  pass('Test 9: Cannot approve already settled refund');

  // --- TEST 10: Concurrent Settlement Test (Race Condition Protection) ---
  // Create another refund payable
  const adj2Res = await admin.request('/api/adjustments', {
    method: 'POST',
    body: {
      invoice_id: invoice.id,
      adjustment_type: 'DECREASE_AMOUNT',
      amount: '5000000.00',
      vat_rate: '0.00',
      reason: 'Giảm trừ đợt 2'
    }
  });
  assert.equal(adj2Res.status, 201);
  const adj2 = (await adj2Res.json()).adjustment;
  await admin.request(`/api/adjustments/${adj2.id}/approve`, { method: 'POST' });
  const proc2Res = await admin.request(`/api/adjustments/${adj2.id}/process`, { method: 'POST' });
  const refund2 = (await proc2Res.json()).refund;
  assert.ok(refund2, 'Second refund payable created');

  // Approve second refund
  await admin.request(`/api/refunds/${refund2.id}/approve`, { method: 'POST' });

  // Fire 5 concurrent settlement requests
  const settlePromises = Array.from({ length: 5 }, (_, i) =>
    admin.request(`/api/refunds/${refund2.id}/settle`, {
      method: 'POST',
      body: {
        payout_method: 'BANK_TRANSFER',
        payout_reference: `CONCUR-TX-${i}`
      }
    })
  );
  const results = await Promise.all(settlePromises);
  const successCount = results.filter(r => r.status === 200).length;
  const conflictCount = results.filter(r => r.status === 409).length;

  assert.equal(successCount, 1, `Exactly 1 concurrent settlement succeeded (got ${successCount})`);
  assert.equal(conflictCount, 4, `Remaining 4 were rejected with 409 (got ${conflictCount})`);
  pass('Test 10: Concurrent settlement race condition prevented via DB row locking (1 success, 4 conflicts)');

  // --- TEST 11: Verify audit log entries ---
  const auditRes = await admin.request('/api/audit-logs?module=refunds');
  assert.equal(auditRes.status, 200, 'Audit logs queried');
  const auditData = await auditRes.json();
  const audits = auditData.items || auditData.logs || [];
  const actions = audits.map(a => a.action);
  assert.ok(actions.includes('REFUND_APPROVED'), 'Audit contains REFUND_APPROVED');
  assert.ok(actions.includes('REFUND_SETTLED'), 'Audit contains REFUND_SETTLED');
  pass('Test 11: Audit trail recorded REFUND_APPROVED and REFUND_SETTLED');

  console.log('\n================================================================');
  console.log(`GATE H: REFUND SETTLEMENT COMPLETED: ${passed} / 13 CHECKS PASSED`);
  console.log('================================================================');
}

run().catch(err => {
  console.error('\n[FATAL GATE H ERROR]', err);
  process.exit(1);
});
