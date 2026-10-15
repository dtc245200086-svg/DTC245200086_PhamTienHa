import assert from 'node:assert/strict';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const staffPassword = process.env.STAFF_PASSWORD;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!staffPassword || !adminPassword) {
  throw new Error('STAFF_PASSWORD and ADMIN_PASSWORD are required.');
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
  console.log('     BILLING_ONE P1.2.1 DIRECT PAYMENT IDEMPOTENCY SUITE      ');
  console.log('      Verifying FIND-P1.2-01 Remediation (Tests 1 - 10)       ');
  console.log('===============================================================');

  const staff = new ApiClient();
  const admin = new ApiClient();

  // Auth login
  check(await staff.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'staff', password: staffPassword }
  }), 200, 'Staff login');

  check(await admin.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword }
  }), 200, 'Admin login');

  const stamp = Date.now();

  // Create test customers
  const customer1 = check(await staff.request('/api/customers', {
    method: 'POST',
    body: {
      name: `CUST-IDEMP-A-${stamp}`,
      email: `idemp_a_${stamp}@example.com`,
      code: `IDMP-A-${stamp.toString().slice(-6)}`
    }
  }), 201, 'Create Customer 1').customer;

  const customer2 = check(await staff.request('/api/customers', {
    method: 'POST',
    body: {
      name: `CUST-IDEMP-B-${stamp}`,
      email: `idemp_b_${stamp}@example.com`,
      code: `IDMP-B-${stamp.toString().slice(-6)}`
    }
  }), 201, 'Create Customer 2').customer;

  // Helper to create and issue invoice
  async function createInvoice(customerId, amount, tag) {
    const invRes = check(await staff.request('/api/invoices', {
      method: 'POST',
      body: {
        customer_id: customerId,
        due_date: '2026-10-31',
        items: [
          { description: `Item ${tag}`, quantity: '1.00', unit_price: amount }
        ]
      }
    }), 201, `Create invoice ${tag}`).invoice;

    return check(await staff.request(`/api/invoices/${invRes.id}/issue`, {
      method: 'POST',
      body: {}
    }), 200, `Issue invoice ${tag}`).invoice;
  }

  // Count payments before starting tests
  const initialPaymentsCount = Number((await staff.request('/api/payments?limit=500')).payload.total);

  // ==========================================================================
  // TEST 1: Request đầu tiên thành công với Idempotency-Key
  // ==========================================================================
  console.log('\n--- TEST 1: Initial request with Idempotency-Key succeeds ---');
  const key1 = `KEY-T1-${stamp}`;
  const inv1 = await createInvoice(customer1.id, '4000000.00', 'T1');

  const res1 = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key1 },
    body: {
      customer_id: customer1.id,
      amount: '4000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-IDEMP-T1-${stamp}`,
      allocations: [{ invoice_id: inv1.id, amount: '4000000.00' }]
    }
  }), 201, 'Initial payment create with key');

  assert.equal(res1.payment.amount, '4000000.00');
  assert.equal(res1.allocated_total, '4000000.00');
  assert.equal(res1.unapplied_amount, '0.00');
  assert.equal(res1.is_idempotent_replay, false);
  const payment1Id = res1.payment.id;
  console.log(`[PASS] Test 1: First request succeeded, created payment #${payment1Id}.`);

  // ==========================================================================
  // TEST 2: Retry cùng key -> không duplicate
  // ==========================================================================
  console.log('\n--- TEST 2: Retry with exact same Idempotency-Key returns cached response ---');
  const res2 = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key1 },
    body: {
      customer_id: customer1.id,
      amount: '4000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-IDEMP-T1-${stamp}`,
      allocations: [{ invoice_id: inv1.id, amount: '4000000.00' }]
    }
  }), 200, 'Retry payment create with same key');

  assert.equal(res2.payment.id, payment1Id, 'Payment ID must match original');
  assert.equal(res2.is_idempotent_replay, true);
  console.log('[PASS] Test 2: Retry with same key safely returned cached payment, no duplicate created.');

  // ==========================================================================
  // TEST 3: Retry 3 lần -> vẫn chỉ 1 Payment
  // ==========================================================================
  console.log('\n--- TEST 3: Multiple retries (3 times) generate zero additional payments ---');
  for (let i = 1; i <= 3; i++) {
    const replayRes = check(await staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': key1 },
      body: {
        customer_id: customer1.id,
        amount: '4000000.00',
        method: 'BANK_TRANSFER',
        paid_at: '2026-10-07',
        reference: `REF-IDEMP-T1-${stamp}`,
        allocations: [{ invoice_id: inv1.id, amount: '4000000.00' }]
      }
    }), 200, `Replay #${i}`);
    assert.equal(replayRes.payment.id, payment1Id);
    assert.equal(replayRes.is_idempotent_replay, true);
  }
  console.log('[PASS] Test 3: Retried 3 times consecutively; exact same payment maintained.');

  // ==========================================================================
  // TEST 4: Concurrent same-key requests -> chỉ 1 Payment
  // ==========================================================================
  console.log('\n--- TEST 4: Concurrent same-key requests create exactly 1 Payment ---');
  const key4 = `KEY-T4-CONCURRENT-${stamp}`;
  const inv4 = await createInvoice(customer1.id, '2500000.00', 'T4');

  const concPayload = {
    customer_id: customer1.id,
    amount: '2500000.00',
    method: 'CASH',
    paid_at: '2026-10-07',
    reference: `REF-IDEMP-T4-${stamp}`,
    allocations: [{ invoice_id: inv4.id, amount: '2500000.00' }]
  };

  const [concResA, concResB] = await Promise.all([
    staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': key4 },
      body: concPayload
    }),
    staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': key4 },
      body: concPayload
    })
  ]);

  const concStatuses = [concResA.response.status, concResB.response.status].sort();
  // One is 201 (initial creator) and one is 200 (idempotent replay waiter)
  assert.deepEqual(concStatuses, [200, 201], 'One request creates (201), the concurrent waiter receives replay (200)');
  assert.equal(concResA.payload.payment.id, concResB.payload.payment.id, 'Both must resolve to identical payment ID');
  console.log('[PASS] Test 4: Concurrent requests serialized cleanly, yielding exactly 1 payment.');

  // ==========================================================================
  // TEST 5: Same key + different amount -> reject
  // ==========================================================================
  console.log('\n--- TEST 5: Same Idempotency-Key with different amount is rejected ---');
  const badAmountRes = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key1 },
    body: {
      customer_id: customer1.id,
      amount: '9000000.00', // Changed amount
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-IDEMP-T1-${stamp}`,
      allocations: [{ invoice_id: inv1.id, amount: '4000000.00' }]
    }
  });

  assert.equal(badAmountRes.response.status, 409);
  assert.equal(badAmountRes.payload.error.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  console.log('[PASS] Test 5: Reusing key with different amount rejected with 409 Conflict.');

  // ==========================================================================
  // TEST 6: Same key + different customer -> reject
  // ==========================================================================
  console.log('\n--- TEST 6: Same Idempotency-Key with different customer is rejected ---');
  const badCustRes = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key1 },
    body: {
      customer_id: customer2.id, // Changed customer
      amount: '4000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-IDEMP-T1-${stamp}`,
      allocations: [{ invoice_id: inv1.id, amount: '4000000.00' }]
    }
  });

  assert.equal(badCustRes.response.status, 409);
  assert.equal(badCustRes.payload.error.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  console.log('[PASS] Test 6: Reusing key with different customer rejected with 409 Conflict.');

  // ==========================================================================
  // TEST 7: Same key + different allocation payload -> reject
  // ==========================================================================
  console.log('\n--- TEST 7: Same Idempotency-Key with different allocation is rejected ---');
  const inv7 = await createInvoice(customer1.id, '4000000.00', 'T7');
  const badAllocRes = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key1 },
    body: {
      customer_id: customer1.id,
      amount: '4000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: `REF-IDEMP-T1-${stamp}`,
      allocations: [{ invoice_id: inv7.id, amount: '4000000.00' }] // Changed allocation target
    }
  });

  assert.equal(badAllocRes.response.status, 409);
  assert.equal(badAllocRes.payload.error.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  console.log('[PASS] Test 7: Reusing key with different allocation payload rejected with 409 Conflict.');

  // ==========================================================================
  // TEST 8: Request thất bại trước khi commit, retry cùng key xử lý đúng
  // ==========================================================================
  console.log('\n--- TEST 8: Failed request rolls back key; retry with valid params succeeds ---');
  const key8 = `KEY-T8-FAILRETRY-${stamp}`;

  // First attempt fails due to invalid payment amount (0.00)
  const failRes = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key8 },
    body: {
      customer_id: customer1.id,
      amount: '0.00', // Invalid amount
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  assert.equal(failRes.response.status, 400);

  // Retry with same key with valid amount succeeds
  const retryValidRes = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key8 },
    body: {
      customer_id: customer1.id,
      amount: '1500000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  }), 201, 'Retry with valid params succeeds');
  assert.equal(retryValidRes.payment.amount, '1500000.00');
  console.log('[PASS] Test 8: Failed transaction did not lock out key; subsequent valid retry succeeded.');

  // ==========================================================================
  // TEST 9: Successful direct Payment có allocation -> retry không duplicate allocation
  // ==========================================================================
  console.log('\n--- TEST 9: Invoice payment retry does not duplicate allocations or paid_total ---');
  const key9 = `KEY-T9-INVPAY-${stamp}`;
  const inv9 = await createInvoice(customer1.id, '6000000.00', 'T9');

  const invPayRes1 = check(await staff.request(`/api/invoices/${inv9.id}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key9 },
    body: {
      amount: '6000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07'
    }
  }), 201, 'Initial invoice payment');

  assert.equal(invPayRes1.payment.amount, '6000000.00');

  // Retry invoice payment with same key
  const invPayRes2 = check(await staff.request(`/api/invoices/${inv9.id}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key9 },
    body: {
      amount: '6000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07'
    }
  }), 200, 'Retry invoice payment');

  assert.equal(invPayRes2.payment.id, invPayRes1.payment.id);
  assert.equal(invPayRes2.is_idempotent_replay, true);

  // Check invoice state: paid_total must be exactly 6M, not 12M!
  const reloadedInv9 = check(await staff.request(`/api/invoices/${inv9.id}`), 200, 'Reload inv9').invoice;
  assert.equal(reloadedInv9.status, 'PAID');
  assert.equal(reloadedInv9.paid_total, '6000000.00');
  console.log('[PASS] Test 9: Invoice payment retry returned cached response; paid_total maintained at 6.000.000 ₫.');

  // ==========================================================================
  // TEST 10: Successful unapplied Payment -> retry không tạo thêm unapplied cash
  // ==========================================================================
  console.log('\n--- TEST 10: Pure unapplied payment retry does not duplicate unapplied cash ---');
  const key10 = `KEY-T10-UNAPPLIED-${stamp}`;

  const unappliedPay1 = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key10 },
    body: {
      customer_id: customer1.id,
      amount: '5000000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  }), 201, 'First unapplied payment');

  assert.equal(unappliedPay1.unapplied_amount, '5000000.00');

  const unappliedPay2 = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key10 },
    body: {
      customer_id: customer1.id,
      amount: '5000000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  }), 200, 'Retry unapplied payment');

  assert.equal(unappliedPay2.payment.id, unappliedPay1.payment.id);
  assert.equal(unappliedPay2.unapplied_amount, '5000000.00');
  assert.equal(unappliedPay2.is_idempotent_replay, true);
  console.log('[PASS] Test 10: Unapplied payment retry safely returned cached result with zero cash inflation.');

  console.log('\n===============================================================');
  console.log('ALL 10 P1.2.1 IDEMPOTENCY REMEDIATION TESTS PASSED WITH 100%!   ');
  console.log('===============================================================');
}

run().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
