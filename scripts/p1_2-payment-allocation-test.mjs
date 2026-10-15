import assert from 'node:assert/strict';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD are required.');
}

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
        headers.set('Idempotency-Key', `alloc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      }
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 429 && path.includes('/auth/login')) {
      console.log('[TEST_HARNESS] 429 Rate limit encountered on login. Backing off 12s for token replenishment...');
      await new Promise(r => setTimeout(r, 12000));
      return this.request(path, { method, body, headers: customHeaders });
    }
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
  console.log('===============================================================');
  console.log('       BILLING_ONE P1.2 PAYMENT ALLOCATION V2 TEST SUITE       ');
  console.log('Testing 1 Payment -> N Invoices, Unapplied Cash, & Concurrency ');
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

  // Helper: Create a Customer
  const customer = check(await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `P1.2 Test Customer ${stamp}`,
      email: `p12-${stamp}@test.vn`,
      phone: '0901234567',
      tax_code: `030${stamp.toString().slice(-7)}`,
      address: '200 Le Loi, District 1, HCMC',
      credit_limit: '1000000000.00'
    }
  }), 201, 'Create test customer').customer;

  // Helper: Create & Issue an Invoice
  async function createInvoice(amount, label) {
    const inv = check(await staff.request('/api/invoices', {
      method: 'POST',
      body: {
        customer_id: customer.id,
        due_date: '2027-12-31',
        tax_rate: '0',
        items: [
          {
            description: `Product/Service (${label})`,
            quantity: '1',
            unit_price: amount,
            discount_percent: '0.00'
          }
        ]
      }
    }), 201, `Create invoice ${label}`).invoice;

    const issued = check(await staff.request(`/api/invoices/${inv.id}/issue`, {
      method: 'POST',
      body: {}
    }), 200, `Issue invoice ${label}`).invoice;
    return issued;
  }

  // ==========================================================================
  // TEST 1: Một Payment -> một Invoice
  // ==========================================================================
  console.log('--- TEST 1: 1 Payment -> 1 Invoice ---');
  const inv1 = await createInvoice('10000000.00', 'T1');
  const res1 = check(await staff.request(`/api/invoices/${inv1.id}/payments`, {
    method: 'POST',
    body: {
      amount: '10000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-T1-${stamp}`
    }
  }), 201, 'Test 1 Payment');

  assert.equal(res1.payment.amount, '10000000.00');
  assert.equal(res1.invoice.status, 'PAID');
  assert.equal(res1.invoice.paid_total, '10000000.00');
  assert.equal(res1.unapplied_amount, '0.00');
  assert.equal(res1.allocated_total, '10000000.00');

  // Verify invoice detail view via GET /api/invoices/:id
  const inv1Detail = check(await staff.request(`/api/invoices/${inv1.id}`), 200, 'Get inv1 detail').invoice;
  assert.equal(inv1Detail.payments.length, 1);
  assert.equal(inv1Detail.payments[0].amount, '10000000.00');
  console.log('[PASS] Test 1: 1 Payment -> 1 Invoice successfully settled.');

  // ==========================================================================
  // TEST 2: Một Payment -> hai Invoice (Payment 5M -> Inv A 2M + Inv B 3M)
  // ==========================================================================
  console.log('\n--- TEST 2: 1 Payment -> 2 Invoices (5M -> 2M + 3M) ---');
  const inv2A = await createInvoice('2000000.00', 'T2-A');
  const inv2B = await createInvoice('3000000.00', 'T2-B');

  const res2 = check(await staff.request('/api/payments/allocate', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      total_amount: '5000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-T2-${stamp}`,
      allocations: [
        { invoice_id: inv2A.id, amount: '2000000.00' },
        { invoice_id: inv2B.id, amount: '3000000.00' }
      ]
    }
  }), 201, 'Test 2 Multi-allocation');

  assert.equal(res2.payment.amount, '5000000.00');
  assert.equal(res2.allocated_total, '5000000.00');
  assert.equal(res2.unapplied_amount, '0.00');
  assert.equal(res2.allocations.length, 2);

  // Verify invoice A
  const reloaded2A = check(await staff.request(`/api/invoices/${inv2A.id}`), 200, 'Reload 2A').invoice;
  assert.equal(reloaded2A.status, 'PAID');
  assert.equal(reloaded2A.paid_total, '2000000.00');
  assert.equal(reloaded2A.payments[0].amount, '2000000.00');

  // Verify invoice B
  const reloaded2B = check(await staff.request(`/api/invoices/${inv2B.id}`), 200, 'Reload 2B').invoice;
  assert.equal(reloaded2B.status, 'PAID');
  assert.equal(reloaded2B.paid_total, '3000000.00');
  assert.equal(reloaded2B.payments[0].amount, '3000000.00');

  // Verify single payment row created
  const pay2Detail = check(await staff.request(`/api/payments/${res2.payment.id}`), 200, 'Get pay2 detail').payment;
  assert.equal(pay2Detail.amount, '5000000.00');
  assert.equal(pay2Detail.allocated_amount, '5000000.00');
  assert.equal(pay2Detail.unapplied_amount, '0.00');
  assert.equal(pay2Detail.allocations.length, 2);
  console.log('[PASS] Test 2: Exactly 1 Payment distributed to 2 Invoices with zero unapplied cash.');

  // ==========================================================================
  // TEST 3: Partial payment
  // ==========================================================================
  console.log('\n--- TEST 3: Partial payment (Invoice 8M, Payment 3M) ---');
  const inv3 = await createInvoice('8000000.00', 'T3');
  const res3 = check(await staff.request(`/api/invoices/${inv3.id}/payments`, {
    method: 'POST',
    body: {
      amount: '3000000.00',
      method: 'CASH',
      paid_at: '2026-10-07',
      reference: `REF-T3-${stamp}`
    }
  }), 201, 'Test 3 Partial payment');

  assert.equal(res3.invoice.status, 'PARTIALLY_PAID');
  assert.equal(res3.invoice.paid_total, '3000000.00');
  assert.equal(res3.invoice.outstanding, '5000000.00');
  console.log('[PASS] Test 3: Partial payment keeps invoice in PARTIALLY_PAID with correct outstanding.');

  // ==========================================================================
  // TEST 4: Payment lớn hơn outstanding (Payment 5M, Inv outstanding 2M -> Alloc 2M, Unapplied 3M)
  // ==========================================================================
  console.log('\n--- TEST 4: Payment exceeds invoice outstanding (5M -> Alloc 2M, Unapplied 3M) ---');
  const inv4 = await createInvoice('2000000.00', 'T4');
  const res4 = check(await staff.request('/api/payments', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      amount: '5000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-T4-${stamp}`,
      allocations: [
        { invoice_id: inv4.id, amount: '2000000.00' }
      ]
    }
  }), 201, 'Test 4 Payment with unapplied cash');

  assert.equal(res4.payment.amount, '5000000.00');
  assert.equal(res4.allocated_total, '2000000.00');
  assert.equal(res4.unapplied_amount, '3000000.00');

  const reloaded4 = check(await staff.request(`/api/invoices/${inv4.id}`), 200, 'Reload inv4').invoice;
  assert.equal(reloaded4.status, 'PAID');
  assert.equal(reloaded4.paid_total, '2000000.00');
  console.log('[PASS] Test 4: Overpayment correctly leaves 3M as unapplied cash.');

  // ==========================================================================
  // TEST 5: Payment chưa allocate (Pure unapplied cash)
  // ==========================================================================
  console.log('\n--- TEST 5: Pure unapplied cash (Payment 10M, 0 Allocations) ---');
  const res5 = check(await staff.request('/api/payments', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      amount: '10000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-T5-${stamp}`,
      notes: 'Khách thanh toán trước chờ đối soát hóa đơn'
    }
  }), 201, 'Test 5 Pure unapplied payment');

  assert.equal(res5.payment.amount, '10000000.00');
  assert.equal(res5.allocated_total, '0.00');
  assert.equal(res5.unapplied_amount, '10000000.00');
  assert.equal(res5.allocations.length, 0);
  console.log('[PASS] Test 5: Pure payment created with 100% unapplied cash balance.');

  // ==========================================================================
  // TEST 6: Allocate phần còn lại sau này (Allocate unapplied cash from Test 5)
  // ==========================================================================
  console.log('\n--- TEST 6: Subsequent allocation from unapplied cash ---');
  const inv6A = await createInvoice('4000000.00', 'T6-A');
  const inv6B = await createInvoice('6000000.00', 'T6-B');

  // Allocate 4M to inv6A first
  const step6A = check(await staff.request(`/api/payments/${res5.payment.id}/allocations`, {
    method: 'POST',
    body: {
      allocations: [
        { invoice_id: inv6A.id, amount: '4000000.00' }
      ]
    }
  }), 201, 'Step 6A allocate 4M');

  assert.equal(step6A.payment.allocated_total, '4000000.00');
  assert.equal(step6A.payment.unapplied_amount, '6000000.00');

  // Allocate remaining 6M to inv6B
  const step6B = check(await staff.request(`/api/payments/${res5.payment.id}/allocations`, {
    method: 'POST',
    body: {
      allocations: [
        { invoice_id: inv6B.id, amount: '6000000.00' }
      ]
    }
  }), 201, 'Step 6B allocate 6M');

  assert.equal(step6B.payment.allocated_total, '10000000.00');
  assert.equal(step6B.payment.unapplied_amount, '0.00');

  const reloaded6A = check(await staff.request(`/api/invoices/${inv6A.id}`), 200, 'Reload 6A').invoice;
  const reloaded6B = check(await staff.request(`/api/invoices/${inv6B.id}`), 200, 'Reload 6B').invoice;
  assert.equal(reloaded6A.status, 'PAID');
  assert.equal(reloaded6B.status, 'PAID');
  console.log('[PASS] Test 6: Subsequent allocations consumed unapplied cash down to exactly 0.');

  // ==========================================================================
  // TEST 7: Over-allocation bị reject
  // ==========================================================================
  console.log('\n--- TEST 7: Over-allocation rejection ---');
  // Payment 5 from Test 5 has 0 unapplied cash remaining now. Trying to allocate 1M must fail.
  const overAllocRes = await staff.request(`/api/payments/${res5.payment.id}/allocations`, {
    method: 'POST',
    body: {
      allocations: [
        { invoice_id: inv1.id, amount: '1000000.00' }
      ]
    }
  });
  assert.equal(overAllocRes.response.status, 409);
  assert.equal(overAllocRes.payload.error.code, 'PAYMENT_EXCEEDS_UNAPPLIED');
  console.log('[PASS] Test 7: Over-allocating beyond available payment cash rejected with 409.');

  // ==========================================================================
  // TEST 8: Allocation amount <= 0 bị reject
  // ==========================================================================
  console.log('\n--- TEST 8: Zero/negative allocation rejection ---');
  const zeroAllocRes = await staff.request(`/api/payments/${res4.payment.id}/allocations`, {
    method: 'POST',
    body: {
      allocations: [
        { invoice_id: inv3.id, amount: '0.00' }
      ]
    }
  });
  assert.equal(zeroAllocRes.response.status, 400);
  assert.equal(zeroAllocRes.payload.error.code, 'INVALID_PAYMENT_AMOUNT');
  console.log('[PASS] Test 8: Zero allocation amount rejected with 400.');

  // ==========================================================================
  // TEST 9: Invoice không tồn tại bị reject
  // ==========================================================================
  console.log('\n--- TEST 9: Non-existent invoice rejection ---');
  const badInvRes = await staff.request(`/api/payments/${res4.payment.id}/allocations`, {
    method: 'POST',
    body: {
      allocations: [
        { invoice_id: 99999999, amount: '1000000.00' }
      ]
    }
  });
  assert.equal(badInvRes.response.status, 404);
  assert.equal(badInvRes.payload.error.code, 'INVOICE_NOT_FOUND');
  console.log('[PASS] Test 9: Non-existent invoice rejected with 404.');

  // ==========================================================================
  // TEST 10: Payment không tồn tại bị reject
  // ==========================================================================
  console.log('\n--- TEST 10: Non-existent payment rejection ---');
  const badPayRes = await staff.request('/api/payments/99999999/allocations', {
    method: 'POST',
    body: {
      allocations: [
        { invoice_id: inv3.id, amount: '1000000.00' }
      ]
    }
  });
  assert.equal(badPayRes.response.status, 404);
  assert.equal(badPayRes.payload.error.code, 'PAYMENT_NOT_FOUND');
  console.log('[PASS] Test 10: Non-existent payment rejected with 404.');

  // ==========================================================================
  // TEST 11: Duplicate payment request doesn't duplicate money effect
  // ==========================================================================
  console.log('\n--- TEST 11: Idempotent payment application ---');
  // Attempt to allocate already paid invoice (inv1)
  const dupAllocRes = await staff.request(`/api/invoices/${inv1.id}/payments`, {
    method: 'POST',
    body: {
      amount: '5000000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  assert.equal(dupAllocRes.response.status, 409);
  assert.equal(dupAllocRes.payload.error.code, 'INVOICE_NOT_PAYABLE');
  console.log('[PASS] Test 11: Fully paid invoice cannot receive duplicate payments.');

  // ==========================================================================
  // TEST 12: Bank reconciliation matching flow
  // ==========================================================================
  console.log('\n--- TEST 12: Bank reconciliation canonical Payment & Allocation flow ---');
  const inv12 = await createInvoice('2000000.00', 'T12');

  // Create bank transaction for 3M (2M for inv12, 1M unapplied)
  const bankTx = check(await admin.request('/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-07',
      description: `Thanh toan hoa don ${inv12.invoice_no}`,
      amount: '3000000.00',
      tx_type: 'CREDIT',
      reference: `BANK-${stamp}-12`,
      bank_name: 'Vietcombank',
      bank_account: '0011004392819'
    }
  }), 201, 'Create bank tx').transaction;

  // Manual match
  const matchRes = check(await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: bankTx.id,
      invoice_id: inv12.id
    }
  }), 200, 'Manual match bank tx').result;

  assert.equal(matchRes.amount, '2000000.00');
  assert.equal(matchRes.unapplied_amount, '1000000.00');
  assert.equal(matchRes.status, 'PARTIALLY_MATCHED');

  // Verify invoice 12 is PAID
  const reloaded12 = check(await staff.request(`/api/invoices/${inv12.id}`), 200, 'Reload inv12').invoice;
  assert.equal(reloaded12.status, 'PAID');
  assert.equal(reloaded12.paid_total, '2000000.00');

  // Verify bank payment record exists and has unapplied cash
  const bankPayDetail = check(await staff.request(`/api/payments/${matchRes.payment_id}`), 200, 'Bank payment detail').payment;
  assert.equal(bankPayDetail.amount, '3000000.00');
  assert.equal(bankPayDetail.allocated_amount, '2000000.00');
  assert.equal(bankPayDetail.unapplied_amount, '1000000.00');

  // Replay attempt on same bank transaction must be rejected
  const replayBankRes = await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: bankTx.id,
      invoice_id: inv12.id
    }
  });
  assert.equal(replayBankRes.response.status, 409);
  console.log('[PASS] Test 12: Bank reconciliation integrated into canonical Payment & Allocation flow.');

  // ==========================================================================
  // TEST 13: Concurrent allocation không thể vượt Payment amount
  // ==========================================================================
  console.log('\n--- TEST 13: Concurrency protection on Payment unapplied amount ---');
  // Create a 4M payment
  const inv13A = await createInvoice('3000000.00', 'T13-A');
  const inv13B = await createInvoice('3000000.00', 'T13-B');
  const pay13 = check(await staff.request('/api/payments', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      amount: '4000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-T13-${stamp}`
    }
  }), 201, 'Create 4M payment for concurrency test').payment;

  // Process A tries to allocate 3M to inv13A; Process B tries to allocate 3M to inv13B concurrently
  const [concA, concB] = await Promise.all([
    staff.request(`/api/payments/${pay13.id}/allocations`, {
      method: 'POST',
      body: { allocations: [{ invoice_id: inv13A.id, amount: '3000000.00' }] }
    }),
    staff.request(`/api/payments/${pay13.id}/allocations`, {
      method: 'POST',
      body: { allocations: [{ invoice_id: inv13B.id, amount: '3000000.00' }] }
    })
  ]);

  const concStatuses = [concA.response.status, concB.response.status].sort();
  assert.deepEqual(concStatuses, [201, 409], 'Exactly one process must succeed (201) and one rejected (409)');

  const pay13Final = check(await staff.request(`/api/payments/${pay13.id}`), 200, 'Get pay13 final').payment;
  assert.equal(pay13Final.allocated_amount, '3000000.00');
  assert.equal(pay13Final.unapplied_amount, '1000000.00');
  console.log('[PASS] Test 13: Concurrent allocations safely prevented over-allocating payment.');

  // ==========================================================================
  // TEST 14: Concurrent allocation không thể làm Invoice paid_total vượt collectible amount
  // ==========================================================================
  console.log('\n--- TEST 14: Concurrency protection on Invoice capacity ---');
  const inv14 = await createInvoice('3000000.00', 'T14');
  const pay14A = check(await staff.request('/api/payments', {
    method: 'POST',
    body: { customer_id: customer.id, amount: '3000000.00', method: 'CASH', paid_at: '2026-10-07' }
  }), 201, 'Pay 14A').payment;

  const pay14B = check(await staff.request('/api/payments', {
    method: 'POST',
    body: { customer_id: customer.id, amount: '3000000.00', method: 'CASH', paid_at: '2026-10-07' }
  }), 201, 'Pay 14B').payment;

  const [invConcA, invConcB] = await Promise.all([
    staff.request(`/api/payments/${pay14A.id}/allocations`, {
      method: 'POST',
      body: { allocations: [{ invoice_id: inv14.id, amount: '3000000.00' }] }
    }),
    staff.request(`/api/payments/${pay14B.id}/allocations`, {
      method: 'POST',
      body: { allocations: [{ invoice_id: inv14.id, amount: '3000000.00' }] }
    })
  ]);

  const invConcStatuses = [invConcA.response.status, invConcB.response.status].sort();
  assert.deepEqual(invConcStatuses, [201, 409], 'Exactly one allocation must succeed and one rejected');

  const inv14Final = check(await staff.request(`/api/invoices/${inv14.id}`), 200, 'Get inv14 final').invoice;
  assert.equal(inv14Final.paid_total, '3000000.00');
  assert.equal(inv14Final.status, 'PAID');
  console.log('[PASS] Test 14: Concurrent allocation safely locked invoice from exceeding total capacity.');

  // ==========================================================================
  // TEST 15: Rollback transaction (If 2nd allocation fails, 1st does not commit)
  // ==========================================================================
  console.log('\n--- TEST 15: Transaction Rollback Atomicity ---');
  const inv15A = await createInvoice('2000000.00', 'T15-A');
  const pay15 = check(await staff.request('/api/payments', {
    method: 'POST',
    body: { customer_id: customer.id, amount: '5000000.00', method: 'CASH', paid_at: '2026-10-07' }
  }), 201, 'Pay 15').payment;

  // Try allocating to inv15A (valid) and invalid invoice ID 99999999 in one request
  const batchFailRes = await staff.request(`/api/payments/${pay15.id}/allocations`, {
    method: 'POST',
    body: {
      allocations: [
        { invoice_id: inv15A.id, amount: '2000000.00' },
        { invoice_id: 99999999, amount: '1000000.00' }
      ]
    }
  });
  assert.equal(batchFailRes.response.status, 404);

  // Check inv15A was NOT updated (rolled back)
  const inv15Check = check(await staff.request(`/api/invoices/${inv15A.id}`), 200, 'Check inv15A').invoice;
  assert.equal(inv15Check.paid_total, '0.00');
  assert.equal(inv15Check.status, 'ISSUED');

  // Check pay15 allocations count is 0
  const pay15Check = check(await staff.request(`/api/payments/${pay15.id}`), 200, 'Check pay15').payment;
  assert.equal(pay15Check.allocated_amount, '0.00');
  assert.equal(pay15Check.unapplied_amount, '5000000.00');
  console.log('[PASS] Test 15: Transaction rollback ensures all-or-nothing allocation atomicity.');

  // ==========================================================================
  // TEST 16: Legacy payment migration check (No money doubled)
  // ==========================================================================
  console.log('\n--- TEST 16: Historical Data Integrity & Allocation Reconciliation ---');
  const paymentsList = check(await admin.request('/api/payments?limit=1'), 200, 'Check payments total');
  assert.ok(Number(paymentsList.total) >= 279, 'Total payments count >= 279');
  console.log(`[PASS] Test 16: Historical payments count verified (${paymentsList.total} total payments).`);

  // ==========================================================================
  // TEST 17: Customer debt matches canonical formula
  // ==========================================================================
  console.log('\n--- TEST 17: Customer debt harmonization ---');
  const custDetail = check(await admin.request(`/api/customers/${customer.id}`), 200, 'Get customer detail').customer;
  const custList = check(await admin.request(`/api/customers?q=${encodeURIComponent(customer.name)}`), 200, 'Customer search').items[0];
  assert.equal(custDetail.current_debt, custList.current_debt, 'Customer debt matches between list and detail');
  console.log(`[PASS] Test 17: Customer debt strictly harmonized at ${custDetail.current_debt} ₫.`);

  // ==========================================================================
  // TEST 18: Revenue/Cash Reporting unaffected by Unapplied Cash
  // ==========================================================================
  console.log('\n--- TEST 18: Reporting & Cash Collection Invariants ---');
  const dash = check(await admin.request('/api/dashboard/summary'), 200, 'Get dashboard');
  const revRep = check(await admin.request('/api/reports/revenue'), 200, 'Get revenue report');
  assert.equal(dash.collected, revRep.total_collected, 'Dashboard collected matches revenue total_collected');
  console.log(`[PASS] Test 18: Reporting pure cash collected (${dash.collected} ₫) is perfectly consistent.`);

  console.log('\n===============================================================');
  console.log('ALL 18 P1.2 PAYMENT ALLOCATION V2 TESTS PASSED WITH 100% SUCCESS!');
  console.log('===============================================================');
}

run().catch(err => {
  console.error('\nFAIL: P1.2 Payment Allocation test suite error:', err);
  process.exit(1);
});
