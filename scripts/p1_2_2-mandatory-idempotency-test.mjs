import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

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

function queryDbAsRole(role, sql) {
  try {
    const singleLineSql = sql.replace(/\s+/g, ' ').trim();
    const cmd = `docker compose exec -T postgres psql -U ${role} -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
    const out = execSync(cmd, { encoding: 'utf8' }).trim();
    return { success: true, output: out };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
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
  console.log('===============================================================');
  console.log('  BILLING_ONE P1.2.2 MANDATORY IDEMPOTENCY & HARDENING SUITE   ');
  console.log('       Verifying FIND-P1.2.1-01 & FIND-P1.2.1-02 (16 Tests)    ');
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

  // Baseline data check
  const initialPaymentsCount = Number(queryDb('SELECT count(*) FROM public.payments;'));
  const initialAllocationsCount = Number(queryDb('SELECT count(*) FROM public.payment_allocations;'));
  const initialIdempKeysCount = Number(queryDb('SELECT count(*) FROM public.payment_idempotency_keys;'));
  console.log(`[BASELINE] Payments: ${initialPaymentsCount}, Allocations: ${initialAllocationsCount}, Idempotency Keys: ${initialIdempKeysCount}`);

  // Setup test customer and invoices
  const custRes = check(await staff.request('/api/customers', {
    method: 'POST',
    body: {
      name: `P1.2.2 Test Customer ${Date.now()}`,
      email: `p122_${Date.now()}@test.vn`,
      tax_code: `MST-P122-${Date.now().toString().slice(-8)}`,
      address: '123 Idempotency Way'
    }
  }), 201, 'Create test customer');
  const custId = custRes.customer.id;

  const inv1Res = check(await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: custId,
      due_date: '2026-11-01',
      items: [{ description: 'Test Service Item 1', quantity: '1', unit_price: '5000000.00' }]
    }
  }), 201, 'Create test invoice 1');
  const inv1 = inv1Res.invoice;
  await staff.request(`/api/invoices/${inv1.id}/issue`, { method: 'POST', body: {} });

  const inv2Res = check(await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: custId,
      due_date: '2026-11-01',
      items: [{ description: 'Test Service Item 2', quantity: '1', unit_price: '3000000.00' }]
    }
  }), 201, 'Create test invoice 2');
  const inv2 = inv2Res.invoice;
  await staff.request(`/api/invoices/${inv2.id}/issue`, { method: 'POST', body: {} });

  // -------------------------------------------------------------------------
  // TEST 1: No Idempotency-Key on POST /api/payments -> reject -> zero effect
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 1: No Idempotency-Key on POST /api/payments is rejected ---');
  const t1Res = await staff.request('/api/payments', {
    method: 'POST',
    body: {
      customer_id: custId,
      amount: '1000000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  check(t1Res, 400, 'Test 1 Reject Keyless Direct Payment');
  assert.equal(t1Res.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const paymentsAfterT1 = Number(queryDb('SELECT count(*) FROM public.payments;'));
  assert.equal(paymentsAfterT1, initialPaymentsCount, 'Zero financial effect: payments count must not increase');
  console.log('[PASS] Test 1: Keyless direct payment rejected with 400 IDEMPOTENCY_KEY_REQUIRED and zero DB mutation.');

  // -------------------------------------------------------------------------
  // TEST 2: No Idempotency-Key on invoice payment -> reject -> zero effect
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: No Idempotency-Key on invoice payment is rejected ---');
  const t2Res = await staff.request(`/api/invoices/${inv1.id}/payments`, {
    method: 'POST',
    body: {
      amount: '1000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07'
    }
  });
  check(t2Res, 400, 'Test 2 Reject Keyless Invoice Payment');
  assert.equal(t2Res.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const inv1Db = JSON.parse(queryDb(`SELECT json_build_object('paid_total', paid_total, 'status', status)::text FROM public.invoices WHERE id = ${inv1.id};`));
  assert.equal(Number(inv1Db.paid_total), 0, 'Zero financial effect: invoice paid_total must remain 0');
  assert.equal(inv1Db.status, 'ISSUED', 'Invoice status must remain ISSUED');
  console.log('[PASS] Test 2: Keyless invoice payment rejected with 400 IDEMPOTENCY_KEY_REQUIRED and zero invoice change.');

  // -------------------------------------------------------------------------
  // TEST 3: No Idempotency-Key on allocation mutation -> reject -> zero effect
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: No Idempotency-Key on allocation mutation is rejected ---');
  // First create a master unapplied payment with a valid key
  const unappliedKeySetup = `SETUP-UNAPPLIED-${Date.now()}`;
  const unappliedPay = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': unappliedKeySetup },
    body: {
      customer_id: custId,
      amount: '4000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-07',
      reference: 'SETUP-UNAPPLIED-CASH'
    }
  }), 201, 'Setup payment for allocation test');

  // Attempt to allocate without key on POST /api/payments/:id/allocations
  const t3ResA = await staff.request(`/api/payments/${unappliedPay.payment.id}/allocations`, {
    method: 'POST',
    body: {
      allocations: [{ invoice_id: inv1.id, amount: '1000000.00' }]
    }
  });
  check(t3ResA, 400, 'Test 3A Reject Keyless Allocation');
  assert.equal(t3ResA.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

  // Attempt to allocate without key on POST /api/payments/allocate
  const t3ResB = await staff.request('/api/payments/allocate', {
    method: 'POST',
    body: {
      customer_id: custId,
      amount: '2000000.00',
      method: 'CASH',
      paid_at: '2026-10-07',
      allocations: [{ invoice_id: inv2.id, amount: '2000000.00' }]
    }
  });
  check(t3ResB, 400, 'Test 3B Reject Keyless Multi-Allocation');
  assert.equal(t3ResB.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const unappliedCheck = queryDb(`SELECT (amount - coalesce((SELECT sum(allocated_amount) FROM payment_allocations WHERE payment_id = payments.id), 0))::text FROM payments WHERE id = ${unappliedPay.payment.id};`);
  assert.equal(Number(unappliedCheck), 4000000, 'Unapplied cash on payment must remain fully intact');
  console.log('[PASS] Test 3: Keyless allocation requests rejected with 400 IDEMPOTENCY_KEY_REQUIRED and zero allocation effect.');

  // -------------------------------------------------------------------------
  // TEST 4: Valid key + first request -> 201
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Valid key on first request succeeds with 201 ---');
  const validKey4 = `P122-TEST4-${Date.now()}`;
  const t4Payload = {
    customer_id: custId,
    amount: '2500000.00',
    method: 'BANK_TRANSFER',
    paid_at: '2026-10-07',
    reference: 'REF-TEST-4',
    allocations: [{ invoice_id: inv1.id, amount: '2500000.00' }]
  };
  const t4Res = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': validKey4 },
    body: t4Payload
  }), 201, 'Test 4 First request with key');
  assert.equal(t4Res.is_idempotent_replay, false);
  assert.ok(t4Res.payment.id, 'Payment ID must be returned');
  const pay4Id = t4Res.payment.id;
  console.log(`[PASS] Test 4: First request succeeded with 201, created payment #${pay4Id}.`);

  // -------------------------------------------------------------------------
  // TEST 5: Same key + same payload -> replay (200 cached response)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Same key + same payload returns cached response ---');
  const countBeforeT5 = Number(queryDb('SELECT count(*) FROM public.payments;'));
  const t5Res = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': validKey4 },
    body: t4Payload
  }), 200, 'Test 5 Idempotent replay');
  assert.equal(t5Res.is_idempotent_replay, true);
  assert.equal(t5Res.payment.id, pay4Id, 'Must return identical payment ID');
  const countAfterT5 = Number(queryDb('SELECT count(*) FROM public.payments;'));
  assert.equal(countAfterT5, countBeforeT5, 'Zero additional payments created in DB');
  console.log('[PASS] Test 5: Replay safely returned HTTP 200 cached response, exactly 1 payment preserved.');

  // -------------------------------------------------------------------------
  // TEST 6: Same key + different amount -> 409
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Same key + different amount rejected with 409 ---');
  const t6Res = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': validKey4 },
    body: {
      ...t4Payload,
      amount: '9999999.00'
    }
  });
  check(t6Res, 409, 'Test 6 Payload mismatch (amount)');
  assert.equal(t6Res.payload.error.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  console.log('[PASS] Test 6: Reusing key with different amount correctly rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.');

  // -------------------------------------------------------------------------
  // TEST 7: Same key + different customer -> 409
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Same key + different customer rejected with 409 ---');
  const t7Res = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': validKey4 },
    body: {
      ...t4Payload,
      customer_id: 999999
    }
  });
  check(t7Res, 409, 'Test 7 Payload mismatch (customer)');
  assert.equal(t7Res.payload.error.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  console.log('[PASS] Test 7: Reusing key with different customer correctly rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.');

  // -------------------------------------------------------------------------
  // TEST 8: Same key + different allocation -> 409
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 8: Same key + different allocation rejected with 409 ---');
  const t8Res = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': validKey4 },
    body: {
      ...t4Payload,
      allocations: [{ invoice_id: inv2.id, amount: '2500000.00' }]
    }
  });
  check(t8Res, 409, 'Test 8 Payload mismatch (allocations)');
  assert.equal(t8Res.payload.error.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  console.log('[PASS] Test 8: Reusing key with different allocation correctly rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.');

  // -------------------------------------------------------------------------
  // TEST 9: Concurrent same-key requests -> exactly 1 effect
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 9: Concurrent same-key requests yield exactly 1 payment ---');
  const concurrentKey = `P122-CONCURRENT-${Date.now()}`;
  const concurrentPayload = {
    customer_id: custId,
    amount: '1500000.00',
    method: 'CARD',
    paid_at: '2026-10-07',
    reference: 'CONCURRENT-RACE'
  };

  const countBeforeT9 = Number(queryDb('SELECT count(*) FROM public.payments;'));
  const concurrentPromises = [1, 2, 3, 4, 5].map(() =>
    staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': concurrentKey },
      body: concurrentPayload
    })
  );
  const concurrentResults = await Promise.all(concurrentPromises);
  const statuses = concurrentResults.map(r => r.response.status);
  const createdCount = statuses.filter(s => s === 201).length;
  const replayCount = statuses.filter(s => s === 200).length;
  console.log(`Concurrent statuses: ${JSON.stringify(statuses)} (201s: ${createdCount}, 200s: ${replayCount})`);

  assert.equal(createdCount, 1, 'Exactly one request must return HTTP 201 Created');
  assert.equal(replayCount, 4, 'Remaining 4 requests must return HTTP 200 Cached Replay');

  const countAfterT9 = Number(queryDb('SELECT count(*) FROM public.payments;'));
  assert.equal(countAfterT9, countBeforeT9 + 1, 'Exactly one payment row must be inserted into DB');
  console.log('[PASS] Test 9: 5 concurrent requests with identical key produced exactly 1 payment in DB.');

  // -------------------------------------------------------------------------
  // TEST 10: Failed request + same key retry -> valid retry succeeds
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 10: Failed transaction rolls back key; valid retry succeeds ---');
  const retryKey10 = `P122-FAIL-RETRY-${Date.now()}`;
  // Attempt payment on non-existent invoice -> 404
  const failRes = await staff.request('/api/invoices/99999999/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': retryKey10 },
    body: {
      amount: '500000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  check(failRes, 409, 'Failed payment on non-existent invoice');
  assert.equal(failRes.payload.error.code, 'REFERENCE_CONFLICT');

  // Verify key was NOT persisted in payment_idempotency_keys
  const keyExists = Number(queryDb(`SELECT count(*) FROM public.payment_idempotency_keys WHERE idempotency_key = '${retryKey10}';`));
  assert.equal(keyExists, 0, 'Key must not be persisted if transaction failed');

  // Now retry with SAME key on valid invoice
  const validRetryRes = check(await staff.request(`/api/invoices/${inv2.id}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': retryKey10 },
    body: {
      amount: '500000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  }), 201, 'Valid retry with same key');
  assert.equal(validRetryRes.is_idempotent_replay, false);
  console.log('[PASS] Test 10: Failed transaction rolled back key; retry with valid payload succeeded with 201.');

  // -------------------------------------------------------------------------
  // TEST 11: Successful request + 3 retries -> exactly 1 payment
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 11: Successful request + 3 retries yields exactly 1 payment ---');
  const key11 = `P122-RETRIES3-${Date.now()}`;
  const pay11Payload = {
    customer_id: custId,
    amount: '1200000.00',
    method: 'BANK_TRANSFER',
    paid_at: '2026-10-07',
    reference: 'RETRIES-3-CHECK'
  };
  const firstPay11 = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key11 },
    body: pay11Payload
  }), 201, 'Initial request');

  const countBeforeRetries = Number(queryDb('SELECT count(*) FROM public.payments;'));
  for (let i = 1; i <= 3; i++) {
    const retryRes = check(await staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': key11 },
      body: pay11Payload
    }), 200, `Retry ${i}`);
    assert.equal(retryRes.payment.id, firstPay11.payment.id);
    assert.equal(retryRes.is_idempotent_replay, true);
  }
  const countAfterRetries = Number(queryDb('SELECT count(*) FROM public.payments;'));
  assert.equal(countAfterRetries, countBeforeRetries, 'Retries must not create any new payment rows');
  console.log('[PASS] Test 11: 3 consecutive retries returned exact cached response with zero payment inflation.');

  // -------------------------------------------------------------------------
  // TEST 12: Unapplied cash + retries -> no cash inflation
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 12: Unapplied cash with retries does not inflate customer unapplied cash ---');
  const key12 = `P122-UNAPPLIED-${Date.now()}`;
  const unappliedAmount = 8000000;
  const unappliedPayload = {
    customer_id: custId,
    amount: `${unappliedAmount}.00`,
    method: 'BANK_TRANSFER',
    paid_at: '2026-10-07',
    reference: 'UNAPPLIED-NO-INFLATE'
  };

  const initialUnappliedTotal = Number(queryDb(`
    SELECT coalesce(sum(p.amount - coalesce((SELECT sum(allocated_amount) FROM payment_allocations WHERE payment_id = p.id), 0)), 0)
    FROM payments p WHERE p.customer_id = ${custId};
  `));

  const unapplied1 = check(await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key12 },
    body: unappliedPayload
  }), 201, 'Unapplied cash payment creation');
  assert.equal(Number(unapplied1.unapplied_amount), unappliedAmount);

  // Send 3 retries
  for (let i = 1; i <= 3; i++) {
    const unappliedRetry = check(await staff.request('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': key12 },
      body: unappliedPayload
    }), 200, `Unapplied cash retry ${i}`);
    assert.equal(Number(unappliedRetry.unapplied_amount), unappliedAmount);
  }

  const finalUnappliedTotal = Number(queryDb(`
    SELECT coalesce(sum(p.amount - coalesce((SELECT sum(allocated_amount) FROM payment_allocations WHERE payment_id = p.id), 0)), 0)
    FROM payments p WHERE p.customer_id = ${custId};
  `));
  assert.equal(finalUnappliedTotal, initialUnappliedTotal + unappliedAmount, 'Unapplied cash must increase by EXACTLY 1 payment amount');
  console.log('[PASS] Test 12: Unapplied cash retried 3 times; customer unapplied cash increased by exactly 1 payment amount.');

  // -------------------------------------------------------------------------
  // TEST 13: Invoice payment + retries -> no duplicate allocation
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 13: Invoice payment with retries does not duplicate allocation or paid_total ---');
  const key13 = `P122-INVPAY-${Date.now()}`;
  const inv3Res = check(await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: custId,
      due_date: '2026-11-01',
      items: [{ description: 'Test Item 3 for Retry', quantity: '1', unit_price: '2000000.00' }]
    }
  }), 201, 'Create test invoice 3');
  const inv3 = inv3Res.invoice;
  await staff.request(`/api/invoices/${inv3.id}/issue`, { method: 'POST', body: {} });

  const payInvPayload = {
    amount: '2000000.00',
    method: 'BANK_TRANSFER',
    paid_at: '2026-10-07',
    reference: 'INVOICE-SETTLE'
  };

  const invPay1 = check(await staff.request(`/api/invoices/${inv3.id}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key13 },
    body: payInvPayload
  }), 201, 'Invoice payment initial');
  assert.equal(invPay1.invoice.status, 'PAID');

  // Retry twice
  for (let i = 1; i <= 2; i++) {
    const invPayRetry = check(await staff.request(`/api/invoices/${inv3.id}/payments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key13 },
      body: payInvPayload
    }), 200, `Invoice payment retry ${i}`);
    assert.equal(invPayRetry.is_idempotent_replay, true);
    assert.equal(invPayRetry.invoice.status, 'PAID');
  }

  const inv3AllocCount = Number(queryDb(`SELECT count(*) FROM public.payment_allocations WHERE invoice_id = ${inv3.id};`));
  assert.equal(inv3AllocCount, 1, 'Exactly 1 allocation must exist for this invoice');
  const inv3PaidTotal = Number(queryDb(`SELECT paid_total FROM public.invoices WHERE id = ${inv3.id};`));
  assert.equal(inv3PaidTotal, 2000000, 'Invoice paid_total must equal exactly 2.000.000');
  console.log('[PASS] Test 13: Invoice payment retried twice; exactly 1 allocation and correct paid_total maintained.');

  // -------------------------------------------------------------------------
  // TEST 14: Bank replay regression -> deterministic key prevents duplicates
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 14: Bank replay regression -> deterministic key protects against double matching ---');
  // Create an unmatched bank transaction
  const insertTxSql = `
    INSERT INTO public.bank_transactions (bank_name, bank_account, tx_date, amount, tx_type, reference, description, status)
    VALUES ('VIETCOMBANK', '001100223344', '2026-10-07', 1000000.00, 'CREDIT', 'BANK-TX-P122-${Date.now()}', 'Thanh toan HD #${inv2.id}', 'UNMATCHED')
    RETURNING id;
  `;
  const rawTxOutput = queryDb(insertTxSql);
  const bankTxId = parseInt(rawTxOutput.split('\n')[0].trim(), 10);

  const matchRes = check(await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: bankTxId,
      invoice_id: inv2.id
    }
  }), 200, 'Bank transaction manual match');
  const matchPaymentId = matchRes.result ? matchRes.result.payment_id : matchRes.payment_id;
  assert.ok(matchPaymentId, 'Payment ID must be returned from match');

  // Verify the deterministic key was stored in payment_idempotency_keys
  const bankKeyInDb = queryDb(`SELECT idempotency_key FROM public.payment_idempotency_keys WHERE idempotency_key = 'BANK-TX-MATCH-${bankTxId}';`);
  assert.equal(bankKeyInDb, `BANK-TX-MATCH-${bankTxId}`, 'Deterministic bank match idempotency key must be persisted');

  // Attempting to match again must be blocked (transaction already matched)
  const rematchRes = await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: Number(bankTxId),
      invoice_id: inv2.id
    }
  });
  check(rematchRes, 409, 'Re-matching already matched bank transaction');
  console.log('[PASS] Test 14: Bank transaction matching generated deterministic idempotency key and prevented replay.');

  // -------------------------------------------------------------------------
  // TEST 15: Verify payment_idempotency_keys cannot be UPDATEd by billing_app
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 15: billing_app role CANNOT UPDATE payment_idempotency_keys ---');
  const updateResult = queryDbAsRole('billing_app', 'UPDATE public.payment_idempotency_keys SET response_status = 200 WHERE id = 1;');
  assert.equal(updateResult.success, false, 'UPDATE as billing_app must fail');
  assert.match(updateResult.error, /permission denied for table payment_idempotency_keys/i);
  console.log('[PASS] Test 15: UPDATE on payment_idempotency_keys correctly denied for role billing_app.');

  // -------------------------------------------------------------------------
  // TEST 16: Verify payment_idempotency_keys cannot be DELETEd by billing_app
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 16: billing_app role CANNOT DELETE from payment_idempotency_keys ---');
  const deleteResult = queryDbAsRole('billing_app', 'DELETE FROM public.payment_idempotency_keys WHERE id = 1;');
  assert.equal(deleteResult.success, false, 'DELETE as billing_app must fail');
  assert.match(deleteResult.error, /permission denied for table payment_idempotency_keys/i);
  console.log('[PASS] Test 16: DELETE on payment_idempotency_keys correctly denied for role billing_app.');

  // -------------------------------------------------------------------------
  // BONUS CHECKS: Conflicting keys, empty key, key length, error ordering
  // -------------------------------------------------------------------------
  console.log('\n--- BONUS CHECKS: Source conflicts, empty key, max length, error ordering ---');

  // Bonus 1: Conflicting keys between header and body
  const conflictRes = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'KEY-HEADER-A' },
    body: {
      idempotency_key: 'KEY-BODY-B',
      customer_id: custId,
      amount: '100000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  check(conflictRes, 400, 'Conflicting keys between header and body');
  assert.equal(conflictRes.payload.error.code, 'CONFLICTING_IDEMPOTENCY_KEYS');
  console.log('[PASS] Bonus 1: Conflicting keys between header and body rejected with 400 CONFLICTING_IDEMPOTENCY_KEYS.');

  // Bonus 2: Empty string key
  const emptyKeyRes = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': '   ' },
    body: {
      customer_id: custId,
      amount: '100000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  check(emptyKeyRes, 400, 'Empty string idempotency key');
  assert.equal(emptyKeyRes.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  console.log('[PASS] Bonus 2: Whitespace-only key rejected with 400 IDEMPOTENCY_KEY_REQUIRED.');

  // Bonus 3: Excessive key length (> 255 chars)
  const longKey = 'A'.repeat(256);
  const longKeyRes = await staff.request('/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': longKey },
    body: {
      customer_id: custId,
      amount: '100000.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  check(longKeyRes, 400, 'Excessive key length');
  assert.equal(longKeyRes.payload.error.code, 'INVALID_IDEMPOTENCY_KEY');
  console.log('[PASS] Bonus 3: Excessive key length rejected with 400 INVALID_IDEMPOTENCY_KEY.');

  // Bonus 4: Error ordering: Missing key with amount = 0
  const orderRes = await staff.request('/api/payments', {
    method: 'POST',
    body: {
      customer_id: custId,
      amount: '0.00',
      method: 'CASH',
      paid_at: '2026-10-07'
    }
  });
  check(orderRes, 400, 'Error ordering: missing key with amount = 0');
  assert.equal(orderRes.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency key presence must be evaluated before amount check');
  console.log('[PASS] Bonus 4: Error ordering validated: IDEMPOTENCY_KEY_REQUIRED is checked before payload attributes.');

  console.log('\n===============================================================');
  console.log('  ALL 16 P1.2.2 MANDATORY IDEMPOTENCY & HARDENING TESTS PASSED!');
  console.log('===============================================================');
}

run().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
