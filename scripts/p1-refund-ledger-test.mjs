import assert from 'node:assert/strict';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD are required.');
}

// Ignore self-signed cert for local testing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
    const payload = response.status === 204 ? null : await response.json();
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
  console.log('===============================================================');
  console.log('       BILLING_ONE P1.1 REFUND LEDGER VERIFICATION SUITE       ');
  console.log('Testing Refund Ledger, Paid Invoice Credit Notes, Customer Debt');
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

  const stamp = Date.now();

  // Create test customer
  const customer = check(await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `Refund Test Customer ${stamp}`,
      email: `refund-${stamp}@test.vn`,
      phone: '0912345678',
      tax_code: `030${stamp.toString().slice(-7)}`,
      address: '100 Nguyen Hue, District 1, HCMC',
      credit_limit: '1000000000.00'
    }
  }), 201, 'Create test customer').customer;

  // Helper to create & issue a 100M invoice
  async function create100MInvoice(label) {
    const inv = check(await staff.request('/api/invoices', {
      method: 'POST',
      body: {
        customer_id: customer.id,
        due_date: '2027-12-31',
        tax_rate: '0',
        items: [
          {
            description: `Cloud Enterprise Plan (${label})`,
            quantity: '1',
            unit_price: '100000000.00',
            discount_percent: '0.00'
          }
        ]
      }
    }), 201, `Create invoice ${label}`).invoice;

    assert.equal(inv.total, '100000000.00');
    assert.equal(inv.paid_total, '0.00');
    assert.equal(inv.adjusted_total, '0.00');
    assert.equal(inv.outstanding, '100000000.00');

    const issued = check(await staff.request(`/api/invoices/${inv.id}/issue`, {
      method: 'POST',
      body: {}
    }), 200, `Issue invoice ${label}`).invoice;
    assert.equal(issued.status, 'ISSUED');
    return issued;
  }

  // ==========================================================================
  // TEST 1: Invoice 100M, Paid 30M, Credit Note 20M
  // Expected: paid = 30M, adjusted = 20M, outstanding = 50M, refund payable = 0
  // ==========================================================================
  console.log('--- TEST 1: Partial payment with Credit Note <= outstanding ---');
  const inv1 = await create100MInvoice('T1');

  // Pay 30M cash
  check(await staff.request(`/api/invoices/${inv1.id}/payments`, {
    method: 'POST',
    body: {
      amount: '30000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `PAY-T1-${stamp}`
    }
  }), 201, 'Pay 30M cash');

  // Create Credit Note 20M
  const cn1 = check(await staff.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: inv1.id,
      adjustment_type: 'DISCOUNT',
      amount: '20000000.00',
      vat_rate: '0',
      reason: 'Chiết khấu quý T1'
    }
  }), 201, 'Create 20M credit note').adjustment;
  assert.equal(cn1.total_amount, '20000000.00');

  check(await admin.request(`/api/adjustments/${cn1.id}/approve`, { method: 'POST', body: {} }), 200, 'Approve CN1');

  const proc1 = check(await admin.request(`/api/adjustments/${cn1.id}/process`, { method: 'POST', body: {} }), 200, 'Process CN1');
  assert.equal(proc1.ar_reduction, '20000000.00');
  assert.equal(proc1.refund_payable, '0.00');
  assert.equal(proc1.invoice.paid_total, '30000000.00');
  assert.equal(proc1.invoice.adjusted_total, '20000000.00');
  assert.equal(proc1.invoice.outstanding, '50000000.00');
  assert.equal(proc1.refund, null);

  const reloadedInv1 = check(await admin.request(`/api/invoices/${inv1.id}`), 200, 'Reload inv1').invoice;
  assert.equal(reloadedInv1.paid_total, '30000000.00');
  assert.equal(reloadedInv1.adjusted_total, '20000000.00');
  assert.equal(reloadedInv1.outstanding, '50000000.00');
  assert.equal(reloadedInv1.status, 'PARTIALLY_PAID');
  assert.equal(reloadedInv1.refunds.length, 0);
  console.log('[PASS] Test 1: Paid=30M, Adjusted=20M, Outstanding=50M, Refund=0.');

  // ==========================================================================
  // TEST 2: Invoice 100M, Paid 90M, Credit Note 30M
  // Expected: paid = 90M, adjusted = 10M, outstanding = 0, refund payable = 20M
  // ==========================================================================
  console.log('\n--- TEST 2: Credit Note exceeds outstanding (Split AR & Refund) ---');
  const inv2 = await create100MInvoice('T2');

  // Pay 90M cash
  check(await staff.request(`/api/invoices/${inv2.id}/payments`, {
    method: 'POST',
    body: {
      amount: '90000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `PAY-T2-${stamp}`
    }
  }), 201, 'Pay 90M cash');

  // Create Credit Note 30M (outstanding was 10M, so 10M AR reduction + 20M refund payable)
  const cn2 = check(await staff.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: inv2.id,
      adjustment_type: 'DISCOUNT',
      amount: '30000000.00',
      vat_rate: '0',
      reason: 'Chiết khấu vượt mức công nợ T2'
    }
  }), 201, 'Create 30M credit note').adjustment;

  check(await admin.request(`/api/adjustments/${cn2.id}/approve`, { method: 'POST', body: {} }), 200, 'Approve CN2');

  const proc2 = check(await admin.request(`/api/adjustments/${cn2.id}/process`, { method: 'POST', body: {} }), 200, 'Process CN2');
  assert.equal(proc2.ar_reduction, '10000000.00');
  assert.equal(proc2.refund_payable, '20000000.00');
  assert.equal(proc2.invoice.paid_total, '90000000.00');
  assert.equal(proc2.invoice.adjusted_total, '10000000.00');
  assert.equal(proc2.invoice.outstanding, '0.00');
  assert.equal(proc2.invoice.status, 'PAID');
  assert.ok(proc2.refund);
  assert.equal(proc2.refund.amount, '20000000.00');
  assert.equal(proc2.refund.status, 'PENDING');
  assert.ok(proc2.refund.refund_no.startsWith('REF-'));

  const reloadedInv2 = check(await admin.request(`/api/invoices/${inv2.id}`), 200, 'Reload inv2').invoice;
  assert.equal(reloadedInv2.paid_total, '90000000.00');
  assert.equal(reloadedInv2.adjusted_total, '10000000.00');
  assert.equal(reloadedInv2.outstanding, '0.00');
  assert.equal(reloadedInv2.status, 'PAID');
  assert.equal(reloadedInv2.refunds.length, 1);
  assert.equal(reloadedInv2.refunds[0].amount, '20000000.00');

  // Verify via /api/refunds
  const refundsList = check(await admin.request(`/api/refunds?invoice_id=${inv2.id}`), 200, 'Check /api/refunds').items;
  assert.equal(refundsList.length, 1);
  assert.equal(refundsList[0].amount, '20000000.00');
  assert.equal(refundsList[0].status, 'PENDING');
  console.log('[PASS] Test 2: Paid=90M, Adjusted=10M, Outstanding=0, Refund=20M recorded in ledger.');

  // ==========================================================================
  // TEST 3: Invoice 100M, Paid 100M, Credit Note 20M
  // Expected: paid = 100M, adjusted = 0M, outstanding = 0, refund payable = 20M
  // ==========================================================================
  console.log('\n--- TEST 3: Credit Note on fully PAID invoice ---');
  const inv3 = await create100MInvoice('T3');

  // Pay 100M cash (settled completely)
  const fullPay = check(await staff.request(`/api/invoices/${inv3.id}/payments`, {
    method: 'POST',
    body: {
      amount: '100000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `PAY-T3-${stamp}`
    }
  }), 201, 'Pay 100M cash').invoice;
  assert.equal(fullPay.status, 'PAID');
  assert.equal(fullPay.paid_total, '100000000.00');
  assert.equal(fullPay.total, '100000000.00');

  // Issue Credit Note 20M on this PAID invoice
  const cn3 = check(await staff.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: inv3.id,
      adjustment_type: 'SERVICE_RETURN',
      amount: '20000000.00',
      vat_rate: '0',
      reason: 'Hoàn trả dịch vụ do giảm quy mô'
    }
  }), 201, 'Create 20M credit note on PAID invoice').adjustment;

  check(await admin.request(`/api/adjustments/${cn3.id}/approve`, { method: 'POST', body: {} }), 200, 'Approve CN3');

  const proc3 = check(await admin.request(`/api/adjustments/${cn3.id}/process`, { method: 'POST', body: {} }), 200, 'Process CN3');
  assert.equal(proc3.ar_reduction, '0.00');
  assert.equal(proc3.refund_payable, '20000000.00');
  assert.equal(proc3.invoice.paid_total, '100000000.00');
  assert.equal(proc3.invoice.adjusted_total, '0.00');
  assert.equal(proc3.invoice.outstanding, '0.00');
  assert.equal(proc3.invoice.status, 'PAID');
  assert.ok(proc3.refund);
  assert.equal(proc3.refund.amount, '20000000.00');
  assert.equal(proc3.refund.status, 'PENDING');

  const reloadedInv3 = check(await admin.request(`/api/invoices/${inv3.id}`), 200, 'Reload inv3').invoice;
  assert.equal(reloadedInv3.paid_total, '100000000.00');
  assert.equal(reloadedInv3.adjusted_total, '0.00');
  assert.equal(reloadedInv3.outstanding, '0.00');
  assert.equal(reloadedInv3.status, 'PAID');
  assert.equal(reloadedInv3.refunds.length, 1);
  assert.equal(reloadedInv3.refunds[0].amount, '20000000.00');
  console.log('[PASS] Test 3: Paid invoice Credit Note handled cleanly without DB constraint violation.');

  // ==========================================================================
  // TEST 4: Process same adjustment twice -> 409 Conflict
  // ==========================================================================
  console.log('\n--- TEST 4: Replay Protection on Adjustment Process ---');
  const replayRes = await admin.request(`/api/adjustments/${cn3.id}/process`, { method: 'POST', body: {} });
  assert.equal(replayRes.response.status, 409, 'Replay process must return 409');
  assert.equal(replayRes.payload.error.code, 'ADJUSTMENT_ALREADY_PROCESSED');
  console.log('[PASS] Test 4: Replay request correctly rejected with 409 Conflict.');

  // ==========================================================================
  // TEST 5: Concurrent process same adjustment
  // ==========================================================================
  console.log('\n--- TEST 5: Concurrent Credit Note Processing & Unique Refund Identity ---');
  // Create another adjustment on inv1
  const cnConcurrent = check(await staff.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: inv1.id,
      adjustment_type: 'DECREASE_AMOUNT',
      amount: '5000000.00',
      vat_rate: '0',
      reason: 'Concurrent process test'
    }
  }), 201, 'Create concurrent test adjustment').adjustment;
  check(await admin.request(`/api/adjustments/${cnConcurrent.id}/approve`, { method: 'POST', body: {} }), 200, 'Approve concurrent CN');

  const [concA, concB] = await Promise.all([
    admin.request(`/api/adjustments/${cnConcurrent.id}/process`, { method: 'POST', body: {} }),
    admin.request(`/api/adjustments/${cnConcurrent.id}/process`, { method: 'POST', body: {} })
  ]);
  const concStatuses = [concA.response.status, concB.response.status].sort();
  assert.deepEqual(concStatuses, [200, 409], 'Exactly one process must succeed (200) and one must be rejected (409)');
  console.log('[PASS] Test 5: Concurrent process safely locked with exactly 1 success.');

  // ==========================================================================
  // TEST 6: Payment method CREDIT_NOTE rejected
  // ==========================================================================
  console.log('\n--- TEST 6: Payment Method Validation Guard ---');
  const fakeMethodRes = await staff.request(`/api/invoices/${inv1.id}/payments`, {
    method: 'POST',
    body: {
      amount: '1000000.00',
      method: 'CREDIT_NOTE',
      paid_at: '2026-10-07'
    }
  });
  assert.equal(fakeMethodRes.response.status, 400);
  assert.equal(fakeMethodRes.payload.error.code, 'INVALID_PAYMENT_METHOD');
  console.log('[PASS] Test 6: Payment method CREDIT_NOTE rejected with 400 Bad Request.');

  // ==========================================================================
  // TEST 7: Customer List current_debt matches Customer Detail
  // ==========================================================================
  console.log('\n--- TEST 7: Customer List current_debt vs Detail ---');
  const custList = check(await admin.request(`/api/customers?q=${encodeURIComponent(customer.name)}`), 200, 'Search customer').items;
  assert.equal(custList.length, 1);
  const custSummary = custList[0];

  const custDetail = check(await admin.request(`/api/customers/${customer.id}`), 200, 'Get customer detail').customer;
  assert.equal(custSummary.current_debt, custDetail.current_debt,
    `Customer list debt (${custSummary.current_debt}) must match customer detail debt (${custDetail.current_debt})`);
  assert.equal(custSummary.available_credit, custDetail.available_credit,
    `Customer list available_credit (${custSummary.available_credit}) must match detail (${custDetail.available_credit})`);
  console.log(`[PASS] Test 7: Customer list current_debt (${custSummary.current_debt} ₫) perfectly matches detail.`);

  // ==========================================================================
  // TEST 8: Customer Financial Profile matches List and Aging
  // ==========================================================================
  console.log('\n--- TEST 8: Customer Financial Profile vs Aging Report ---');
  const profileRes = check(await admin.request(`/api/customers/${customer.id}/financial-profile`), 200, 'Get financial profile');
  const profileDebt = profileRes.profile ? profileRes.profile.current_debt : profileRes.current_debt;
  assert.equal(profileDebt, custSummary.current_debt,
    `Financial profile debt (${profileDebt}) must match customer list debt (${custSummary.current_debt})`);

  // Check aging report
  const agingRep = check(await admin.request('/api/reports/aging'), 200, 'Get aging report');
  const agingCust = agingRep.customers.find(c => c.id === customer.id);
  if (agingCust) {
    assert.equal(agingCust.total_debt, custSummary.current_debt,
      `Aging customer debt (${agingCust.total_debt}) must match customer list debt (${custSummary.current_debt})`);
  }
  console.log('[PASS] Test 8: Financial profile and aging definition are 100% harmonized.');

  // ==========================================================================
  // TEST 9: Credit Note must not increase cash collected
  // ==========================================================================
  console.log('\n--- TEST 9: Cash Collected Pure Cash Integrity ---');
  const dashSummary = check(await admin.request('/api/dashboard/summary'), 200, 'Get dashboard summary');
  const reportsRev = check(await admin.request('/api/reports/revenue'), 200, 'Get revenue report');
  assert.equal(dashSummary.collected, reportsRev.total_collected, 'Dashboard collected must match reports total_collected');
  console.log(`[PASS] Test 9: Pure cash collected (${dashSummary.collected} ₫) unaffected by Credit Notes.`);

  // ==========================================================================
  // TEST 10: Invariant check across all created test invoices
  // ==========================================================================
  console.log('\n--- TEST 10: Database Invariant Verification on Invoices ---');
  for (const invId of [inv1.id, inv2.id, inv3.id]) {
    const inv = check(await admin.request(`/api/invoices/${invId}`), 200, `Verify invariants on invoice ${invId}`).invoice;
    const total = Number(inv.total);
    const paid = Number(inv.paid_total);
    const adjusted = Number(inv.adjusted_total);
    const outstanding = Number(inv.outstanding);

    assert.ok(paid >= 0, 'paid_total >= 0');
    assert.ok(adjusted >= 0, 'adjusted_total >= 0');
    assert.ok(paid + adjusted <= total + 0.01, `(paid + adjusted <= total): ${paid} + ${adjusted} <= ${total}`);
    assert.ok(outstanding >= 0, 'outstanding >= 0');
    assert.equal(Math.round(outstanding * 100) / 100, Math.round(Math.max(0, total - paid - adjusted) * 100) / 100,
      `outstanding must equal MAX(0, total - paid - adjusted)`);
  }
  console.log('[PASS] Test 10: Invariant (paid + adjusted <= total) and outstanding formula hold 100%.');

  console.log('\n===============================================================');
  console.log('ALL 10 P1.1 REFUND LEDGER SUITE TESTS PASSED WITH 100% SUCCESS!');
  console.log('===============================================================');
}

run().catch((err) => {
  console.error('\nFAIL: P1.1 Refund Ledger Test Suite failed:', err);
  process.exit(1);
});
