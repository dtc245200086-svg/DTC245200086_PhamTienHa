import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function assertAuditMetadataCompliance(metadata, expectedInvoiceId, expectedInvoiceNo, expectedKey, expectedStatus) {
  assert.ok(metadata.invoice_id !== undefined && metadata.invoice_id !== null, 'metadata.invoice_id exists');
  assert.equal(Number(metadata.invoice_id), Number(expectedInvoiceId), 'metadata.invoice_id matches');
  assert.ok(metadata.invoice_no, 'metadata.invoice_no exists');
  assert.equal(metadata.invoice_no, expectedInvoiceNo, 'metadata.invoice_no matches');
  assert.ok(metadata.allocated_total, 'metadata.allocated_total exists');
  assert.ok(Number(metadata.allocated_total) > 0, 'metadata.allocated_total is positive');
  assert.ok(metadata.allocations_count !== undefined && metadata.allocations_count > 0, 'metadata.allocations_count exists and > 0');
  assert.ok(Array.isArray(metadata.payment_ids), 'metadata.payment_ids exists as array');
  assert.ok(metadata.payment_ids.length > 0, 'metadata.payment_ids is non-empty');
  assert.ok(metadata.idempotency_key, 'metadata.idempotency_key exists');
  assert.equal(metadata.idempotency_key, expectedKey, 'metadata.idempotency_key matches');
  assert.ok(metadata.invoice_status, 'metadata.invoice_status exists');
  assert.equal(metadata.invoice_status, expectedStatus, 'metadata.invoice_status reflects status after allocation');
}

async function run() {
  console.log('===============================================================');
  console.log('  BILLING_ONE P1.3 AUTOMATED UNAPPLIED CASH SETTLEMENT SUITE   ');
  console.log('       Verifying 16 Scenarios (T01-T16) & Invariants Audit      ');
  console.log('===============================================================\n');

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

  // Baseline database stats
  const initialPayments = Number(queryDb('SELECT count(*) FROM public.payments;'));
  const initialAllocations = Number(queryDb('SELECT count(*) FROM public.payment_allocations;'));
  const initialIdempKeys = Number(queryDb('SELECT count(*) FROM public.payment_idempotency_keys;'));
  console.log(`[BASELINE] Payments: ${initialPayments}, Allocations: ${initialAllocations}, Idempotency Keys: ${initialIdempKeys}\n`);

  // Helper to create test customer
  async function createTestCustomer(prefix) {
    const custRes = check(await staff.request('/api/customers', {
      method: 'POST',
      body: {
        name: `P1.3 Test Customer ${prefix} ${Date.now()}`,
        email: `p13_${prefix.toLowerCase()}_${Date.now()}@test.vn`,
        tax_code: `MST-P13-${Date.now().toString().slice(-8)}`,
        address: '123 Settlement Way'
      }
    }), 201, `Create customer ${prefix}`);
    return custRes.customer;
  }

  // Helper to create and issue invoice
  async function createIssuedInvoice(customerId, amountVnd) {
    const invRes = check(await staff.request('/api/invoices', {
      method: 'POST',
      body: {
        customer_id: customerId,
        due_date: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
        tax_rate: '0',
        items: [{
          description: 'Dịch vụ phần mềm P1.3',
          quantity: '1',
          unit_price: Number(amountVnd).toFixed(2)
        }]
      }
    }), 201, 'Create draft invoice');
    const invoiceId = invRes.invoice.id;

    const issueRes = check(await staff.request(`/api/invoices/${invoiceId}/issue`, {
      method: 'POST',
      body: {}
    }), 200, 'Issue invoice');
    return issueRes.invoice;
  }

  // Helper to create unapplied payment
  async function createUnappliedPayment(customerId, amountVnd, paidAt = '2026-10-01', ref = null) {
    const idempKey = `test-pay-unapplied-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payRes = check(await staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempKey },
      body: {
        customer_id: customerId,
        amount: Number(amountVnd).toFixed(2),
        method: 'BANK_TRANSFER',
        paid_at: paidAt,
        reference: ref || `REF-${Date.now().toString().slice(-6)}`,
        allocations: [] // Zero allocations -> pure unapplied cash
      }
    }), 201, 'Create unapplied payment');
    return payRes.payment;
  }

  let passedTests = 0;

  // --------------------------------------------------------------------------
  // T01: Keyless Manual Trigger Rejection
  // --------------------------------------------------------------------------
  console.log('[TEST T01] Keyless Manual Trigger Rejection...');
  {
    const cust = await createTestCustomer('T01');
    const inv = await createIssuedInvoice(cust.id, 1000000);

    const res = await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      body: {}
    });
    check(res, 400, 'T01 Keyless auto-allocate rejection');
    assert.equal(res.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    console.log('  -> PASS: Keyless request rejected with HTTP 400 IDEMPOTENCY_KEY_REQUIRED');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T02: Single Payment Full Settlement
  // --------------------------------------------------------------------------
  console.log('\n[TEST T02] Single Payment Full Settlement...');
  {
    const cust = await createTestCustomer('T02');
    const pay = await createUnappliedPayment(cust.id, 5000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 3000000);

    // Verify unapplied balance before allocation
    const balBefore = check(await staff.request(`/api/customers/${cust.id}/unapplied-balance`), 200, 'Check balance');
    assert.equal(Number(balBefore.total_unapplied_cash), 5000000);

    const key = `t02-auto-alloc-${Date.now()}`;
    const allocRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key }
    }), 201, 'T02 Auto-allocate');

    assert.equal(allocRes.success, true);
    assert.equal(allocRes.invoice_status, 'PAID');
    assert.equal(allocRes.settlement_type, 'FULL');
    assert.equal(Number(allocRes.allocated_from_unapplied), 3000000);
    assert.equal(Number(allocRes.remaining_unapplied_cash), 2000000);
    assert.equal(allocRes.is_idempotent_replay, false);

    // Verify unapplied balance endpoint reflects remaining
    const balAfter = check(await staff.request(`/api/customers/${cust.id}/unapplied-balance`), 200, 'Check balance after');
    assert.equal(Number(balAfter.total_unapplied_cash), 2000000);

    // Verify audit log metadata compliance (FIND-P1.3-01)
    const auditRowRaw = queryDb(`SELECT metadata FROM public.audit_logs WHERE action = 'PAYMENT_AUTO_ALLOCATED' AND target_ref = '${inv.invoice_no}' ORDER BY id DESC LIMIT 1;`);
    const auditMeta = JSON.parse(auditRowRaw);
    assert.equal(Number(auditMeta.invoice_id), Number(inv.id), 'metadata.invoice_id exists');
    assert.equal(auditMeta.invoice_no, inv.invoice_no, 'metadata.invoice_no exists');
    assert.equal(auditMeta.allocated_total, '3000000.00', 'metadata.allocated_total exists');
    assert.equal(auditMeta.allocations_count, 1, 'metadata.allocations_count exists');
    assert.ok(Array.isArray(auditMeta.payment_ids) && auditMeta.payment_ids.length === 1, 'metadata.payment_ids exists as array');
    assert.equal(Number(auditMeta.payment_ids[0]), Number(pay.id), 'metadata.payment_ids contains payment ID');
    assert.equal(auditMeta.idempotency_key, key, 'metadata.idempotency_key exists');
    assert.equal(auditMeta.invoice_status, 'PAID', 'metadata.invoice_status exists');

    console.log('  -> PASS: Invoice fully paid, unapplied cash reduced from 5M to 2M, audit metadata compliant');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T03: Single Payment Partial Settlement
  // --------------------------------------------------------------------------
  console.log('\n[TEST T03] Single Payment Partial Settlement...');
  {
    const cust = await createTestCustomer('T03');
    const pay = await createUnappliedPayment(cust.id, 1500000, '2026-10-02');
    const inv = await createIssuedInvoice(cust.id, 4000000);

    const key = `t03-auto-alloc-${Date.now()}`;
    const allocRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key }
    }), 201, 'T03 Auto-allocate');

    assert.equal(allocRes.success, true);
    assert.equal(allocRes.invoice_status, 'PARTIALLY_PAID');
    assert.equal(allocRes.settlement_type, 'PARTIAL');
    assert.equal(Number(allocRes.allocated_from_unapplied), 1500000);
    assert.equal(Number(allocRes.remaining_unapplied_cash), 0);

    // Verify invoice outstanding balance in DB
    const invDb = check(await staff.request(`/api/invoices/${inv.id}`), 200, 'Get invoice');
    assert.equal(Number(invDb.invoice.paid_total), 1500000);
    assert.equal(Number(invDb.invoice.outstanding), 2500000);
    console.log('  -> PASS: Invoice partially settled (1.5M/4M), customer unapplied cash = 0');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T04: Multi-Payment FIFO Settlement
  // --------------------------------------------------------------------------
  console.log('\n[TEST T04] Multi-Payment FIFO Settlement...');
  {
    const cust = await createTestCustomer('T04');
    // Create 3 unapplied payments with different dates
    const p1 = await createUnappliedPayment(cust.id, 1000000, '2026-09-01', 'TX-OLDER');
    const p2 = await createUnappliedPayment(cust.id, 2000000, '2026-09-10', 'TX-MIDDLE');
    const p3 = await createUnappliedPayment(cust.id, 3000000, '2026-09-20', 'TX-NEWER');

    // Invoice for 2,500,000 should consume 1,000,000 from p1 and 1,500,000 from p2
    const inv = await createIssuedInvoice(cust.id, 2500000);

    const key = `t04-auto-alloc-${Date.now()}`;
    const allocRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key }
    }), 201, 'T04 Auto-allocate');

    assert.equal(allocRes.invoice_status, 'PAID');
    assert.equal(allocRes.allocations.length, 2);

    // First allocation must be from p1
    assert.equal(Number(allocRes.allocations[0].payment_id), Number(p1.id));
    assert.equal(Number(allocRes.allocations[0].allocated_amount), 1000000);

    // Second allocation must be from p2
    assert.equal(Number(allocRes.allocations[1].payment_id), Number(p2.id));
    assert.equal(Number(allocRes.allocations[1].allocated_amount), 1500000);

    // Check remaining balances: p1=0, p2=500k, p3=3M -> total 3.5M
    const balAfter = check(await staff.request(`/api/customers/${cust.id}/unapplied-balance`), 200, 'Check balance after');
    assert.equal(Number(balAfter.total_unapplied_cash), 3500000);
    assert.equal(balAfter.available_payments_count, 2); // p2 and p3
    console.log('  -> PASS: Strict FIFO verified across 3 payments (p1 fully exhausted, p2 partially exhausted)');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T05: Zero Unapplied Cash Rejection
  // --------------------------------------------------------------------------
  console.log('\n[TEST T05] Zero Unapplied Cash Rejection...');
  {
    const cust = await createTestCustomer('T05');
    const inv = await createIssuedInvoice(cust.id, 2000000);

    const key = `t05-auto-alloc-${Date.now()}`;
    const res = await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key }
    });
    check(res, 400, 'T05 Zero unapplied cash rejection');
    assert.equal(res.payload.error.code, 'NO_UNAPPLIED_CASH_AVAILABLE');
    console.log('  -> PASS: Request rejected with HTTP 400 NO_UNAPPLIED_CASH_AVAILABLE');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T06: Already Paid Invoice Rejection
  // --------------------------------------------------------------------------
  console.log('\n[TEST T06] Already Paid Invoice Rejection...');
  {
    const cust = await createTestCustomer('T06');
    await createUnappliedPayment(cust.id, 5000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 1000000);

    // Settle it first
    check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `t06-key-1-${Date.now()}` }
    }), 201, 'Settle invoice');

    // Try settle again with a fresh key
    const res = await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `t06-key-2-${Date.now()}` }
    });
    check(res, 400, 'T06 Already paid rejection');
    assert.equal(res.payload.error.code, 'INVOICE_ALREADY_PAID');
    console.log('  -> PASS: Request rejected with HTTP 400 INVOICE_ALREADY_PAID');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T07: Idempotent Replay Verification
  // --------------------------------------------------------------------------
  console.log('\n[TEST T07] Idempotent Replay Verification...');
  {
    const cust = await createTestCustomer('T07');
    await createUnappliedPayment(cust.id, 5000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 2000000);

    const replayKey = `t07-replay-key-${Date.now()}`;
    const initialAllocCount = Number(queryDb('SELECT count(*) FROM public.payment_allocations;'));

    // First attempt -> 201 Created
    const res1 = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': replayKey }
    }), 201, 'T07 First attempt');
    assert.equal(res1.is_idempotent_replay, false);

    // Second attempt -> 200 OK with cached response
    const res2 = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': replayKey }
    }), 200, 'T07 Replay attempt');
    assert.equal(res2.is_idempotent_replay, true);
    assert.equal(Number(res2.invoice_id), Number(inv.id));
    assert.equal(res2.allocated_from_unapplied, res1.allocated_from_unapplied);

    const finalAllocCount = Number(queryDb('SELECT count(*) FROM public.payment_allocations;'));
    assert.equal(finalAllocCount, initialAllocCount + 1, 'Exactly one allocation record was inserted');

    // Verify replay does NOT create a second audit record (FIND-P1.3-01 requirement 8)
    const auditCount = Number(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'PAYMENT_AUTO_ALLOCATED' AND target_ref = '${inv.invoice_no}';`));
    assert.equal(auditCount, 1, 'Replay did not create a second audit record');

    console.log('  -> PASS: Idempotent replay returned HTTP 200 is_idempotent_replay: true without duplicate allocations or duplicate audit records');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T08: Payload Mismatch Detection
  // --------------------------------------------------------------------------
  console.log('\n[TEST T08] Payload Mismatch Detection...');
  {
    const cust = await createTestCustomer('T08');
    await createUnappliedPayment(cust.id, 5000000, '2026-10-01');
    const inv1 = await createIssuedInvoice(cust.id, 1000000);
    const inv2 = await createIssuedInvoice(cust.id, 1000000);

    const sharedKey = `t08-mismatch-key-${Date.now()}`;

    // Used on inv1
    check(await staff.request(`/api/invoices/${inv1.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': sharedKey }
    }), 201, 'T08 First invoice');

    // Reused on inv2 -> 409 Conflict
    const res2 = await staff.request(`/api/invoices/${inv2.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': sharedKey }
    });
    check(res2, 409, 'T08 Mismatch conflict');
    assert.equal(res2.payload.error.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    console.log('  -> PASS: Reusing key across different invoices rejected with HTTP 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T09: Scheduler Auto-Settlement Flow
  // --------------------------------------------------------------------------
  console.log('\n[TEST T09] Scheduler Auto-Settlement Flow...');
  {
    const cust = await createTestCustomer('T09');
    await createUnappliedPayment(cust.id, 4000000, '2026-10-01');

    // Create recurring plan with auto_sign: true and auto_settle_unapplied: true
    const planRes = check(await admin.request('/api/recurring-plans', {
      method: 'POST',
      body: {
        customer_id: cust.id,
        service_title: 'Dịch vụ Thuê bao T09',
        billing_cycle: 'MONTHLY',
        amount: '1500000.00',
        start_date: new Date().toISOString().slice(0, 10),
        auto_sign: true,
        auto_settle_unapplied: true
      }
    }), 201, 'Create recurring plan T09');
    const plan = planRes.plan;

    // Trigger cycle
    const trigRes = check(await admin.request(`/api/recurring-plans/${plan.id}/trigger`, {
      method: 'POST',
      body: {}
    }), 200, 'Trigger recurring plan T09');

    const invId = trigRes.invoice_id;
    const invCheck = check(await staff.request(`/api/invoices/${invId}`), 200, 'Check recurring invoice');
    assert.equal(invCheck.invoice.status, 'PAID', 'Recurring invoice was automatically settled');

    // Verify deterministic key in database
    const expectedKey = `RECURRING-AUTO-ALLOC-INV-${invId}-PLAN-${plan.id}`;
    const idempRow = queryDb(`SELECT count(*) FROM public.payment_idempotency_keys WHERE idempotency_key = '${expectedKey}';`);
    assert.equal(Number(idempRow), 1, `Deterministic key ${expectedKey} exists in database`);

    // Verify remaining unapplied cash: 4M - 1.5M (total with 10% tax = 1.65M? Wait, line items add 10% tax)
    const invTotal = Number(invCheck.invoice.total);
    const expectedRemaining = 4000000 - invTotal;
    const balAfter = check(await staff.request(`/api/customers/${cust.id}/unapplied-balance`), 200, 'Check balance T09');
    assert.equal(Number(balAfter.total_unapplied_cash), expectedRemaining);

    // Verify audit log metadata compliance for scheduler auto-settle (FIND-P1.3-01)
    const schedAuditRaw = queryDb(`SELECT metadata FROM public.audit_logs WHERE action = 'PAYMENT_AUTO_ALLOCATED' AND target_ref = '${invCheck.invoice.invoice_no}' ORDER BY id DESC LIMIT 1;`);
    const schedMeta = JSON.parse(schedAuditRaw);
    assertAuditMetadataCompliance(schedMeta, invId, invCheck.invoice.invoice_no, expectedKey, 'PAID');

    console.log(`  -> PASS: Scheduler automatically generated, signed, and settled invoice using key ${expectedKey}`);
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T10: Scheduler Disabled Configuration
  // --------------------------------------------------------------------------
  console.log('\n[TEST T10] Scheduler Disabled Configuration...');
  {
    const cust = await createTestCustomer('T10');
    await createUnappliedPayment(cust.id, 4000000, '2026-10-01');

    // Create recurring plan with auto_sign: true and auto_settle_unapplied: FALSE
    const planRes = check(await admin.request('/api/recurring-plans', {
      method: 'POST',
      body: {
        customer_id: cust.id,
        service_title: 'Dịch vụ Thuê bao T10 (No Auto Settle)',
        billing_cycle: 'MONTHLY',
        amount: '1200000.00',
        start_date: new Date().toISOString().slice(0, 10),
        auto_sign: true,
        auto_settle_unapplied: false
      }
    }), 201, 'Create recurring plan T10');
    const plan = planRes.plan;

    // Trigger cycle
    const trigRes = check(await admin.request(`/api/recurring-plans/${plan.id}/trigger`, {
      method: 'POST',
      body: {}
    }), 200, 'Trigger recurring plan T10');

    const invId = trigRes.invoice_id;
    const invCheck = check(await staff.request(`/api/invoices/${invId}`), 200, 'Check recurring invoice T10');
    assert.equal(invCheck.invoice.status, 'ISSUED', 'Invoice remains in ISSUED status because auto-settle is disabled');

    // Unapplied cash should remain 4,000,000
    const balAfter = check(await staff.request(`/api/customers/${cust.id}/unapplied-balance`), 200, 'Check balance T10');
    assert.equal(Number(balAfter.total_unapplied_cash), 4000000);
    console.log('  -> PASS: auto_settle_unapplied: false preserved ISSUED status without consuming unapplied cash');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T11: Concurrency Race Condition Guard
  // --------------------------------------------------------------------------
  console.log('\n[TEST T11] Concurrency Race Condition Guard...');
  {
    const cust = await createTestCustomer('T11');
    await createUnappliedPayment(cust.id, 2000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 2000000);

    // Launch 5 parallel requests each with a distinct idempotency key
    const promises = Array.from({ length: 5 }, (_, i) => {
      const client = new ApiClient();
      client.cookie = staff.cookie;
      return client.request(`/api/invoices/${inv.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `t11-concurrent-${Date.now()}-${i}` }
      });
    });

    const results = await Promise.all(promises);
    const statuses = results.map(r => r.response.status);
    console.log(`  Concurrency response statuses: [${statuses.join(', ')}]`);

    const successCount = statuses.filter(s => s === 201).length;
    const rejectedCount = statuses.filter(s => s === 400).length;

    assert.equal(successCount, 1, 'Exactly one concurrent request succeeded');
    assert.equal(rejectedCount, 4, 'Remaining 4 concurrent requests were cleanly rejected');

    // Verify invoice and allocations in database
    const invCheck = check(await staff.request(`/api/invoices/${inv.id}`), 200, 'Get invoice T11');
    assert.equal(invCheck.invoice.status, 'PAID');
    assert.equal(Number(invCheck.invoice.paid_total), 2000000);

    const allocs = Number(queryDb(`SELECT count(*) FROM public.payment_allocations WHERE invoice_id = ${inv.id};`));
    assert.equal(allocs, 1, 'Exactly 1 allocation record was created');
    console.log('  -> PASS: Race condition prevented: exactly 1 thread won, 0 over-allocation, 0 negative cash');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T12: Concurrency with Same Idempotency Key
  // --------------------------------------------------------------------------
  console.log('\n[TEST T12] Concurrency with Same Idempotency Key...');
  {
    const cust = await createTestCustomer('T12');
    await createUnappliedPayment(cust.id, 2000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 2000000);

    const sharedKey = `t12-same-idemp-${Date.now()}`;
    const promises = Array.from({ length: 5 }, () => {
      const client = new ApiClient();
      client.cookie = staff.cookie;
      return client.request(`/api/invoices/${inv.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': sharedKey }
      });
    });

    const results = await Promise.all(promises);
    const statuses = results.map(r => r.response.status).sort();
    console.log(`  Same-key concurrency response statuses: [${statuses.join(', ')}]`);

    // Exactly one 201 Created and four 200 OK replays
    assert.deepEqual(statuses, [200, 200, 200, 200, 201], 'Exactly 1 created (201) and 4 cached replays (200)');

    const replays = results.filter(r => r.payload?.is_idempotent_replay === true).length;
    assert.equal(replays, 4, 'Exactly 4 responses flagged as idempotent replays');

    // Exactly 1 allocation created in DB
    const allocCount = Number(queryDb(`SELECT count(*) FROM public.payment_allocations WHERE invoice_id = ${inv.id};`));
    assert.equal(allocCount, 1, 'Exactly 1 allocation record was created');

    // Exactly 1 audit record created in DB (replays must not duplicate audit logs)
    const auditCount = Number(queryDb(`SELECT count(*) FROM public.audit_logs WHERE action = 'PAYMENT_AUTO_ALLOCATED' AND target_ref = '${inv.invoice_no}';`));
    assert.equal(auditCount, 1, 'Replays did not create duplicate audit records');

    console.log('  -> PASS: Same-key concurrency safely serialized: 1 win (201), 4 replays (200), 0 duplicate audits');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T13: Cross-Flow Concurrency: allocatePayment vs autoAllocateUnappliedCash
  // --------------------------------------------------------------------------
  console.log('\n[TEST T13] Cross-Flow Concurrency: allocatePayment vs autoAllocateUnappliedCash...');
  {
    const cust = await createTestCustomer('T13');
    const pay = await createUnappliedPayment(cust.id, 5000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 3000000);

    const client1 = new ApiClient();
    client1.cookie = staff.cookie;
    const client2 = new ApiClient();
    client2.cookie = staff.cookie;

    // Launch allocatePayment vs autoAllocateUnappliedCash simultaneously
    const [resAlloc, resAuto] = await Promise.all([
      client1.request(`/api/payments/${pay.id}/allocations`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `t13-cross-alloc-${Date.now()}` },
        body: {
          allocations: [{ invoice_id: inv.id, amount: '3000000.00' }]
        }
      }),
      client2.request(`/api/invoices/${inv.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `t13-cross-auto-${Date.now()}` }
      })
    ]);

    const statuses = [resAlloc.response.status, resAuto.response.status];
    console.log(`  Cross-flow response statuses: [allocatePayment: ${resAlloc.response.status}, autoAllocate: ${resAuto.response.status}]`);

    // Verify neither request threw 500 or deadlock (40P01)
    assert.ok(resAlloc.response.status !== 500, 'allocatePayment did not fail with 500/deadlock');
    assert.ok(resAuto.response.status !== 500, 'autoAllocate did not fail with 500/deadlock');
    assert.ok(!JSON.stringify(resAlloc.payload).includes('40P01'), 'No 40P01 deadlock in allocatePayment');
    assert.ok(!JSON.stringify(resAuto.payload).includes('40P01'), 'No 40P01 deadlock in autoAllocate');

    // Exactly one operation should succeed in allocating the invoice
    const successCount = statuses.filter(s => s === 201).length;
    assert.equal(successCount, 1, 'Exactly one concurrent operation succeeded in allocating (201)');

    // Verify the invoice is fully paid and not over-allocated
    const invCheck = check(await staff.request(`/api/invoices/${inv.id}`), 200, 'Get invoice T13');
    assert.equal(invCheck.invoice.status, 'PAID');
    assert.equal(Number(invCheck.invoice.paid_total), 3000000);

    // Verify payment unapplied cash
    const payCheck = check(await staff.request(`/api/payments/${pay.id}`), 200, 'Get payment T13');
    assert.equal(Number(payCheck.payment.allocated_amount), 3000000);
    assert.equal(Number(payCheck.payment.unapplied_amount), 2000000);

    // Verify exact allocation count in database
    const allocCount = Number(queryDb(`SELECT count(*) FROM public.payment_allocations WHERE invoice_id = ${inv.id};`));
    assert.equal(allocCount, 1, 'Exactly 1 allocation record exists for invoice');

    console.log('  -> PASS: Cross-flow concurrency resolved without deadlock (0 40P01, 1 win, 0 over-allocation)');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T14: Two Invoices Sharing Same Customer Payments Concurrency
  // --------------------------------------------------------------------------
  console.log('\n[TEST T14] Two Invoices Sharing Same Customer Payments Concurrency...');
  {
    const cust = await createTestCustomer('T14');
    const pay = await createUnappliedPayment(cust.id, 4000000, '2026-10-01');
    const inv1 = await createIssuedInvoice(cust.id, 3000000);
    const inv2 = await createIssuedInvoice(cust.id, 3000000);

    const client1 = new ApiClient();
    client1.cookie = staff.cookie;
    const client2 = new ApiClient();
    client2.cookie = staff.cookie;

    // Both invoices need 3M each (total 6M), but only 4M is available.
    // Flow 1: allocatePayment on inv1 (3M)
    // Flow 2: autoAllocateUnappliedCash on inv2
    const [res1, res2] = await Promise.all([
      client1.request(`/api/payments/${pay.id}/allocations`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `t14-share-alloc-${Date.now()}` },
        body: {
          allocations: [{ invoice_id: inv1.id, amount: '3000000.00' }]
        }
      }),
      client2.request(`/api/invoices/${inv2.id}/auto-allocate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `t14-share-auto-${Date.now()}` }
      })
    ]);

    console.log(`  Shared-payments response statuses: [alloc inv1: ${res1.response.status}, auto alloc inv2: ${res2.response.status}]`);
    assert.ok(res1.response.status !== 500, 'alloc inv1 did not fail with 500/deadlock');
    assert.ok(res2.response.status !== 500, 'auto alloc inv2 did not fail with 500/deadlock');
    assert.ok(!JSON.stringify(res1.payload).includes('40P01'), 'No 40P01 in alloc inv1');
    assert.ok(!JSON.stringify(res2.payload).includes('40P01'), 'No 40P01 in auto alloc inv2');

    // Total allocated from payment must NEVER exceed 4,000,000
    const payCheck = check(await staff.request(`/api/payments/${pay.id}`), 200, 'Get payment T14');
    const totalAllocatedFromPay = Number(payCheck.payment.allocated_amount);
    const unappliedFromPay = Number(payCheck.payment.unapplied_amount);

    assert.ok(totalAllocatedFromPay <= 4000000 + 0.001, `Allocated ${totalAllocatedFromPay} <= 4,000,000`);
    assert.ok(unappliedFromPay >= -0.001, `Unapplied ${unappliedFromPay} >= 0`);
    assert.equal(Math.round((totalAllocatedFromPay + unappliedFromPay) * 100) / 100, 4000000, 'Payment balance invariant holds');

    console.log('  -> PASS: Shared payments competition resolved without deadlock and strictly preserved financial invariants');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T15: Rollback After Lock Acquisition Atomicity
  // --------------------------------------------------------------------------
  console.log('\n[TEST T15] Rollback After Lock Acquisition Atomicity...');
  {
    const cust = await createTestCustomer('T15');
    const pay = await createUnappliedPayment(cust.id, 3000000, '2026-10-01');
    const inv = await createIssuedInvoice(cust.id, 2000000);

    // Attempt allocation with valid inv + non-existent inv (99999999)
    // Invoice lock acquired, then invoice not found -> rollback
    const failRes = await staff.request(`/api/payments/${pay.id}/allocations`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `t15-fail-${Date.now()}` },
      body: {
        allocations: [
          { invoice_id: inv.id, amount: '1000000.00' },
          { invoice_id: 99999999, amount: '1000000.00' }
        ]
      }
    });
    assert.equal(failRes.response.status, 404);

    // Verify invoice was not mutated
    const invCheck = check(await staff.request(`/api/invoices/${inv.id}`), 200, 'Check inv T15');
    assert.equal(invCheck.invoice.status, 'ISSUED');
    assert.equal(Number(invCheck.invoice.paid_total), 0);

    // Verify payment was not mutated
    const payCheck = check(await staff.request(`/api/payments/${pay.id}`), 200, 'Check pay T15');
    assert.equal(Number(payCheck.payment.allocated_amount), 0);
    assert.equal(Number(payCheck.payment.unapplied_amount), 3000000);

    // Now auto-allocate on the same invoice to prove locks were cleanly released
    const successRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `t15-success-${Date.now()}` }
    }), 201, 'Auto-allocate after rollback');
    assert.equal(successRes.invoice_status, 'PAID');
    assert.equal(Number(successRes.allocated_total), 2000000);

    console.log('  -> PASS: Transaction rollback released all locks cleanly; subsequent allocation succeeded immediately');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // T16: Financial Forensics & Invariants
  // --------------------------------------------------------------------------
  console.log('\n[TEST T16] Financial Forensics & Invariants...');
  {
    // Check 1: payment amount = allocated + unapplied (no payment over-allocated)
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

    // Check 2: payment unapplied amount >= 0 (no negative unapplied)
    const negativeUnapplied = Number(queryDb(`
      SELECT count(*)
      FROM (
        SELECT p.id, (p.amount - coalesce(sum(pa.allocated_amount), 0)) AS unapplied
        FROM public.payments p
        LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
        GROUP BY p.id, p.amount
        HAVING (p.amount - coalesce(sum(pa.allocated_amount), 0)) < -0.001
      ) sub;
    `));
    assert.equal(negativeUnapplied, 0, 'Zero negative unapplied payments');

    // Check 3: invoice paid_total = sum(payment_allocations)
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

    // Check 4: Collectible capacity paid_total + adjusted_total <= total
    const capacityViolations = Number(queryDb(`
      SELECT count(*)
      FROM public.invoices
      WHERE paid_total + adjusted_total > total + 0.001;
    `));
    assert.equal(capacityViolations, 0, 'Zero collectible capacity violations');

    // Check 5: Zero non-positive allocations
    const negativeAllocs = Number(queryDb(`
      SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0;
    `));
    assert.equal(negativeAllocs, 0, 'Zero negative allocations');

    // Check 6: Zero non-positive payments
    const nonPositivePayments = Number(queryDb(`
      SELECT count(*) FROM public.payments WHERE amount <= 0;
    `));
    assert.equal(nonPositivePayments, 0, 'Zero non-positive payments');

    // Check 7: Duplicate scheduler keys = 0
    const dupSchedKeys = Number(queryDb(`
      SELECT count(*) FROM (
        SELECT idempotency_key FROM public.payment_idempotency_keys
        WHERE idempotency_key LIKE 'RECURRING-AUTO-ALLOC-%'
        GROUP BY idempotency_key HAVING count(*) > 1
      ) dup;
    `));
    assert.equal(dupSchedKeys, 0, 'Zero duplicate scheduler keys');

    // Check 8: Duplicate scheduler allocations = 0
    const dupSchedAllocs = Number(queryDb(`
      SELECT count(*) FROM (
        SELECT invoice_id, payment_id, notes FROM public.payment_allocations
        WHERE notes = 'Tự động cấn trừ theo chu kỳ thuê bao định kỳ'
        GROUP BY invoice_id, payment_id, notes HAVING count(*) > 1
      ) dup;
    `));
    assert.equal(dupSchedAllocs, 0, 'Zero duplicate scheduler allocations');

    // Check 9: New payments generated by P1.3 = 0
    const newPaymentsP13 = Number(queryDb(`
      SELECT count(*) FROM public.payments
      WHERE reference LIKE '%AUTO-ALLOC%' OR notes LIKE '%cấn trừ%';
    `));
    assert.equal(newPaymentsP13, 0, 'Zero new payments generated by P1.3');

    // Check 10: Cryptographic audit log chain integrity
    const auditRes = check(await admin.request('/api/audit/verify', { method: 'POST' }), 200, 'Verify audit chain');
    assert.equal(auditRes.valid, true, 'Audit log cryptographic chain is valid');
    console.log(`  -> Audit chain valid: ${auditRes.total_records} verified events with 0 broken links`);

    // Check 11: PAYMENT_AUTO_ALLOCATED audit events exist
    const autoAllocEvents = Number(queryDb(`
      SELECT count(*) FROM public.audit_logs WHERE action = 'PAYMENT_AUTO_ALLOCATED';
    `));
    assert.ok(autoAllocEvents >= 5, `Found ${autoAllocEvents} PAYMENT_AUTO_ALLOCATED audit events`);
    console.log(`  -> PASS: All financial invariants strictly hold (0 violations across 100% of records)`);
    passedTests++;
  }

  console.log('\n===============================================================');
  console.log(`  P1.3 TEST SUITE COMPLETE: ${passedTests}/16 SCENARIOS PASSED (100%) `);
  console.log('===============================================================\n');
}

run().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
