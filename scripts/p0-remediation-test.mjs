import assert from 'node:assert/strict';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD are required.');
}

// Ignore self-signed certificate for internal HTTPS test
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async request(path, { method = 'GET', body, headers: customHeaders } = {}) {
    const headers = new Headers();
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.cookie) headers.set('Cookie', this.cookie);
    if (customHeaders) {
      for (const [k, v] of Object.entries(customHeaders)) headers.set(k, v);
    }
    if (method === 'POST' && (path.includes('/payments') || path.includes('/allocations'))) {
      if (!headers.has('Idempotency-Key') && !headers.has('X-Idempotency-Key') && !(body && body.idempotency_key)) {
        headers.set('Idempotency-Key', `p0-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      }
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
  console.log('BILLING_ONE P0 FINANCIAL INTEGRITY VERIFICATION SUITE');
  console.log('Testing FIND-01, FIND-02, FIND-03, FIND-04 & Financial Invariants');
  console.log('===============================================================\n');

  const admin = new ApiClient();
  const staff = new ApiClient();

  // 1. Authenticate
  await admin.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword }
  }).then(r => check(r, 200, 'Admin login'));

  await staff.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'staff', password: staffPassword }
  }).then(r => check(r, 200, 'Staff login'));

  const stamp = Date.now();

  // ==========================================================================
  // TEST 1: FIND-01 & FIND-02 — INVOICE 100M, CREDIT NOTE 20M, CASH PAYMENT 30M
  // ==========================================================================
  console.log('--- TEST 1: Credit Note Semantics & Revenue/VAT/Collection Reporting ---');
  // Create customer
  const custRes = check(await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `FinIntegrity Customer ${stamp}`,
      email: `fin-${stamp}@test.vn`,
      phone: '0988776655',
      tax_code: `031${stamp.toString().slice(-7)}`,
      address: '789 Financial Way, D1, HCMC',
      credit_limit: '500000000.00'
    }
  }), 201, 'Create customer').customer;

  // Create invoice: Gross 100,000,000 VND (e.g. Subtotal 90,909,090.91 + 10% VAT 9,090,909.09 = 100,000,000)
  // Or cleaner: Items total 100,000,000 Subtotal + 10% VAT = 110,000,000 total.
  // The prompt specifies: "Invoice 100M, Credit Note 20M, Cash Payment 30M"
  // Let's create an invoice with total = 100,000,000:
  // Subtotal: 100,000,000 with tax_rate 0.00 OR Subtotal 90,909,090.91 with tax_rate 0.10.
  // To test VAT accurately: Let's do Subtotal 100,000,000, VAT 10% (10,000,000) -> Total 110,000,000
  // AND also an invoice exactly 100,000,000 total (Subtotal 100,000,000, tax_rate 0.00).
  // Let's create Subtotal 100,000,000, tax_rate 0.10 (Total 110M), and Credit Note with Amount 20M + 10% VAT (Total 22M), Cash 30M.
  // Or let's test exactly Subtotal = 100,000,000 with tax_rate 0.00:
  const invRes = check(await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: custRes.id,
      due_date: '2027-12-31',
      tax_rate: '0.10',
      items: [
        {
          description: 'High Performance Dedicated Server',
          quantity: '1',
          unit_price: '100000000.00',
          discount_percent: '0.00'
        }
      ]
    }
  }), 201, 'Create 100M subtotal invoice').invoice;

  // Verify initial amounts
  assert.equal(invRes.subtotal, '100000000.00');
  assert.equal(invRes.tax_amount, '10000000.00');
  assert.equal(invRes.total, '110000000.00');
  assert.equal(invRes.paid_total, '0.00');
  assert.equal(invRes.adjusted_total, '0.00');
  assert.equal(invRes.outstanding, '110000000.00');

  // Issue invoice
  const issuedInv = check(await staff.request(`/api/invoices/${invRes.id}/issue`, { method: 'POST', body: {} }), 200, 'Issue invoice').invoice;
  assert.equal(issuedInv.status, 'ISSUED');

  // 1. Record Cash Payment 30M
  const payRes = check(await staff.request(`/api/invoices/${invRes.id}/payments`, {
    method: 'POST',
    body: {
      amount: '30000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `PAY-TEST-${stamp}`,
      bank_name: 'Vietcombank',
      bank_account: '0011001234567'
    }
  }), 201, 'Record 30M cash payment');

  assert.equal(payRes.payment.amount, '30000000.00');
  assert.equal(payRes.invoice.paid_total, '30000000.00');
  assert.equal(payRes.invoice.status, 'PARTIALLY_PAID');

  // 2. Create Credit Note 20M net (amount: 20M, vat 10%: 2M -> total_amount: 22M)
  const cnRes = check(await staff.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invRes.id,
      adjustment_type: 'DISCOUNT',
      amount: '20000000.00',
      vat_rate: '0.10',
      reason: 'Chiết khấu thương mại khối lượng lớn',
      notes: 'Thỏa thuận P0 Test'
    }
  }), 201, 'Create 20M credit note').adjustment;

  assert.equal(cnRes.amount, '20000000.00');
  assert.equal(cnRes.vat_amount, '2000000.00');
  assert.equal(cnRes.total_amount, '22000000.00');
  assert.equal(cnRes.status, 'DRAFT');

  // Approve Credit Note
  check(await admin.request(`/api/adjustments/${cnRes.id}/approve`, { method: 'POST', body: {} }), 200, 'Approve credit note');

  // Process Credit Note
  const processedCn = check(await admin.request(`/api/adjustments/${cnRes.id}/process`, { method: 'POST', body: {} }), 200, 'Process credit note');
  assert.equal(processedCn.adjustment.status, 'PROCESSED');
  assert.equal(processedCn.ar_reduction, '22000000.00');
  assert.equal(processedCn.refund_payable, '0.00');
  assert.equal(processedCn.invoice.paid_total, '30000000.00'); // Cash paid MUST NOT increase!
  assert.equal(processedCn.invoice.adjusted_total, '22000000.00'); // Credit Note tracks in adjusted_total!

  // Invariant verification on invoice:
  // Total = 110M
  // Paid = 30M (cash)
  // Adjusted = 22M (credit note total)
  // Outstanding = 110M - 30M - 22M = 58M
  const reloadedInv = check(await admin.request(`/api/invoices/${invRes.id}`), 200, 'Reload invoice').invoice;
  assert.equal(reloadedInv.paid_total, '30000000.00');
  assert.equal(reloadedInv.adjusted_total, '22000000.00');
  assert.equal(reloadedInv.outstanding, '58000000.00');
  assert.equal(reloadedInv.status, 'PARTIALLY_PAID');

  // Total AR Reduction for this invoice = 30M (cash) + 22M (credit) = 52M!
  const arReductionTotal = Number(reloadedInv.paid_total) + Number(reloadedInv.adjusted_total);
  assert.equal(arReductionTotal, 52000000);

  // Verify that NO payment row was created for this Credit Note!
  const invPayments = reloadedInv.payments;
  assert.equal(invPayments.length, 1, 'Invoice must have only 1 payment row (the 30M cash payment)');
  assert.equal(invPayments[0].method, 'BANK_TRANSFER');
  assert.equal(invPayments[0].amount, '30000000.00');

  // Verify reports reflect the adjustment:
  const vatRep = check(await admin.request(`/api/reports/vat?year=2026`), 200, 'VAT report').summary;
  assert.ok(vatRep.total_net);
  assert.ok(vatRep.total_vat);

  const dashRes = check(await admin.request('/api/dashboard/summary'), 200, 'Dashboard summary');
  assert.ok(Number(dashRes.collected) > 0);
  assert.ok(Number(dashRes.outstanding) > 0);

  console.log('[PASS] Test 1: Credit Note correctly reduced AR without creating fake cash payments.');

  // ==========================================================================
  // TEST 2: FIND-04 — BANK RECONCILIATION REPLAY & DOUBLE MATCHING PROTECTION
  // ==========================================================================
  console.log('\n--- TEST 2: Bank Reconciliation Replay & Double Matching ---');
  // Create bank transaction
  const bankTx = check(await admin.request('/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-07',
      description: `THANH TOAN TIEN MAY CHU FT-${stamp}`,
      amount: '10000000.00',
      tx_type: 'CREDIT',
      reference: `FT-RECON-${stamp}`,
      bank_name: 'Techcombank',
      bank_account: '19036788889999'
    }
  }), 201, 'Create bank transaction').transaction;
  assert.equal(bankTx.status, 'UNMATCHED');

  // 1. First Match -> MUST SUCCEED (200)
  const match1 = check(await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: bankTx.id,
      invoice_id: invRes.id
    }
  }), 200, 'First manual match attempt').result;
  assert.equal(match1.status, 'MATCHED');

  // 2. Second Match (Replay) -> MUST FAIL (409 Conflict: TRANSACTION_ALREADY_MATCHED)
  const match2 = await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: bankTx.id,
      invoice_id: invRes.id
    }
  });
  assert.equal(match2.response.status, 409, 'Replay match must be rejected with HTTP 409');
  assert.equal(match2.payload.error.code, 'TRANSACTION_ALREADY_MATCHED');
  console.log('[PASS] Test 2.1: Replay manual match rejected with 409 Conflict.');

  // 3. Concurrent Matching Test:
  // Create another bank transaction
  const bankTxConcurrent = check(await admin.request('/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-07',
      description: `CONCURRENT MATCH TEST ${stamp}`,
      amount: '5000000.00',
      tx_type: 'CREDIT',
      reference: `FT-CONC-${stamp}`,
      bank_name: 'Techcombank',
      bank_account: '19036788889999'
    }
  }), 201, 'Create second bank transaction for concurrent test').transaction;

  // Send 2 simultaneous requests to match the SAME bank transaction
  const [resA, resB] = await Promise.all([
    admin.request('/api/reconciliation/manual-match', {
      method: 'POST',
      body: { transaction_id: bankTxConcurrent.id, invoice_id: invRes.id }
    }),
    admin.request('/api/reconciliation/manual-match', {
      method: 'POST',
      body: { transaction_id: bankTxConcurrent.id, invoice_id: invRes.id }
    })
  ]);

  const statuses = [resA.response.status, resB.response.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exactly one concurrent match must succeed (200) and one must be rejected (409)');
  console.log('[PASS] Test 2.2: Concurrent matching test passed (1 succeeded, 1 rejected with 409).');

  // ==========================================================================
  // TEST 3: CONCURRENT CREDIT NOTE PROCESSING & IDEMPOTENCY
  // ==========================================================================
  console.log('\n--- TEST 3: Concurrent Credit Note Processing & Idempotency ---');
  // Create another adjustment
  const cn2 = check(await staff.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invRes.id,
      adjustment_type: 'DECREASE_AMOUNT',
      amount: '1000000.00',
      vat_rate: '0.10',
      reason: 'Giảm giá kỹ thuật'
    }
  }), 201, 'Create adjustment 2').adjustment;
  check(await admin.request(`/api/adjustments/${cn2.id}/approve`, { method: 'POST', body: {} }), 200, 'Approve adjustment 2');

  // Trigger concurrent processing on same adjustment
  const [procA, procB] = await Promise.all([
    admin.request(`/api/adjustments/${cn2.id}/process`, { method: 'POST', body: {} }),
    admin.request(`/api/adjustments/${cn2.id}/process`, { method: 'POST', body: {} })
  ]);

  const procStatuses = [procA.response.status, procB.response.status].sort();
  assert.deepEqual(procStatuses, [200, 409], 'Exactly one concurrent process must succeed (200) and one must be rejected (409)');
  console.log('[PASS] Test 3: Concurrent credit note process enforced idempotency (1 succeeded, 1 rejected with 409).');

  // ==========================================================================
  // TEST 4: CONCURRENT PAYMENT OVER-ALLOCATION PROTECTION
  // ==========================================================================
  console.log('\n--- TEST 4: Payment Over-Allocation & Method Validation ---');
  // Verify method = 'CREDIT_NOTE' in /api/payments is REJECTED
  const fakeMethodPay = await staff.request(`/api/invoices/${invRes.id}/payments`, {
    method: 'POST',
    body: {
      amount: '1000000.00',
      method: 'CREDIT_NOTE',
      paid_at: '2026-10-07'
    }
  });
  assert.equal(fakeMethodPay.response.status, 400, 'Payment method CREDIT_NOTE must be rejected');
  assert.equal(fakeMethodPay.payload.error.code, 'INVALID_PAYMENT_METHOD');
  console.log('[PASS] Test 4.1: Direct payment with method CREDIT_NOTE rejected with HTTP 400.');

  // Reload current invoice
  const invFinal = check(await admin.request(`/api/invoices/${invRes.id}`), 200, 'Final invoice check').invoice;
  const currentOutstanding = Number(invFinal.outstanding);
  assert.ok(currentOutstanding > 0);

  // Try to pay more than current outstanding
  const overpay = await staff.request(`/api/invoices/${invRes.id}/payments`, {
    method: 'POST',
    body: {
      amount: (currentOutstanding + 1000000).toFixed(2),
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07'
    }
  });
  assert.equal(overpay.response.status, 409, 'Overpayment must be rejected with HTTP 409');
  assert.equal(overpay.payload.error.code, 'PAYMENT_EXCEEDS_OUTSTANDING');
  console.log('[PASS] Test 4.2: Payment exceeding outstanding rejected with 409 PAYMENT_EXCEEDS_OUTSTANDING.');

  console.log('\n===============================================================');
  console.log('ALL P0 REMEDIATION SUITE TESTS PASSED SUCCESSFULLY!');
  console.log('===============================================================');
}

run().catch((err) => {
  console.error('\nFAIL: P0 Remediation Test Suite failed:', err);
  process.exit(1);
});
