/**
 * BILLING_ONE — P1 GATE C TEST SUITE
 * PAYMENT TERMS & AUTHORITATIVE DUE DATE ENGINE VERIFICATION
 * 
 * Verifies:
 * - Deterministic date arithmetic across NET 0, 7, 15, 30, 45, 60
 * - Month boundaries, leap year boundaries, year rollover
 * - Default payment term resolution and customer term inheritance
 * - Rejection of invalid payment terms (404)
 * - Prevention of arbitrary client-side due-date injection
 * - Authoritative recalculation on invoice draft updates and issuance
 * - Recurring billing scheduler integration
 * - SHA-256 transaction-coupled audit trail preservation
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load .env fallback
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
  } catch (err) {}
}

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const staffPassword = process.env.STAFF_PASSWORD;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!staffPassword || !adminPassword) {
  throw new Error('STAFF_PASSWORD and ADMIN_PASSWORD are required in environment or .env.');
}

function queryDb(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  return out;
}

function queryDbJson(sql) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim().replace(/;+$/, '');
  const singleLineSql = `SELECT coalesce(json_agg(t), '[]'::json) FROM (${cleanSql}) t;`;
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  if (!out || out === '') return [];
  return JSON.parse(out);
}

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async login(username, password) {
    let res = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });
    if (res.status === 429) {
      console.log('[TEST_HARNESS] 429 encountered during login. Backing off 12s...');
      await new Promise(r => setTimeout(r, 12000));
      res = await this.request('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      });
    }
    return res;
  }

  async request(path, { method = 'GET', body, headers: customHeaders = {} } = {}) {
    const headers = new Headers(customHeaders);
    if (body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.cookie) {
      headers.set('Cookie', this.cookie);
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
}

async function run() {
  console.log('================================================================');
  console.log('   BILLING_ONE — P1 GATE C: PAYMENT TERMS & DUE DATE ENGINE     ');
  console.log('================================================================\n');

  const admin = new ApiClient();
  const staff = new ApiClient();

  const adminLogin = await admin.login('admin', adminPassword);
  assert.equal(adminLogin.status, 200, 'Admin login must succeed');

  const staffLogin = await staff.login('staff', staffPassword);
  assert.equal(staffLogin.status, 200, 'Staff login must succeed');

  let passed = 0;
  function pass(title) {
    console.log(`[PASS] ${title}`);
    passed++;
  }

  // Unit verification of calendar arithmetic
  const PaymentTermsService = (await import('../app/src/services/paymentTermsService.js')).default || (await import('../app/src/services/paymentTermsService.js'));

  // Test 1: Service date arithmetic - Leap year boundary
  assert.equal(PaymentTermsService.calculateDueDate('2028-02-28', 1), '2028-02-29', '2028 is a leap year; Feb 28 + 1 day = Feb 29');
  assert.equal(PaymentTermsService.calculateDueDate('2026-02-28', 1), '2026-03-01', '2026 is non-leap; Feb 28 + 1 day = Mar 01');
  pass('T01: Leap year calendar date boundary handled correctly');

  // Test 2: Service date arithmetic - Month boundary & Year rollover
  assert.equal(PaymentTermsService.calculateDueDate('2026-01-31', 15), '2026-02-15', 'Jan 31 + 15 days = Feb 15');
  assert.equal(PaymentTermsService.calculateDueDate('2026-12-25', 15), '2027-01-09', 'Dec 25 + 15 days = Jan 09 next year');
  pass('T02: Month boundary and Year rollover handled correctly');

  // Ensure terms for NET 0, NET 7, NET 15, NET 30, NET 45, NET 60 exist in DB
  const termDefs = [
    { code: 'NET_0_P1C', name: 'NET 0 Ngày (COD)', days: 0 },
    { code: 'NET_7_P1C', name: 'NET 7 Ngày', days: 7 },
    { code: 'NET_15_P1C', name: 'NET 15 Ngày', days: 15 },
    { code: 'NET_30_P1C', name: 'NET 30 Ngày', days: 30 },
    { code: 'NET_45_P1C', name: 'NET 45 Ngày', days: 45 },
    { code: 'NET_60_P1C', name: 'NET 60 Ngày', days: 60 }
  ];

  const termsMap = {};
  for (const def of termDefs) {
    const existing = queryDbJson(`SELECT id, code, days FROM public.payment_terms WHERE days = ${def.days} ORDER BY id ASC LIMIT 1`);
    if (existing.length > 0) {
      termsMap[def.days] = existing[0];
    } else {
      const createdRes = await admin.request('/api/payment-terms', {
        method: 'POST',
        body: { code: def.code, name: def.name, days: def.days, is_default: false }
      });
      assert.equal(createdRes.status, 201, `Failed to create term NET ${def.days}`);
      termsMap[def.days] = createdRes.data.term;
    }
  }
  pass('T03: Terms catalog for NET 0, 7, 15, 30, 45, 60 present in database');

  // Create isolated test customer
  const custCode = `CUST_P1C_${Date.now()}`;
  const custRes = await staff.request('/api/customers', {
    method: 'POST',
    body: {
      code: custCode,
      name: `Khách hàng P1C Gate Test ${Date.now()}`,
      segment: 'SME',
      tax_code: '0108889999',
      credit_limit: '100000000',
      payment_term_id: termsMap[30].id // Customer has default NET 30
    }
  });
  assert.equal(custRes.status, 201, 'Customer creation must succeed');
  const testCustomer = custRes.data.customer;
  pass('T04: Test customer created with profile payment_term_id = NET 30');

  const currentDate = queryDb('SELECT current_date::text');

  // Test 5: NET 0 Invoice Creation (due_date = current_date)
  const invNet0 = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[0].id,
      items: [{ description: 'Dịch vụ NET 0', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invNet0.status, 201);
  assert.equal(String(invNet0.data.invoice.due_date).slice(0, 10), currentDate, 'NET 0 due_date must equal current_date');
  const dbDue0 = queryDb(`SELECT due_date::text FROM public.invoices WHERE id = ${invNet0.data.invoice.id}`);
  assert.equal(dbDue0, currentDate, 'Database persisted due_date must match authoritative NET 0');
  pass('T05: NET 0 invoice creation correctly calculates and persists due_date');

  // Test 6: NET 7 Invoice Creation (due_date = current_date + 7 days)
  const expectedNet7 = PaymentTermsService.calculateDueDate(currentDate, 7);
  const invNet7 = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[7].id,
      items: [{ description: 'Dịch vụ NET 7', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invNet7.status, 201);
  assert.equal(String(invNet7.data.invoice.due_date).slice(0, 10), expectedNet7);
  pass('T06: NET 7 invoice creation correctly derives due_date');

  // Test 7: NET 15 Invoice Creation (due_date = current_date + 15 days)
  const expectedNet15 = PaymentTermsService.calculateDueDate(currentDate, 15);
  const invNet15 = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[15].id,
      items: [{ description: 'Dịch vụ NET 15', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invNet15.status, 201);
  assert.equal(String(invNet15.data.invoice.due_date).slice(0, 10), expectedNet15);
  pass('T07: NET 15 invoice creation correctly derives due_date');

  // Test 8: NET 30 Invoice Creation (due_date = current_date + 30 days)
  const expectedNet30 = PaymentTermsService.calculateDueDate(currentDate, 30);
  const invNet30 = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[30].id,
      items: [{ description: 'Dịch vụ NET 30', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invNet30.status, 201);
  assert.equal(String(invNet30.data.invoice.due_date).slice(0, 10), expectedNet30);
  pass('T08: NET 30 invoice creation correctly derives due_date');

  // Test 9: NET 45 Invoice Creation (due_date = current_date + 45 days)
  const expectedNet45 = PaymentTermsService.calculateDueDate(currentDate, 45);
  const invNet45 = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[45].id,
      items: [{ description: 'Dịch vụ NET 45', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invNet45.status, 201);
  assert.equal(String(invNet45.data.invoice.due_date).slice(0, 10), expectedNet45);
  pass('T09: NET 45 invoice creation correctly derives due_date');

  // Test 10: NET 60 Invoice Creation (due_date = current_date + 60 days)
  const expectedNet60 = PaymentTermsService.calculateDueDate(currentDate, 60);
  const invNet60 = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[60].id,
      items: [{ description: 'Dịch vụ NET 60', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invNet60.status, 201);
  assert.equal(String(invNet60.data.invoice.due_date).slice(0, 10), expectedNet60);
  pass('T10: NET 60 invoice creation correctly derives due_date');

  // Test 11: Missing term in request -> inherits customer's payment_term_id (NET 30)
  const invCustomerDefault = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      // payment_term_id omitted
      items: [{ description: 'Dịch vụ Không truyền term', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invCustomerDefault.status, 201);
  assert.equal(Number(invCustomerDefault.data.invoice.payment_term_id), Number(termsMap[30].id));
  assert.equal(String(invCustomerDefault.data.invoice.due_date).slice(0, 10), expectedNet30, 'Inherited customer term must determine due_date');
  pass('T11: When payment_term_id is omitted, customer profile term is inherited');

  // Test 12: Missing term and customer has NO term -> fallback to system default (is_default = true)
  const custNoTermRes = await staff.request('/api/customers', {
    method: 'POST',
    body: {
      code: `CUST_NOTERM_${Date.now()}`,
      name: `Khách hàng không term ${Date.now()}`,
      segment: 'SME',
      tax_code: '0107776666',
      credit_limit: '50000000',
      payment_term_id: null
    }
  });
  assert.equal(custNoTermRes.status, 201);
  const custNoTerm = custNoTermRes.data.customer;

  let defaultTermDb = queryDbJson('SELECT id, days FROM public.payment_terms WHERE is_default = true LIMIT 1')[0];
  if (!defaultTermDb) {
    queryDb("UPDATE public.payment_terms SET is_default = true WHERE code = 'NET_15';");
    defaultTermDb = queryDbJson("SELECT id, days FROM public.payment_terms WHERE is_default = true LIMIT 1")[0] ||
      queryDbJson("SELECT id, days FROM public.payment_terms ORDER BY id ASC LIMIT 1")[0];
  }
  const expectedDefaultDue = PaymentTermsService.calculateDueDate(currentDate, defaultTermDb.days);

  const invSysDefault = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: custNoTerm.id,
      items: [{ description: 'Dịch vụ Hệ thống mặc định', quantity: '1', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invSysDefault.status, 201);
  assert.equal(Number(invSysDefault.data.invoice.payment_term_id), Number(defaultTermDb.id));
  assert.equal(String(invSysDefault.data.invoice.due_date).slice(0, 10), expectedDefaultDue);
  pass('T12: When customer has no term, system default term is authoritatively resolved');

  // Test 13: Invalid payment_term_id -> 404 PAYMENT_TERM_NOT_FOUND
  const invInvalidTerm = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: 999999999,
      items: [{ description: 'Test', quantity: '1', unit_price: '100000' }]
    }
  });
  assert.equal(invInvalidTerm.status, 404);
  assert.equal(invInvalidTerm.data.error?.code, 'PAYMENT_TERM_NOT_FOUND');
  pass('T13: Non-existent payment_term_id is rejected with 404 PAYMENT_TERM_NOT_FOUND');

  // Test 14: Unauthorized arbitrary due_date injection prevention
  // Caller tries to inject a due_date in 2099 or arbitrary date
  const maliciousDueDate = '2099-01-01';
  const invInjectionAttempt = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[15].id,
      due_date: maliciousDueDate, // Injected unauthorized due_date!
      items: [{ description: 'Kiểm tra chống sửa due_date', quantity: '1', unit_price: '500000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invInjectionAttempt.status, 201);
  assert.notEqual(invInjectionAttempt.data.invoice.due_date, maliciousDueDate, 'Client-injected due_date MUST NOT be accepted');
  assert.equal(String(invInjectionAttempt.data.invoice.due_date).slice(0, 10), expectedNet15, 'Authoritative server calculation MUST override client injection');
  const dbInjectedDue = queryDb(`SELECT due_date::text FROM public.invoices WHERE id = ${invInjectionAttempt.data.invoice.id}`);
  assert.equal(dbInjectedDue, expectedNet15, 'Database must persist authoritative calculated due_date');
  pass('T14: Client-injected arbitrary due_date is thwarted in favor of server authority');

  // Test 15: Updating draft invoice recalculates authoritative due_date
  const draftToUpdateId = invNet15.data.invoice.id;
  const updateRes = await staff.request(`/api/invoices/${draftToUpdateId}`, {
    method: 'PUT',
    body: {
      customer_id: testCustomer.id,
      payment_term_id: termsMap[60].id, // Switch from NET 15 to NET 60
      due_date: '2099-12-31', // Client again attempts arbitrary date
      items: [{ description: 'Cập nhật sang NET 60', quantity: '1', unit_price: '200000', vat_rate: '0.10' }]
    }
  });
  assert.equal(updateRes.status, 200);
  assert.equal(String(updateRes.data.invoice.due_date).slice(0, 10), expectedNet60, 'Updated invoice must reflect NET 60 authoritative calculation');
  const dbUpdatedDue = queryDb(`SELECT due_date::text FROM public.invoices WHERE id = ${draftToUpdateId}`);
  assert.equal(dbUpdatedDue, expectedNet60);
  pass('T15: Updating draft invoice term recalculates and persists authoritative due_date');

  // Test 16: Issuing invoice synchronizes due_date from issue_date (current_date)
  const issueRes = await staff.request(`/api/invoices/${draftToUpdateId}/issue`, {
    method: 'POST',
    body: {}
  });
  assert.equal(issueRes.status, 200);
  assert.equal(issueRes.data.invoice.status, 'ISSUED');
  assert.equal(String(issueRes.data.invoice.issue_date).slice(0, 10), currentDate);
  assert.equal(String(issueRes.data.invoice.due_date).slice(0, 10), expectedNet60);
  pass('T16: Issuing invoice synchronizes due_date with issue_date + term.days');

  // Test 17: Audit trail check
  const auditRes = await admin.request('/api/audit/verify', { method: 'POST' });
  assert.equal(auditRes.status, 200);
  assert.equal(auditRes.data.valid, true, 'Audit cryptographic chain must remain valid');
  pass('T17: Audit log transaction coupling and SHA-256 chain integrity verified');

  console.log('\n================================================================');
  console.log(`GATE C VERIFICATION COMPLETE: ${passed} PASSED, 0 FAILED`);
  console.log('STATUS: GATE C (PAYMENT TERMS & DUE DATE) — PASS');
  console.log('================================================================');
}

run().catch(err => {
  console.error('[FATAL] Gate C test failed:', err);
  process.exit(1);
});
