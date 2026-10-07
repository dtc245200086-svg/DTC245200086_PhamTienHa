import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load .env fallback if environment variables are not set
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
  throw new Error('STAFF_PASSWORD and ADMIN_PASSWORD are required.');
}

function queryDb(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker compose exec -T postgres psql -U postgres -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  return out;
}

function triggerOverdueScan() {
  const cmd = `docker compose exec -T web node -e "const { runOverdueScan } = require('./src/scheduler'); const { pool } = require('./src/db'); runOverdueScan(pool).then(r => { console.log('SCAN_RESULT:' + JSON.stringify(r)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  const line = out.split('\n').map(l => l.trim()).find(l => l.startsWith('SCAN_RESULT:'));
  if (line) {
    return JSON.parse(line.slice(12));
  }
  return JSON.parse(out.split('\n').pop().trim());
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
  console.log('   BILLING_ONE P1.4 OVERDUE INVOICE LIFECYCLE TEST SUITE (T01 - T21)  ');
  console.log('   Candidate A: Automated Overdue FSM, Concurrency & Audit Integrity   ');
  console.log('======================================================================\n');

  const admin = new ApiClient();
  const staff = new ApiClient();

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
        name: `P1.4 Customer ${prefix} ${Date.now()}`,
        email: `p14_${prefix.toLowerCase()}_${Date.now()}@overdue.vn`,
        tax_code: `MST-P14-${Date.now().toString().slice(-8)}`,
        address: '100 Overdue Lifecycle Blvd'
      }
    }), 201, `Create customer ${prefix}`);
    return custRes.customer;
  }

  async function createIssuedInvoice(customerId, amountVnd, dueDateOffsetDays = 30) {
    const d = new Date(Date.now() + 86400000 * dueDateOffsetDays).toISOString().slice(0, 10);
    const invRes = check(await staff.request('/api/invoices', {
      method: 'POST',
      body: {
        customer_id: customerId,
        due_date: d,
        tax_rate: '0',
        items: [{
          description: `Dịch vụ P1.4 ${amountVnd} VND`,
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
      headers: { 'Idempotency-Key': `p14-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      body: {
        customer_id: customerId,
        amount: Number(amountVnd).toFixed(2),
        method: 'BANK_TRANSFER',
        paid_at: paidAt,
        reference: `UNAPPLIED-P14-${Date.now()}`,
        allocations: []
      }
    }), 201, 'Create unapplied payment');
    return payRes.payment;
  }

  let testPassed = 0;

  // --------------------------------------------------------------------------
  // T01: ISSUED before due_date -> remains ISSUED after scan
  // --------------------------------------------------------------------------
  console.log('[T01] Hóa đơn ISSUED trước ngày due_date -> Giữ nguyên ISSUED...');
  {
    const cust = await createTestCustomer('T01');
    const inv = await createIssuedInvoice(cust.id, 1000000, 10); // due in 10 days
    const scanRes = triggerOverdueScan();
    const status = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(status, 'ISSUED', 'T01: Invoice before due_date must remain ISSUED');
    console.log('  -> PASS: T01 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T02: ISSUED exactly on due_date (current = due) -> remains ISSUED (0 days grace period)
  // --------------------------------------------------------------------------
  console.log('[T02] Hóa đơn ISSUED đúng ngày due_date (current = due) -> Giữ nguyên ISSUED...');
  {
    const cust = await createTestCustomer('T02');
    const inv = await createIssuedInvoice(cust.id, 1000000, 5);
    queryDb(`UPDATE public.invoices SET due_date = current_date WHERE id = ${inv.id}`);
    const scanRes = triggerOverdueScan();
    const status = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(status, 'ISSUED', 'T02: Invoice on exact due_date is NOT overdue');
    console.log('  -> PASS: T02 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T03: ISSUED after due_date (current > due) -> automatically transitions to OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T03] Hóa đơn ISSUED sau ngày due_date -> Tự động chuyển sang OVERDUE...');
  let t03Invoice;
  {
    const cust = await createTestCustomer('T03');
    t03Invoice = await createIssuedInvoice(cust.id, 1500000, 5);
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '3 days' WHERE id = ${t03Invoice.id}`);
    const scanRes = triggerOverdueScan();
    assert.ok(scanRes.processed >= 1, 'T03: Scan must process at least 1 invoice');
    const status = queryDb(`SELECT status FROM public.invoices WHERE id = ${t03Invoice.id}`);
    assert.equal(status, 'OVERDUE', 'T03: Invoice past due date must transition to OVERDUE');

    // Verify audit event
    const auditRow = queryDb(`
      SELECT actor_name, actor_role, metadata 
      FROM public.audit_logs 
      WHERE action = 'INVOICE_OVERDUE_FLAGGED' AND metadata->>'invoice_id' = '${t03Invoice.id}'
      ORDER BY id DESC LIMIT 1
    `);
    assert.ok(auditRow, 'T03: INVOICE_OVERDUE_FLAGGED audit record must exist');
    const parts = auditRow.split('|');
    assert.equal(parts[0], 'SystemScheduler', 'Audit actor_name must be SystemScheduler');
    assert.equal(parts[1], 'SYSTEM', 'Audit actor_role must be SYSTEM');
    const meta = JSON.parse(parts[2]);
    assert.equal(Number(meta.invoice_id), Number(t03Invoice.id));
    assert.equal(meta.invoice_no, t03Invoice.invoice_no);
    assert.equal(meta.days_overdue, 3);
    assert.equal(meta.outstanding_amount, '1500000.00');
    console.log('  -> PASS: T03 verified with audit event');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T04: PARTIALLY_PAID before due_date -> remains PARTIALLY_PAID
  // --------------------------------------------------------------------------
  console.log('[T04] Hóa đơn PARTIALLY_PAID trước ngày due_date -> Giữ nguyên PARTIALLY_PAID...');
  {
    const cust = await createTestCustomer('T04');
    const inv = await createIssuedInvoice(cust.id, 2000000, 15);
    // Partial payment 500,000 VND
    check(await staff.request(`/api/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `p14-t04-pay-${Date.now()}` },
      body: { amount: '500000.00', method: 'CASH', paid_at: '2026-10-01' }
    }), 201, 'T04 partial payment');
    const statusBefore = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(statusBefore, 'PARTIALLY_PAID');

    triggerOverdueScan();
    const statusAfter = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(statusAfter, 'PARTIALLY_PAID', 'T04: Future PARTIALLY_PAID invoice must remain PARTIALLY_PAID');
    console.log('  -> PASS: T04 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T05: PARTIALLY_PAID after due_date with outstanding > 0 -> transitions to OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T05] Hóa đơn PARTIALLY_PAID sau ngày due_date -> Tự động chuyển sang OVERDUE...');
  let t05Invoice;
  {
    const cust = await createTestCustomer('T05');
    t05Invoice = await createIssuedInvoice(cust.id, 3000000, 10);
    check(await staff.request(`/api/invoices/${t05Invoice.id}/payments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `p14-t05-pay-${Date.now()}` },
      body: { amount: '1000000.00', method: 'CASH', paid_at: '2026-10-01' }
    }), 201, 'T05 partial payment');

    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '4 days' WHERE id = ${t05Invoice.id}`);
    triggerOverdueScan();
    const status = queryDb(`SELECT status FROM public.invoices WHERE id = ${t05Invoice.id}`);
    assert.equal(status, 'OVERDUE', 'T05: Past-due PARTIALLY_PAID must transition to OVERDUE');
    console.log('  -> PASS: T05 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T06: DRAFT with past due_date -> NEVER transitions to OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T06] Hóa đơn DRAFT có due_date trong quá khứ -> Tuyệt đối KHÔNG chuyển sang OVERDUE...');
  {
    const cust = await createTestCustomer('T06');
    const draftRes = check(await staff.request('/api/invoices', {
      method: 'POST',
      body: {
        customer_id: cust.id,
        due_date: '2026-01-01',
        tax_rate: '0',
        items: [{ description: 'Draft item', quantity: '1', unit_price: '500000.00' }]
      }
    }), 201, 'Create draft');
    queryDb(`UPDATE public.invoices SET due_date = current_date - interval '10 days' WHERE id = ${draftRes.invoice.id}`);
    triggerOverdueScan();
    const status = queryDb(`SELECT status FROM public.invoices WHERE id = ${draftRes.invoice.id}`);
    assert.equal(status, 'DRAFT', 'T06: DRAFT must remain DRAFT');
    console.log('  -> PASS: T06 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T07: PAID with past due_date -> NEVER transitions to OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T07] Hóa đơn PAID có due_date trong quá khứ -> Tuyệt đối KHÔNG chuyển sang OVERDUE...');
  {
    const cust = await createTestCustomer('T07');
    const inv = await createIssuedInvoice(cust.id, 1000000, 10);
    check(await staff.request(`/api/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `p14-t07-pay-${Date.now()}` },
      body: { amount: '1000000.00', method: 'BANK_TRANSFER', paid_at: '2026-10-01' }
    }), 201, 'T07 full payment');
    const statusBefore = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(statusBefore, 'PAID');

    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '15 days', due_date = current_date - interval '10 days' WHERE id = ${inv.id}`);
    triggerOverdueScan();
    const statusAfter = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(statusAfter, 'PAID', 'T07: PAID must remain PAID');
    console.log('  -> PASS: T07 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T08: CANCELLED with past due_date -> NEVER transitions to OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T08] Hóa đơn CANCELLED có due_date trong quá khứ -> Tuyệt đối KHÔNG chuyển sang OVERDUE...');
  {
    const cust = await createTestCustomer('T08');
    const inv = await createIssuedInvoice(cust.id, 800000, 10);
    check(await admin.request(`/api/invoices/${inv.id}/cancel`, {
      method: 'POST',
      body: { reason: 'Test cancel for T08' }
    }), 200, 'T08 cancel');
    const statusBefore = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(statusBefore, 'CANCELLED');

    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '15 days', due_date = current_date - interval '10 days' WHERE id = ${inv.id}`);
    triggerOverdueScan();
    const statusAfter = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(statusAfter, 'CANCELLED', 'T08: CANCELLED must remain CANCELLED');
    console.log('  -> PASS: T08 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T09: Outstanding = 0 (adjusted_total = total) -> NEVER transitions to OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T09] Hóa đơn đã tất toán hết (outstanding = 0) -> Tuyệt đối KHÔNG chuyển sang OVERDUE...');
  {
    const cust = await createTestCustomer('T09');
    const inv = await createIssuedInvoice(cust.id, 600000, 10);
    // Simulate adjustment covering entire total
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', adjusted_total = 600000, due_date = current_date - interval '5 days' WHERE id = ${inv.id}`);
    triggerOverdueScan();
    const status = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(status, 'ISSUED', 'T09: Outstanding = 0 must not become OVERDUE');
    console.log('  -> PASS: T09 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T10: OVERDUE receives 100% full payment -> transitions to PAID
  // --------------------------------------------------------------------------
  console.log('[T10] Hóa đơn OVERDUE nhận thanh toán đủ 100% -> Chuyển sang PAID...');
  {
    const cust = await createTestCustomer('T10');
    const inv = await createIssuedInvoice(cust.id, 2500000, 5);
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '2 days' WHERE id = ${inv.id}`);
    triggerOverdueScan();
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`), 'OVERDUE');

    const payRes = check(await staff.request(`/api/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `p14-t10-pay-${Date.now()}` },
      body: { amount: '2500000.00', method: 'BANK_TRANSFER', paid_at: '2026-10-05' }
    }), 201, 'T10 full settlement');

    const statusAfter = queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`);
    assert.equal(statusAfter, 'PAID', 'T10: Full settlement of OVERDUE must transition to PAID');
    console.log('  -> PASS: T10 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T11: OVERDUE receives partial payment -> REMAINS OVERDUE (NEVER PARTIALLY_PAID)
  // --------------------------------------------------------------------------
  console.log('[T11] Hóa đơn OVERDUE nhận thanh toán một phần -> GIỮ NGUYÊN OVERDUE...');
  let t11Invoice;
  {
    const cust = await createTestCustomer('T11');
    t11Invoice = await createIssuedInvoice(cust.id, 4000000, 5);
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '5 days' WHERE id = ${t11Invoice.id}`);
    triggerOverdueScan();
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${t11Invoice.id}`), 'OVERDUE');

    const payRes = check(await staff.request(`/api/invoices/${t11Invoice.id}/payments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `p14-t11-pay-${Date.now()}` },
      body: { amount: '1500000.00', method: 'BANK_TRANSFER', paid_at: '2026-10-05' }
    }), 201, 'T11 partial payment');

    const statusAfter = queryDb(`SELECT status FROM public.invoices WHERE id = ${t11Invoice.id}`);
    assert.equal(statusAfter, 'OVERDUE', 'T11: Partial settlement of OVERDUE invoice MUST remain OVERDUE');
    const outstanding = queryDb(`SELECT (total - paid_total - adjusted_total)::text FROM public.invoices WHERE id = ${t11Invoice.id}`);
    assert.equal(outstanding, '2500000.00', 'T11: Outstanding debt correctly decremented');
    console.log('  -> PASS: T11 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T12: Execute runOverdueScan() 5 times consecutively -> Idempotent
  // --------------------------------------------------------------------------
  console.log('[T12] Thực thi runOverdueScan() lặp lại 5 lần liên tiếp -> Idempotent...');
  {
    for (let i = 1; i <= 5; i++) {
      const res = triggerOverdueScan();
      // On repeated scans with no newly overdue invoices, processed should be 0
      assert.equal(res.processed, 0, `Iteration ${i}: processed must be 0 for already overdue invoices`);
    }
    // Verify invoice statuses unchanged
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${t03Invoice.id}`), 'OVERDUE');
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${t05Invoice.id}`), 'OVERDUE');
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${t11Invoice.id}`), 'OVERDUE');
    console.log('  -> PASS: T12 verified (5 consecutive scans idempotent)');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T13: No duplicate audit events on repeated scans
  // --------------------------------------------------------------------------
  console.log('[T13] Kiểm tra không sinh trùng lặp sự kiện kiểm toán khi quét lặp...');
  {
    const countT03 = Number(queryDb(`
      SELECT count(*) FROM public.audit_logs 
      WHERE action = 'INVOICE_OVERDUE_FLAGGED' AND metadata->>'invoice_id' = '${t03Invoice.id}'
    `));
    assert.equal(countT03, 1, 'T13: Exactly 1 audit record for T03 invoice');

    const countT05 = Number(queryDb(`
      SELECT count(*) FROM public.audit_logs 
      WHERE action = 'INVOICE_OVERDUE_FLAGGED' AND metadata->>'invoice_id' = '${t05Invoice.id}'
    `));
    assert.equal(countT05, 1, 'T13: Exactly 1 audit record for T05 invoice');

    console.log('  -> PASS: T13 verified (Zero duplicate audit entries)');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T14: Direct payment against OVERDUE succeeds via API
  // --------------------------------------------------------------------------
  console.log('[T14] Thanh toán trực tiếp cho hóa đơn OVERDUE qua API -> Thành công HTTP 201...');
  {
    const cust = await createTestCustomer('T14');
    const inv = await createIssuedInvoice(cust.id, 1800000, 5);
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '1 day' WHERE id = ${inv.id}`);
    triggerOverdueScan();
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`), 'OVERDUE');

    const payRes = check(await staff.request(`/api/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `p14-t14-pay-${Date.now()}` },
      body: { amount: '1000000.00', method: 'CARD', paid_at: '2026-10-06' }
    }), 201, 'T14 direct payment');

    assert.equal(payRes.allocations[0].invoice_id, inv.id);
    assert.equal(payRes.allocations[0].allocated_amount, '1000000.00');
    console.log('  -> PASS: T14 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T15: Unapplied cash auto-settlement against OVERDUE succeeds
  // --------------------------------------------------------------------------
  console.log('[T15] Cấn trừ tiền thừa (Unapplied Cash) cho hóa đơn OVERDUE -> Thành công...');
  {
    const cust = await createTestCustomer('T15');
    const unappliedPay = await createUnappliedPayment(cust.id, 3000000);
    const inv = await createIssuedInvoice(cust.id, 2000000, 5);
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '2 days' WHERE id = ${inv.id}`);
    triggerOverdueScan();
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${inv.id}`), 'OVERDUE');

    const allocRes = check(await staff.request(`/api/invoices/${inv.id}/auto-allocate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `p14-t15-auto-alloc-${Date.now()}` }
    }), 201, 'T15 auto-allocate unapplied');

    assert.equal(allocRes.success, true);
    assert.equal(allocRes.invoice_status, 'PAID');
    assert.equal(allocRes.allocated_total, '2000000.00');
    assert.equal(allocRes.remaining_unapplied_cash, '1000000.00');
    console.log('  -> PASS: T15 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T16: Customer debt remains correct when invoice is OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T16] Kiểm tra customer.current_debt sau khi hóa đơn thành OVERDUE...');
  {
    const cust = await createTestCustomer('T16');
    const inv1 = await createIssuedInvoice(cust.id, 1200000, 10);
    const inv2 = await createIssuedInvoice(cust.id, 2300000, 10);

    const custBefore = check(await staff.request(`/api/customers/${cust.id}`), 200, 'T16 customer before');
    assert.equal(custBefore.customer.current_debt, '3500000.00');

    // Make inv2 overdue
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '3 days' WHERE id = ${inv2.id}`);
    triggerOverdueScan();
    assert.equal(queryDb(`SELECT status FROM public.invoices WHERE id = ${inv2.id}`), 'OVERDUE');

    const custAfter = check(await staff.request(`/api/customers/${cust.id}`), 200, 'T16 customer after');
    assert.equal(custAfter.customer.current_debt, '3500000.00', 'T16: current_debt must not decrease when invoice becomes OVERDUE');
    console.log('  -> PASS: T16 verified (No debt drop)');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T17: Aging Report includes OVERDUE invoices
  // --------------------------------------------------------------------------
  console.log('[T17] Kiểm tra Báo cáo Tuổi nợ (/api/reports/aging) bao gồm hóa đơn OVERDUE...');
  {
    const agingRes = check(await staff.request('/api/reports/aging'), 200, 'T17 aging report');
    assert.ok(Number(agingRes.summary.total_receivables) > 0, 'Aging total receivables must be positive');
    // Check customer from T16 is present in customers matrix
    const custInAging = agingRes.customers.find(c => c.customer_name.includes('T16'));
    assert.ok(custInAging, 'T16 customer must appear in aging matrix');
    assert.equal(custInAging.total_debt, '3500000.00', 'Customer total_debt in aging report matches');
    console.log('  -> PASS: T17 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T18: Collection Metrics include OVERDUE
  // --------------------------------------------------------------------------
  console.log('[T18] Kiểm tra Chỉ số Thu hồi (/api/reports/collection-metrics)...');
  {
    const metricsRes = check(await staff.request('/api/reports/collection-metrics'), 200, 'T18 collection metrics');
    assert.ok(Number(metricsRes.receivables) > 0, 'Receivables must be positive');
    assert.ok(Number(metricsRes.overdue_amount) > 0, 'Overdue amount must be positive');
    assert.ok(metricsRes.dso !== undefined, 'DSO must be calculated');
    assert.ok(metricsRes.cei !== undefined, 'CEI must be calculated');
    console.log('  -> PASS: T18 verified');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T19: SHA-256 Audit Chain Verification
  // --------------------------------------------------------------------------
  console.log('[T19] Kiểm tra toàn vẹn chuỗi băm SHA-256 sau khi quét...');
  {
    const verifyRes = check(await admin.request('/api/audit/verify', { method: 'POST' }), 200, 'T19 verify audit chain');
    assert.equal(verifyRes.valid, true, 'Audit chain must be valid');
    assert.equal(verifyRes.verified_count, verifyRes.total_records, '100% records verified');
    console.log(`  -> PASS: T19 verified (${verifyRes.total_records} records verified valid)`);
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T20: Concurrency Locking Test (Scheduler + Allocation + Auto-settle + Reconciliation)
  // --------------------------------------------------------------------------
  console.log('[T20] Kiểm tra Concurrency Locking (Quét nợ, Phân bổ, Cấn trừ & Đối soát)...');
  {
    const cust = await createTestCustomer('T20_CONC');
    // Create 4 overlapping invoices
    const inv1 = await createIssuedInvoice(cust.id, 1000000, 5);
    const inv2 = await createIssuedInvoice(cust.id, 2000000, 5);
    const inv3 = await createIssuedInvoice(cust.id, 3000000, 5);
    const inv4 = await createIssuedInvoice(cust.id, 4000000, 5);

    // Make all 4 past due
    queryDb(`UPDATE public.invoices SET issue_date = current_date - interval '10 days', due_date = current_date - interval '2 days' WHERE id IN (${inv1.id}, ${inv2.id}, ${inv3.id}, ${inv4.id})`);

    // Create an unapplied payment for customer
    const unappliedPay = await createUnappliedPayment(cust.id, 2500000);

    // Run parallel concurrent operations targeting these invoices
    const errors = [];
    const promises = [
      // Op 1: Scheduler overdue scan
      (async () => {
        try {
          triggerOverdueScan();
        } catch (e) {
          errors.push(`Scheduler error: ${e.message}`);
        }
      })(),
      // Op 2: Direct payment allocation on inv1
      (async () => {
        try {
          await staff.request(`/api/invoices/${inv1.id}/payments`, {
            method: 'POST',
            headers: { 'Idempotency-Key': `p14-t20-pay-${Date.now()}` },
            body: { amount: '500000.00', method: 'CASH', paid_at: '2026-10-06' }
          });
        } catch (e) {
          errors.push(`Direct pay error: ${e.message}`);
        }
      })(),
      // Op 3: Auto-allocate unapplied cash on inv2
      (async () => {
        try {
          await staff.request(`/api/invoices/${inv2.id}/auto-allocate`, {
            method: 'POST',
            headers: { 'Idempotency-Key': `p14-t20-alloc-${Date.now()}` }
          });
        } catch (e) {
          errors.push(`Auto-allocate error: ${e.message}`);
        }
      })(),
      // Op 4: Another concurrent scan
      (async () => {
        try {
          triggerOverdueScan();
        } catch (e) {
          errors.push(`Scheduler 2 error: ${e.message}`);
        }
      })(),
      // Op 5: Direct payment on inv3
      (async () => {
        try {
          await staff.request(`/api/invoices/${inv3.id}/payments`, {
            method: 'POST',
            headers: { 'Idempotency-Key': `p14-t20-pay3-${Date.now()}` },
            body: { amount: '1000000.00', method: 'BANK_TRANSFER', paid_at: '2026-10-06' }
          });
        } catch (e) {
          errors.push(`Direct pay 3 error: ${e.message}`);
        }
      })()
    ];

    await Promise.all(promises);

    // Verify no fatal deadlock errors
    const deadlockErrors = errors.filter(e => e.includes('40P01') || e.includes('deadlock'));
    assert.equal(deadlockErrors.length, 0, `T20: Deadlock errors detected: ${deadlockErrors.join('; ')}`);

    // Verify all invoices have valid allowed statuses
    const rows = queryDb(`SELECT id, status, total, paid_total, adjusted_total FROM public.invoices WHERE id IN (${inv1.id}, ${inv2.id}, ${inv3.id}, ${inv4.id})`);
    for (const r of rows.split('\n')) {
      if (!r.trim()) continue;
      const [id, st, tot, paid, adj] = r.split('|');
      assert.ok(
        ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'].includes(st),
        `Invoice ${id} has invalid status ${st}`
      );
      assert.ok(Number(paid) <= Number(tot), `Invoice ${id} paid_total cannot exceed total`);
    }

    console.log('  -> PASS: T20 verified (0 deadlocks, clean concurrency safety)');
    testPassed++;
  }

  // --------------------------------------------------------------------------
  // T21: Full Regression Check (12 Suites P0 - P1.3) & Financial Forensics
  // --------------------------------------------------------------------------
  console.log('[T21] Kiểm tra Hồi quy Toàn diện (Regression Check P0 - P1.3) & 9 Bất biến Tài chính...');
  {
    // Part A: Programmatically execute all 12 regression suites P0 -> P1.3
    const regressionSuites = [
      { file: 'scripts/p0-remediation-test.mjs', name: 'P0 Financial Integrity Suite' },
      { file: 'scripts/p1-refund-ledger-test.mjs', name: 'P1.1 Refund Ledger Suite' },
      { file: 'scripts/p1_2-payment-allocation-test.mjs', name: 'P1.2 Payment Allocation V2' },
      { file: 'scripts/p1_2_1-idempotency-test.mjs', name: 'P1.2.1 Direct Payment Idempotency' },
      { file: 'scripts/p1_2_2-mandatory-idempotency-test.mjs', name: 'P1.2.2 Mandatory Idempotency' },
      { file: 'scripts/p1_3-auto-settlement-test.mjs', name: 'P1.3 Dedicated Auto-Settlement' },
      { file: 'scripts/p1_3_1-remediation-test.mjs', name: 'P1.3.1 Remediation Verification' },
      { file: 'scripts/cp2-smoke.mjs', name: 'CP2 Baseline Smoke Suite' },
      { file: 'scripts/extended-features-test.mjs', name: 'Extended Enterprise Features' },
      { file: 'scripts/frontend-e2e-test.mjs', name: 'Frontend Smoke & Asset E2E' },
      { file: 'scripts/verify-hardening.ps1', name: 'Security Hardening H1 - H6' },
      { file: 'scripts/verify-audit-chain.mjs', name: 'Cryptographic Audit Chain' }
    ];

    console.log('[T21] Regression suites:');
    regressionSuites.forEach((s, i) => console.log(`  ${i + 1}. ${s.file} (${s.name})`));

    const subEnv = {
      ...process.env,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      CP2_BASE_URL: process.env.CP2_BASE_URL || baseUrl,
      CP2_EXPECT_SECURE_COOKIE: 'true',
      CP2_EXPECT_PUBLIC_HEALTH_BLOCKED: 'true'
    };

    let suitesPassed = 0;
    for (const [idx, s] of regressionSuites.entries()) {
      try {
        execSync('docker compose restart nginx', { stdio: 'ignore' });
      } catch (err) {}

      console.log(`  [T21.${idx + 1}/12] Executing ${s.file} (${s.name})...`);
      const isPs1 = s.file.endsWith('.ps1');
      const cmd = isPs1 ? (process.platform === 'win32' ? 'powershell' : 'pwsh') : process.execPath;
      const args = isPs1 ? ['-ExecutionPolicy', 'Bypass', '-File', s.file] : [s.file];

      const res = spawnSync(cmd, args, {
        env: subEnv,
        encoding: 'utf8',
        timeout: 180000
      });

      if (res.error) {
        throw new Error(`Execution failed for ${s.file}: ${res.error.message}`);
      }

      if (res.status !== 0) {
        console.error(`  -> FAIL: ${s.file} exited with code ${res.status}`);
        if (res.stdout) console.error(`--- STDOUT (${s.file}) ---\n${res.stdout}`);
        if (res.stderr) console.error(`--- STDERR (${s.file}) ---\n${res.stderr}`);
        assert.fail(`Regression suite ${s.file} failed with exit code ${res.status}`);
      }

      console.log(`  -> PASS: [${idx + 1}/12] ${s.file} (exit code 0)`);
      suitesPassed++;
    }
    assert.equal(suitesPassed, 12, 'All 12 regression test suites must pass (100%)');

    // Part B: Financial Forensics - 9 Authoritative Metrics
    console.log('  [T21.Forensics] Kiểm tra 9 Bất biến Tài chính P1.3 / P1.4...');
    const forensicQuery = `
      SELECT 
        (SELECT count(*) FROM (
          SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
          FROM public.payments p
          LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
          GROUP BY p.id, p.amount
          HAVING coalesce(sum(pa.allocated_amount), 0) > p.amount + 0.001
        ) s1) AS over_allocated_payments,

        (SELECT count(*) FROM (
          SELECT p.id, (p.amount - coalesce(sum(pa.allocated_amount), 0)) AS unapplied
          FROM public.payments p
          LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
          GROUP BY p.id, p.amount
          HAVING (p.amount - coalesce(sum(pa.allocated_amount), 0)) < -0.001
        ) s2) AS negative_unapplied_payments,

        (SELECT count(*) FROM (
          SELECT i.id, i.paid_total, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
          FROM public.invoices i
          LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id
          GROUP BY i.id, i.paid_total
          HAVING abs(i.paid_total - coalesce(sum(pa.allocated_amount), 0)) > 0.001
        ) s3) AS invoice_allocation_mismatches,

        (SELECT count(*) FROM public.invoices WHERE paid_total + adjusted_total > total + 0.001) AS collectible_capacity_violations,

        (SELECT count(*) FROM public.payments WHERE amount <= 0) AS non_positive_payments,

        (SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0) AS non_positive_allocations,

        (SELECT count(*) FROM (
          SELECT idempotency_key, count(*) 
          FROM public.payment_idempotency_keys 
          WHERE idempotency_key LIKE 'RECURRING-AUTO-ALLOC-%' 
          GROUP BY idempotency_key HAVING count(*) > 1
        ) dup_keys) AS duplicate_scheduler_keys,

        (SELECT count(*) FROM (
          SELECT invoice_id, payment_id, notes, count(*) 
          FROM public.payment_allocations 
          WHERE notes = 'Tự động cấn trừ theo chu kỳ thuê bao định kỳ'
          GROUP BY invoice_id, payment_id, notes HAVING count(*) > 1
        ) dup_sched_allocs) AS duplicate_scheduler_allocations,

        (SELECT count(*) FROM public.payments 
         WHERE reference LIKE '%AUTO-ALLOC%' OR notes LIKE '%cấn trừ%') AS new_payments_by_p1_3;
    `;

    const fRes = queryDb(forensicQuery);
    const f = fRes.split('|').map(Number);
    assert.equal(f[0], 0, 'payment_over_allocation = 0');
    assert.equal(f[1], 0, 'negative_unapplied = 0');
    assert.equal(f[2], 0, 'invoice_allocation_mismatch = 0');
    assert.equal(f[3], 0, 'collectible_capacity_violation = 0');
    assert.equal(f[4], 0, 'non_positive_payments = 0');
    assert.equal(f[5], 0, 'non_positive_allocations = 0');
    assert.equal(f[6], 0, 'dup_sched_keys = 0');
    assert.equal(f[7], 0, 'duplicate_scheduler_allocation = 0');
    assert.equal(f[8], 0, 'p13_created_payments = 0');

    console.log('  -> PASS: T21 verified (12/12 regression suites passed AND all 9 authoritative financial metrics = 0)');
    testPassed++;
  }

  console.log('\n======================================================================');
  console.log(`   P1.4 TEST EXECUTION SUMMARY: ${testPassed}/21 TESTS PASSED (100%)       `);
  console.log('======================================================================\n');
}

run().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
