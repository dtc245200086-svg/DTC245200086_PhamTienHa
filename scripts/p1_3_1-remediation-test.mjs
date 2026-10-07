import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const staffPassword = process.env.STAFF_PASSWORD;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!staffPassword || !adminPassword) {
  throw new Error('STAFF_PASSWORD and ADMIN_PASSWORD are required.');
}

function queryDb(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker compose exec -T postgres psql -U postgres -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  return out;
}

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async request(path, { method = 'GET', body, headers: customHeaders = {} } = {}) {
    const headers = new Headers(customHeaders);
    if (body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.cookie) {
      headers.set('Cookie', this.cookie);
    }
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

async function run() {
  console.log('======================================================================');
  console.log('   BILLING_ONE P1.3.1 CLOSURE REMEDIATION VERIFICATION SUITE         ');
  console.log('   Verifying FIND-P1.3-01 (Audit Metadata) & FIND-P1.3-02 (Lock Order)');
  console.log('======================================================================\n');

  const admin = new ApiClient();
  const staff = new ApiClient();

  // Login
  await admin.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword }
  }).then(r => check(r, 200, 'Admin login'));

  await staff.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'staff', password: staffPassword }
  }).then(r => check(r, 200, 'Staff login'));

  async function createTestCustomer(prefix) {
    const custRes = check(await staff.request('/api/customers', {
      method: 'POST',
      body: {
        name: `P1.3.1 Customer ${prefix} ${Date.now()}`,
        email: `p131_${prefix.toLowerCase()}_${Date.now()}@remediation.vn`,
        tax_code: `MST-P131-${Date.now().toString().slice(-8)}`,
        address: '789 Concurrency Lane'
      }
    }), 201, `Create customer ${prefix}`);
    return custRes.customer;
  }

  async function createIssuedInvoice(customerId, amountVnd) {
    const invRes = check(await staff.request('/api/invoices', {
      method: 'POST',
      body: {
        customer_id: customerId,
        due_date: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
        tax_rate: '0',
        items: [{
          description: `Dịch vụ kiểm thử ${amountVnd} VND`,
          quantity: '1',
          unit_price: Number(amountVnd).toFixed(2)
        }]
      }
    }), 201, 'Create draft invoice');

    const issueRes = check(await staff.request(`/api/invoices/${invRes.invoice.id}/issue`, {
      method: 'POST',
      body: {}
    }), 200, 'Issue invoice');
    return issueRes.invoice;
  }

  async function createUnappliedPayment(customerId, amountVnd, paidAt = '2026-10-01') {
    const payRes = check(await staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': `p131-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      body: {
        customer_id: customerId,
        amount: amountVnd.toFixed(2),
        method: 'BANK_TRANSFER',
        paid_at: paidAt,
        reference: `UNAPPLIED-${Date.now()}`,
        allocations: []
      }
    }), 201, 'Create unapplied payment');
    return payRes.payment;
  }

  let passedSuites = 0;

  // --------------------------------------------------------------------------
  // SUITE 1: FIND-P1.3-01 AUDIT METADATA SPECIFICATION COMPLIANCE
  // --------------------------------------------------------------------------
  console.log('[SUITE 1] FIND-P1.3-01: Audit Metadata Compliance & No-Replay-Duplicate...');
  {
    const cust = await createTestCustomer('S1_AUDIT');
    const pay1 = await createUnappliedPayment(cust.id, 2000000, '2026-10-01');
    const pay2 = await createUnappliedPayment(cust.id, 3000000, '2026-10-02');
    const inv = await createIssuedInvoice(cust.id, 3500000);

    const idempKey = `S1-AUTO-ALLOC-INV-${inv.id}-${Date.now()}`;

    // First execution -> 201 Created
    const allocRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempKey }
    }), 201, 'S1 First Auto-allocate');

    assert.equal(allocRes.success, true);
    assert.equal(allocRes.invoice_status, 'PAID');
    assert.equal(allocRes.allocated_total, '3500000.00');
    assert.equal(allocRes.allocations_count, 2);
    assert.deepEqual(allocRes.payment_ids, [Number(pay1.id), Number(pay2.id)]);
    assert.equal(allocRes.idempotency_key, idempKey);

    // Query audit log directly from DB
    const auditRowRaw = queryDb(`
      SELECT metadata 
      FROM public.audit_logs 
      WHERE action = 'PAYMENT_AUTO_ALLOCATED' 
        AND target_ref = '${inv.invoice_no}' 
      ORDER BY id DESC LIMIT 1;
    `);
    const meta = JSON.parse(auditRowRaw);

    // Mandatory Spec Section 12 Field Assertions
    assert.equal(Number(meta.invoice_id), Number(inv.id), 'metadata.invoice_id must match');
    assert.equal(meta.invoice_no, inv.invoice_no, 'metadata.invoice_no must match');
    assert.equal(meta.allocated_total, '3500000.00', 'metadata.allocated_total must match sum');
    assert.equal(meta.allocations_count, 2, 'metadata.allocations_count must be 2');
    assert.ok(Array.isArray(meta.payment_ids), 'metadata.payment_ids must be an array');
    assert.deepEqual(meta.payment_ids, [Number(pay1.id), Number(pay2.id)], 'metadata.payment_ids must contain both payments');
    assert.equal(meta.idempotency_key, idempKey, 'metadata.idempotency_key must match');
    assert.equal(meta.invoice_status, 'PAID', 'metadata.invoice_status must reflect post-allocation status');

    // Preserved detailed fields
    assert.equal(meta.allocated_from_unapplied, '3500000.00', 'metadata.allocated_from_unapplied preserved');
    assert.equal(meta.settlement_type, 'FULL', 'metadata.settlement_type preserved');
    assert.equal(meta.remaining_unapplied_cash, '1500000.00', 'metadata.remaining_unapplied_cash preserved');

    // Check Replay does NOT create a second audit record
    const auditCountBefore = Number(queryDb(`
      SELECT count(*) FROM public.audit_logs 
      WHERE action = 'PAYMENT_AUTO_ALLOCATED' AND target_ref = '${inv.invoice_no}';
    `));
    assert.equal(auditCountBefore, 1, 'Exactly 1 audit log exists before replay');

    const replayRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempKey }
    }), 200, 'S1 Replay Auto-allocate');
    assert.equal(replayRes.is_idempotent_replay, true);

    const auditCountAfter = Number(queryDb(`
      SELECT count(*) FROM public.audit_logs 
      WHERE action = 'PAYMENT_AUTO_ALLOCATED' AND target_ref = '${inv.invoice_no}';
    `));
    assert.equal(auditCountAfter, 1, 'Replay MUST NOT create a second audit record');

    console.log('  -> PASS: All 7 required audit metadata fields verified, replay generates zero duplicate audit entries');
    passedSuites++;
  }

  // --------------------------------------------------------------------------
  // SUITE 2: CONCURRENT AUTO-ALLOCATE WITH SAME IDEMPOTENCY KEY
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 2] Concurrency: autoAllocate vs autoAllocate (Same Idempotency Key)...');
  {
    const cust = await createTestCustomer('S2_SAME_KEY');
    await createUnappliedPayment(cust.id, 5000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 4000000);

    const sharedKey = `S2-SAME-KEY-${inv.id}-${Date.now()}`;
    const concurrencyPromises = Array.from({ length: 8 }, () => {
      const client = new ApiClient();
      client.cookie = staff.cookie;
      return client.request(`/api/invoices/${inv.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': sharedKey }
      });
    });

    const results = await Promise.all(concurrencyPromises);
    const statuses = results.map(r => r.response.status);
    console.log(`  Statuses: [${statuses.join(', ')}]`);

    const createdCount = statuses.filter(s => s === 201).length;
    const replayCount = statuses.filter(s => s === 200).length;

    assert.equal(createdCount, 1, 'Exactly 1 request received HTTP 201');
    assert.equal(replayCount, 7, 'Remaining 7 requests received HTTP 200 (Idempotent Replay)');

    const allocCount = Number(queryDb(`SELECT count(*) FROM public.payment_allocations WHERE invoice_id = ${inv.id};`));
    assert.equal(allocCount, 1, 'Exactly 1 allocation record was created');

    const auditCount = Number(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'PAYMENT_AUTO_ALLOCATED' AND target_ref = '${inv.invoice_no}';`));
    assert.equal(auditCount, 1, 'Exactly 1 audit log was created');

    console.log('  -> PASS: Same key concurrency fully serialized (1 created, 7 replayed, 0 duplicate allocations, 0 deadlocks)');
    passedSuites++;
  }

  // --------------------------------------------------------------------------
  // SUITE 3: CONCURRENT AUTO-ALLOCATE WITH DIFFERENT KEYS ON SAME INVOICE
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 3] Concurrency: autoAllocate vs autoAllocate (Different Keys, Same Invoice)...');
  {
    const cust = await createTestCustomer('S3_DIFF_KEY');
    await createUnappliedPayment(cust.id, 5000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 3000000);

    const concurrencyPromises = Array.from({ length: 8 }, (_, i) => {
      const client = new ApiClient();
      client.cookie = staff.cookie;
      return client.request(`/api/invoices/${inv.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `S3-DIFF-KEY-${inv.id}-${Date.now()}-${i}` }
      });
    });

    const results = await Promise.all(concurrencyPromises);
    const statuses = results.map(r => r.response.status);
    console.log(`  Statuses: [${statuses.join(', ')}]`);

    const createdCount = statuses.filter(s => s === 201).length;
    const rejectedCount = statuses.filter(s => s === 400).length;

    assert.equal(createdCount, 1, 'Exactly 1 request succeeded and settled invoice');
    assert.equal(rejectedCount, 7, 'Remaining 7 requests were rejected with HTTP 400 INVOICE_ALREADY_PAID');

    for (const r of results.filter(r => r.response.status === 400)) {
      assert.equal(r.payload.error.code, 'INVOICE_ALREADY_PAID');
    }

    const allocCount = Number(queryDb(`SELECT count(*) FROM public.payment_allocations WHERE invoice_id = ${inv.id};`));
    assert.equal(allocCount, 1, 'Exactly 1 allocation record created');

    console.log('  -> PASS: Different keys on same invoice serialized via Invoice Row Lock (1 winner, 7 clean rejections)');
    passedSuites++;
  }

  // --------------------------------------------------------------------------
  // SUITE 4: FIND-P1.3-02 CROSS-FLOW CONCURRENCY: allocatePayment VS autoAllocateUnappliedCash
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 4] FIND-P1.3-02 Cross-Flow Concurrency: allocatePayment() VS autoAllocateUnappliedCash()...');
  {
    // Test 5 pairs of simultaneous cross-flow executions on identical invoice & payment
    for (let round = 1; round <= 5; round++) {
      const cust = await createTestCustomer(`S4_CROSS_${round}`);
      const pay = await createUnappliedPayment(cust.id, 3000000, '2026-10-01');
      const inv = await createIssuedInvoice(cust.id, 3000000);

      const clientManualAlloc = new ApiClient();
      clientManualAlloc.cookie = staff.cookie;

      const clientAutoAlloc = new ApiClient();
      clientAutoAlloc.cookie = staff.cookie;

      // Both try to allocate the same 3,000,000 VND to the same invoice
      const p1 = clientManualAlloc.request(`/api/payments/${pay.id}/allocations`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `S4-MANUAL-ALLOC-${inv.id}-${round}-${Date.now()}` },
        body: {
          allocations: [{ invoiceId: inv.id, amount: 3000000 }]
        }
      });

      const p2 = clientAutoAlloc.request(`/api/invoices/${inv.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `S4-AUTO-ALLOC-${inv.id}-${round}-${Date.now()}` }
      });

      const [resManual, resAuto] = await Promise.all([p1, p2]);
      const statusManual = resManual.response.status;
      const statusAuto = resAuto.response.status;

      // Assert NO 40P01 deadlock occurred in either request
      assert.notEqual(resManual.payload?.error?.code, '40P01', 'allocatePayment must not throw 40P01 deadlock');
      assert.notEqual(resAuto.payload?.error?.code, '40P01', 'autoAllocateUnappliedCash must not throw 40P01 deadlock');
      assert.ok(!JSON.stringify(resManual.payload).includes('deadlock'), 'No deadlock in manual allocation');
      assert.ok(!JSON.stringify(resAuto.payload).includes('deadlock'), 'No deadlock in auto allocation');

      console.log(`    Round ${round}: Manual status: ${statusManual}, Auto status: ${statusAuto}`);

      // Exactly one succeeds to fully settle, the other receives clean business rejection
      const successCount = [statusManual, statusAuto].filter(s => s === 201).length;
      assert.equal(successCount, 1, `Round ${round}: exactly one method succeeded`);

      // Verify invoice invariants in DB
      const invRow = queryDb(`SELECT status, paid_total, total FROM public.invoices WHERE id = ${inv.id};`);
      const [invStatus, paidTotal, total] = invRow.split('|');
      assert.equal(invStatus, 'PAID', `Round ${round}: invoice status is PAID`);
      assert.equal(Number(paidTotal), 3000000, `Round ${round}: invoice paid_total is exactly 3M`);

      // Verify payment unapplied in DB
      const payRow = queryDb(`
        SELECT p.amount - coalesce(sum(pa.allocated_amount), 0)
        FROM public.payments p
        LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
        WHERE p.id = ${pay.id}
        GROUP BY p.amount;
      `);
      assert.equal(Number(payRow), 0, `Round ${round}: payment unapplied is exactly 0`);

      // Exactly 1 allocation record exists
      const totalAllocs = Number(queryDb(`SELECT count(*) FROM public.payment_allocations WHERE invoice_id = ${inv.id};`));
      assert.equal(totalAllocs, 1, `Round ${round}: exactly 1 allocation record was created`);
    }

    console.log('  -> PASS: 5/5 Cross-flow race condition rounds succeeded with ZERO 40P01 deadlocks, zero over-allocation');
    passedSuites++;
  }

  // --------------------------------------------------------------------------
  // SUITE 5: TWO DIFFERENT INVOICES SHARING SAME CUSTOMER UNAPPLIED POOL
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 5] Concurrency: Two Different Invoices Sharing Same Customer Payments...');
  {
    const cust = await createTestCustomer('S5_SHARED_POOL');
    // Customer has 1 payment with 5,000,000 VND
    const pay = await createUnappliedPayment(cust.id, 5000000, '2026-10-01');

    // Customer has 2 invoices: Inv1 = 3,000,000 VND, Inv2 = 3,000,000 VND (Total needed = 6M, available = 5M)
    const inv1 = await createIssuedInvoice(cust.id, 3000000);
    const inv2 = await createIssuedInvoice(cust.id, 3000000);

    const client1 = new ApiClient();
    client1.cookie = staff.cookie;
    const client2 = new ApiClient();
    client2.cookie = staff.cookie;

    // Concurrently auto-allocate to both invoices
    const [res1, res2] = await Promise.all([
      client1.request(`/api/invoices/${inv1.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `S5-AUTO-INV1-${inv1.id}-${Date.now()}` }
      }),
      client2.request(`/api/invoices/${inv2.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `S5-AUTO-INV2-${inv2.id}-${Date.now()}` }
      })
    ]);

    assert.notEqual(res1.response.status, 500, 'Request 1 must not 500');
    assert.notEqual(res2.response.status, 500, 'Request 2 must not 500');

    // Both should succeed (one gets 3M -> FULL, the other gets remaining 2M -> PARTIAL)
    assert.equal(res1.response.status, 201, 'Invoice 1 auto-allocated');
    assert.equal(res2.response.status, 201, 'Invoice 2 auto-allocated');

    const totalAllocatedOnPay = Number(queryDb(`
      SELECT sum(allocated_amount) FROM public.payment_allocations WHERE payment_id = ${pay.id};
    `));
    assert.equal(totalAllocatedOnPay, 5000000, 'Total allocated across both invoices is exactly 5M');

    const unappliedRemaining = Number(queryDb(`
      SELECT p.amount - coalesce(sum(pa.allocated_amount), 0)
      FROM public.payments p
      LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
      WHERE p.id = ${pay.id}
      GROUP BY p.amount;
    `));
    assert.equal(unappliedRemaining, 0, 'Zero negative unapplied cash');

    const inv1Check = check(await staff.request(`/api/invoices/${inv1.id}`), 200, 'Get inv1');
    const inv2Check = check(await staff.request(`/api/invoices/${inv2.id}`), 200, 'Get inv2');

    const statuses = [inv1Check.invoice.status, inv2Check.invoice.status].sort();
    assert.deepEqual(statuses, ['PAID', 'PARTIALLY_PAID'], 'One invoice is PAID, one is PARTIALLY_PAID');

    console.log('  -> PASS: Two competing invoices safely consumed 100% of customer cash without deadlock or over-allocation');
    passedSuites++;
  }

  // --------------------------------------------------------------------------
  // SUITE 6: ROLLBACK AFTER LOCK ACQUISITION
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 6] Concurrency: Rollback after Lock Acquisition Verification...');
  {
    const cust = await createTestCustomer('S6_ROLLBACK');
    const pay = await createUnappliedPayment(cust.id, 2000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 2000000);

    // 1. Attempt manual allocation with an invalid amount that causes rollback after invoice row lock
    const failRes = await staff.request(`/api/payments/${pay.id}/allocations`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `S6-FAIL-${Date.now()}` },
      body: {
        allocations: [{ invoiceId: inv.id, amount: 99999999 }] // Exceeds unapplied -> 409
      }
    });
    assert.equal(failRes.response.status, 409, 'Rollback triggered due to insufficient unapplied cash');

    // 2. Immediate auto-allocation on the same invoice must succeed immediately (locks were released)
    const succRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `S6-SUCC-${Date.now()}` }
    }), 201, 'S6 Immediate success after rollback');

    assert.equal(succRes.invoice_status, 'PAID');
    assert.equal(succRes.allocated_total, '2000000.00');

    console.log('  -> PASS: Transaction rollback cleanly released row locks and advisory locks immediately');
    passedSuites++;
  }

  // --------------------------------------------------------------------------
  // SUITE 7: FINANCIAL FORENSICS & AUDIT CHAIN INTEGRITY
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 7] Comprehensive Financial Forensics & Cryptographic Audit Verification...');
  {
    // Forensics 1: No negative payments
    const nonPosPayments = Number(queryDb('SELECT count(*) FROM public.payments WHERE amount <= 0;'));
    assert.equal(nonPosPayments, 0, 'Zero non-positive payments');

    // Forensics 2: No negative allocations
    const nonPosAllocs = Number(queryDb('SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0;'));
    assert.equal(nonPosAllocs, 0, 'Zero non-positive allocations');

    // Forensics 3: No over-allocated payments
    const overAllocatedPayments = Number(queryDb(`
      SELECT count(*)
      FROM (
        SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
        FROM public.payments p
        LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
        GROUP BY p.id, p.amount
        HAVING coalesce(sum(pa.allocated_amount), 0) > p.amount + 0.001
      ) sub;
    `));
    assert.equal(overAllocatedPayments, 0, 'Zero over-allocated payments');

    // Forensics 4: No invoice paid_total mismatch
    const mismatchedInvoices = Number(queryDb(`
      SELECT count(*)
      FROM (
        SELECT i.id, i.paid_total, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
        FROM public.invoices i
        LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id
        GROUP BY i.id, i.paid_total
        HAVING abs(i.paid_total - coalesce(sum(pa.allocated_amount), 0)) > 0.001
      ) sub;
    `));
    assert.equal(mismatchedInvoices, 0, 'Zero invoice paid_total mismatches');

    // Forensics 5: No collectible capacity violations
    const capacityViolations = Number(queryDb(`
      SELECT count(*)
      FROM public.invoices
      WHERE paid_total + adjusted_total > total + 0.001;
    `));
    assert.equal(capacityViolations, 0, 'Zero collectible capacity violations');

    // Forensics 6: Verify 100% Cryptographic Audit Chain Integrity
    const auditRes = check(await admin.request('/api/audit/verify', { method: 'POST' }), 200, 'Verify audit chain');
    assert.equal(auditRes.valid, true, 'Cryptographic audit chain is 100% valid');
    console.log(`  -> Audit chain valid: ${auditRes.total_records} verified records with ZERO broken links`);

    console.log('  -> PASS: 100% Financial Forensics Invariants strictly preserved across the entire database');
    passedSuites++;
  }

  console.log('\n======================================================================');
  console.log(`  P1.3.1 REMEDIATION SUITE COMPLETE: ${passedSuites}/7 SUITES PASSED (100%) `);
  console.log('======================================================================\n');
}

run().catch((err) => {
  console.error('\n[FATAL REMEDIATION TEST FAILURE]:', err);
  process.exit(1);
});
