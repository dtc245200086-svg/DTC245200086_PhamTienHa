import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const baseUrl = process.env.CP2_BASE_URL || 'http://127.0.0.1:8000';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;
const persistenceName = process.env.CP2_PERSISTENCE_NAME;
const secureCookieExpected = process.env.CP2_EXPECT_SECURE_COOKIE === 'true';
const publicHealthBlocked = process.env.CP2_EXPECT_PUBLIC_HEALTH_BLOCKED === 'true';

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD must be set in the test environment.');
}

class ApiClient {
  constructor() {
    this.cookie = '';
    this.setCookie = '';
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
      this.setCookie = setCookie;
      this.cookie = setCookie.split(';', 1)[0];
    }
    const payload = response.status === 204 ? null : await response.json();
    return { response, payload };
  }
}

function checkStatus(result, expected, label) {
  assert.equal(result.response.status, expected, `${label}: expected HTTP ${expected}, received ${result.response.status}: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function login(client, username, password, role) {
  const payload = checkStatus(await client.request('/api/auth/login', {
    method: 'POST', body: { username, password }
  }), 200, `${username} login`);
  assert.equal(payload.user.username, username);
  assert.equal(payload.user.role, role);
  assert.equal(Object.hasOwn(payload.user, 'password_hash'), false);
  assert.equal(Object.hasOwn(payload.user, 'password'), false);
  assert.equal(JSON.stringify(payload).includes(password), false);
  assert.match(client.setCookie, /^billing\.sid=/);
  assert.match(client.setCookie, /;\s*HttpOnly/i);
  assert.match(client.setCookie, /;\s*SameSite=Strict/i);
  assert.match(client.setCookie, /;\s*Path=\//i);
  const expires = client.setCookie.match(/;\s*Expires=([^;]+)/i);
  assert.ok(expires, 'session cookie must include an expiration');
  const expiresAt = Date.parse(expires[1]);
  const remainingMs = expiresAt - Date.now();
  assert.ok(remainingMs > 7.9 * 60 * 60 * 1000 && remainingMs <= 8 * 60 * 60 * 1000, 'session cookie must expire in eight hours');
  if (secureCookieExpected) {
    assert.match(client.setCookie, /;\s*Secure(?:;|$)/i);
  } else {
    assert.doesNotMatch(client.setCookie, /;\s*Secure(?:;|$)/i);
  }
}

async function persistenceOnly() {
  if (!persistenceName) throw new Error('CP2_PERSISTENCE_NAME is required for persistence-only mode.');
  const client = new ApiClient();
  await login(client, 'admin', adminPassword, 'admin');
  const result = checkStatus(await client.request(`/api/customers?limit=100&q=${encodeURIComponent(persistenceName)}`), 200, 'persistence customer query');
  assert.ok(result.items.some((customer) => customer.name === persistenceName), 'customer created before restart must still exist');
  console.log('CP2_PERSISTENCE_PASS');
}

async function run() {
  if (process.argv.includes('--persistence-only')) return persistenceOnly();
  const checks = [];
  const admin = new ApiClient();
  const staff = new ApiClient();

  const anonymous = new ApiClient();
  const unauthenticated = checkStatus(await anonymous.request('/api/customers'), 401, 'protected route without login');
  assert.equal(unauthenticated.error.code, 'UNAUTHENTICATED');
  const failedLogin = checkStatus(await anonymous.request('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'not-the-admin-password' }
  }), 401, 'invalid login');
  assert.equal(failedLogin.error.code, 'INVALID_CREDENTIALS');
  assert.equal(failedLogin.error.message, 'Invalid username or password.');
  assert.equal(Object.hasOwn(failedLogin.error, 'password_hash'), false);
  checks.push('unauthenticated access and generic failed login');

  const healthResponse = await fetch(`${baseUrl}/health`);
  if (publicHealthBlocked) {
    assert.equal(healthResponse.status, 404, 'public /health must be hidden behind Nginx');
    checks.push('public health endpoint blocked');
  } else {
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.status, 'ok');
    assert.equal(health.db, 'ok');
    checks.push('health');
  }

  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Billing/);
  checks.push('static frontend');

  await login(admin, 'admin', adminPassword, 'admin');
  const me = checkStatus(await admin.request('/api/auth/me'), 200, 'admin session');
  assert.equal(me.username, 'admin');
  checks.push('admin login and persistent session');

  const stamp = Date.now();
  const probeCustomer = `CP2 CRUD ${stamp}`;
  const createdCustomer = checkStatus(await admin.request('/api/customers', {
    method: 'POST',
    body: { name: probeCustomer, email: `cp2-${stamp}@example.test`, phone: '0900000000', address: 'Test address', tax_code: 'CP2TEST' }
  }), 201, 'customer create').customer;
  assert.equal(createdCustomer.name, probeCustomer);
  checkStatus(await admin.request(`/api/customers/${createdCustomer.id}`), 200, 'customer read');
  const updatedCustomer = checkStatus(await admin.request(`/api/customers/${createdCustomer.id}`, {
    method: 'PUT', body: { name: `${probeCustomer} updated`, email: `cp2-${stamp}@example.test`, phone: '0900000001', address: 'Updated address', tax_code: 'CP2TEST' }
  }), 200, 'customer update').customer;
  assert.equal(updatedCustomer.phone, '0900000001');
  const search = checkStatus(await admin.request(`/api/customers?limit=100&q=${encodeURIComponent(probeCustomer)}`), 200, 'customer search');
  assert.ok(search.items.some((customer) => customer.id === createdCustomer.id));
  checks.push('customer create/read/update/list/search');

  await login(staff, 'staff', staffPassword, 'staff');
  checkStatus(await staff.request(`/api/customers/${createdCustomer.id}`, { method: 'DELETE' }), 403, 'staff customer delete denied');
  checkStatus(await admin.request(`/api/customers/${createdCustomer.id}`, { method: 'DELETE' }), 204, 'admin customer delete');
  checks.push('role-based customer delete');

  const persistenceCustomer = persistenceName || `CP2 persistence ${stamp}`;
  const customer = checkStatus(await admin.request('/api/customers', {
    method: 'POST',
    body: { name: persistenceCustomer, email: `persist-${stamp}@example.test`, phone: null, address: null, tax_code: null }
  }), 201, 'persistence customer create').customer;

  const emptyDraft = checkStatus(await admin.request('/api/invoices', {
    method: 'POST', body: { customer_id: customer.id, due_date: '2027-01-01', tax_rate: '0.10', items: [] }
  }), 201, 'empty draft create').invoice;
  assert.equal(emptyDraft.status, 'DRAFT');
  assert.equal(emptyDraft.invoice_no, null);
  const emptyIssue = checkStatus(await admin.request(`/api/invoices/${emptyDraft.id}/issue`, { method: 'POST', body: {} }), 409, 'issue without items denied');
  assert.equal(emptyIssue.error.code, 'INVOICE_REQUIRES_ITEM');

  const zeroDraft = checkStatus(await admin.request('/api/invoices', {
    method: 'POST', body: { customer_id: customer.id, due_date: '2027-01-01', tax_rate: '0', items: [{ description: 'Zero total test', quantity: '1', unit_price: '0.00' }] }
  }), 201, 'zero-total draft create').invoice;
  assert.equal(zeroDraft.total, '0.00');
  const zeroIssue = checkStatus(await admin.request(`/api/invoices/${zeroDraft.id}/issue`, { method: 'POST', body: {} }), 409, 'zero-total issue denied');
  assert.equal(zeroIssue.error.code, 'INVOICE_TOTAL_MUST_BE_POSITIVE');

  const pastDueDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pastDueDraft = checkStatus(await admin.request('/api/invoices', {
    method: 'POST', body: { customer_id: customer.id, due_date: pastDueDate, tax_rate: '0', items: [{ description: 'Past due issue test', quantity: '1', unit_price: '100.00' }] }
  }), 201, 'past-due draft create').invoice;
  const pastDueIssue = checkStatus(await admin.request(`/api/invoices/${pastDueDraft.id}/issue`, { method: 'POST', body: {} }), 409, 'due date before issue date denied');
  assert.equal(pastDueIssue.error.code, 'INVOICE_DUE_DATE_INVALID');
  checks.push('draft creation, empty/zero issue guards, and due-date validation');

  const draft = checkStatus(await admin.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      due_date: '2027-01-01',
      tax_rate: '0.10',
      items: [{ description: 'CP2 test item', quantity: '2.000', unit_price: '125000.00' }]
    }
  }), 201, 'draft invoice create').invoice;
  assert.equal(draft.invoice_no, null);
  assert.equal(draft.subtotal, '250000.00');
  assert.equal(draft.tax_amount, '25000.00');
  assert.equal(draft.total, '275000.00');

  const edited = checkStatus(await staff.request(`/api/invoices/${draft.id}`, {
    method: 'PUT',
    body: {
      customer_id: customer.id,
      due_date: '2027-01-02',
      tax_rate: '0.10',
      items: [{ description: 'CP2 test item updated', quantity: '2.000', unit_price: '125000.00' }]
    }
  }), 200, 'draft edit').invoice;
  assert.equal(edited.total, '275000.00');
  checks.push('NUMERIC draft totals and draft edit');

  const issued = checkStatus(await staff.request(`/api/invoices/${draft.id}/issue`, { method: 'POST', body: {} }), 200, 'issue invoice').invoice;
  assert.match(issued.invoice_no, /^INV-\d{4}-\d{6}$/);
  assert.equal(issued.status, 'ISSUED');
  const zeroPayment = checkStatus(await staff.request(`/api/invoices/${draft.id}/payments`, {
    method: 'POST', body: { amount: '0.00', method: 'CASH', paid_at: '2026-10-05' }
  }), 400, 'zero payment denied');
  assert.equal(zeroPayment.error.code, 'INVALID_PAYMENT_AMOUNT');
  const immutable = checkStatus(await admin.request(`/api/invoices/${draft.id}`, {
    method: 'PUT',
    body: { customer_id: customer.id, due_date: '2027-01-02', tax_rate: '0.10', items: [] }
  }), 409, 'issued invoice edit denied');
  assert.equal(immutable.error.code, 'INVOICE_NOT_DRAFT');
  checks.push('issue sequence and issued invoice immutability');

  const partial = checkStatus(await staff.request(`/api/invoices/${draft.id}/payments`, {
    method: 'POST', body: { amount: '100000.00', method: 'BANK_TRANSFER', paid_at: '2026-10-05', reference: 'CP2-PARTIAL' }
  }), 201, 'partial payment').invoice;
  assert.equal(partial.status, 'PARTIALLY_PAID');
  assert.equal(partial.paid_total, '100000.00');
  const overpayment = checkStatus(await admin.request(`/api/invoices/${draft.id}/payments`, {
    method: 'POST', body: { amount: '175000.01', method: 'CARD', paid_at: '2026-10-05', reference: 'CP2-OVER' }
  }), 409, 'overpayment denied');
  assert.equal(overpayment.error.code, 'PAYMENT_EXCEEDS_OUTSTANDING');
  const paid = checkStatus(await staff.request(`/api/invoices/${draft.id}/payments`, {
    method: 'POST', body: { amount: '175000.00', method: 'CASH', paid_at: '2026-10-05', reference: 'CP2-FINAL' }
  }), 201, 'final payment').invoice;
  assert.equal(paid.status, 'PAID');
  checkStatus(await admin.request(`/api/invoices/${draft.id}/payments`, {
    method: 'POST', body: { amount: '1.00', method: 'CASH', paid_at: '2026-10-05', reference: 'CP2-PAID' }
  }), 409, 'payment on paid invoice denied');
  checkStatus(await admin.request(`/api/invoices/${draft.id}/cancel`, {
    method: 'POST', body: { reason: 'CP2 paid invoice cancellation test' }
  }), 409, 'paid invoice cancellation denied');
  checks.push('partial/full payment and overpayment guards');

  const cancelDraft = checkStatus(await admin.request('/api/invoices', {
    method: 'POST', body: { customer_id: customer.id, due_date: '2027-01-01', tax_rate: '0', items: [{ description: 'Cancel test', quantity: '1', unit_price: '10000.00' }] }
  }), 201, 'cancel test draft').invoice;
  const cancelIssued = checkStatus(await admin.request(`/api/invoices/${cancelDraft.id}/issue`, { method: 'POST', body: {} }), 200, 'cancel test issue').invoice;
  assert.notEqual(cancelIssued.invoice_no, issued.invoice_no);
  const missingReason = checkStatus(await admin.request(`/api/invoices/${cancelDraft.id}/cancel`, {
    method: 'POST', body: {}
  }), 400, 'cancellation reason required');
  assert.equal(missingReason.error.code, 'VALIDATION_ERROR');
  checkStatus(await staff.request(`/api/invoices/${cancelDraft.id}/cancel`, {
    method: 'POST', body: { reason: 'Staff must not cancel' }
  }), 403, 'staff cancel denied');
  const cancelled = checkStatus(await admin.request(`/api/invoices/${cancelDraft.id}/cancel`, {
    method: 'POST', body: { reason: 'CP2 unpaid cancellation test' }
  }), 200, 'admin cancellation').invoice;
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.cancel_reason, 'CP2 unpaid cancellation test');
  assert.ok(cancelIssued.invoice_no);
  checkStatus(await admin.request(`/api/customers/${customer.id}`, { method: 'DELETE' }), 409, 'customer with invoice deletion denied');
  checks.push('staff/admin cancellation and customer FK restriction');

  const concurrentDraft = checkStatus(await admin.request('/api/invoices', {
    method: 'POST', body: { customer_id: customer.id, due_date: '2027-01-01', tax_rate: '0', items: [{ description: 'Concurrency test', quantity: '1', unit_price: '1000.00' }] }
  }), 201, 'concurrency draft').invoice;
  await admin.request(`/api/invoices/${concurrentDraft.id}/issue`, { method: 'POST', body: {} }).then((result) => checkStatus(result, 200, 'concurrency issue'));
  const concurrentBody = { amount: '1000.00', method: 'CARD', paid_at: '2026-10-05', reference: 'CP2-CONCURRENT' };
  const concurrentResults = await Promise.all([
    admin.request(`/api/invoices/${concurrentDraft.id}/payments`, { method: 'POST', body: concurrentBody }),
    staff.request(`/api/invoices/${concurrentDraft.id}/payments`, { method: 'POST', body: concurrentBody })
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.response.status).sort(), [201, 409]);
  checks.push('concurrent double-payment protection');

  const paymentList = checkStatus(await admin.request(`/api/payments?invoice_id=${draft.id}`), 200, 'payment list');
  assert.equal(paymentList.items.length, 2);
  const dashboard = checkStatus(await admin.request('/api/dashboard/summary'), 200, 'dashboard summary');
  assert.equal(typeof dashboard.collected, 'string');
  assert.equal(typeof dashboard.outstanding, 'string');
  assert.ok(Object.hasOwn(dashboard, 'by_status'));
  assert.ok(Object.hasOwn(dashboard, 'overdue_count'));
  checks.push('payment list and dashboard');

  const timings = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const start = performance.now();
    checkStatus(await admin.request('/api/invoices?limit=100'), 200, 'invoice listing performance');
    timings.push(performance.now() - start);
  }
  timings.sort((left, right) => left - right);
  const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
  assert.ok(p95 < 500, `invoice listing p95 ${p95.toFixed(2)}ms is not below 500ms`);
  checks.push(`invoice listing p95 ${p95.toFixed(2)}ms`);

  checkStatus(await admin.request('/api/auth/logout', { method: 'POST' }), 204, 'admin logout');
  checkStatus(await admin.request('/api/auth/me'), 401, 'admin session cleared');
  checkStatus(await staff.request('/api/auth/logout', { method: 'POST' }), 204, 'staff logout');
  checkStatus(await staff.request('/api/auth/me'), 401, 'staff session cleared');
  checks.push('logout and session invalidation');

  console.log(`CP2_API_PASS checks=${checks.length} p95_ms=${p95.toFixed(2)} persistence_name=${persistenceCustomer}`);
  for (const check of checks) console.log(`PASS ${check}`);
}

run().catch((error) => {
  console.error(`CP2_API_FAIL ${error.message}`);
  process.exitCode = 1;
});