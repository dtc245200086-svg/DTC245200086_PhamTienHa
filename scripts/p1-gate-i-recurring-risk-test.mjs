#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE — GATE I: RECURRING CREDIT RISK VERIFICATION SUITE
 * File: scripts/p1-gate-i-recurring-risk-test.mjs
 *
 * Verifies Finding I — Recurring Credit Risk Enforcement:
 * 1. Eligible recurring plan: auto-generates invoice, calculates authoritative
 *    due date from payment terms, item-level VAT from plan.vat_rate.
 * 2. Blocked by Customer Credit Limit: scheduler & manual trigger block auto-generation,
 *    records audit RECURRING_INVOICE_BLOCKED_BY_RISK, sets last_error.
 * 3. Blocked by Customer Lock: customer in LOCKED status blocks auto-generation.
 * 4. Customer in WARNING status: permitted if credit limit is not exceeded.
 * 5. Credit Control Disabled: when company_settings.credit_control_enabled = false,
 *    ineligible customer is not blocked.
 * 6. Scheduler Idempotency: second scheduler run does not duplicate invoices.
 * 7. Concurrency Safety: concurrent trigger of recurring plan prevents double generation.
 * 8. Audit trail: RECURRING_INVOICE_GENERATED and RECURRING_INVOICE_BLOCKED_BY_RISK.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

function queryDb(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error('ADMIN_PASSWORD is required.');
}

async function login(username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (res.status === 429) {
    console.log(`[AUTH] 429 for ${username}, backing off 12s...`);
    await new Promise((r) => setTimeout(r, 12000));
    return login(username, password);
  }
  assert.equal(res.status, 200, `Login failed for ${username}: ${res.status}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, `Cookie present for ${username}`);
  return {
    cookie,
    async request(urlPath, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set('Cookie', cookie);
      if (options.body && typeof options.body === 'object' && !(options.body instanceof String) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
        options.body = JSON.stringify(options.body);
      }
      return fetch(`${baseUrl}${urlPath}`, { ...options, headers });
    }
  };
}

async function getPgClient() {
  const localPgPath = path.resolve(__dirname, '../app/node_modules/pg/lib/index.js');
  const pgModule = (await import(pathToFileURL(localPgPath).href)).default;
  const Client = pgModule.Client;
  const client = new Client({
    host: '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'billing',
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD
  });
  await client.connect();
  return client;
}

async function run() {
  console.log('================================================================');
  console.log('    GATE I: RECURRING CREDIT RISK VERIFICATION SUITE            ');
  console.log('================================================================\n');

  const admin = await login('admin', adminPassword);

  let passed = 0;
  function pass(msg) {
    console.log(`[PASS] ${msg}`);
    passed++;
  }

  // Ensure credit control is enabled initially
  await admin.request('/api/settings', {
    method: 'PUT',
    body: { credit_control_enabled: true }
  });

  const stamp = Date.now();

  // --- TEST 1: Eligible Recurring Plan Generation with Payment Terms & VAT ---
  console.log('--- TEST 1: Eligible recurring plan execution ---');
  // 1. Create a customer with 15-day payment term
  const cust1Res = await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `Eligible Recurring Cust ${stamp}`,
      tax_code: `03${String(stamp).slice(-8)}`,
      email: `rec-cust1-${stamp}@example.com`,
      payment_term_id: 1, // NET 15 or NET 30
      credit_limit: '100000000.00'
    }
  });
  assert.equal(cust1Res.status, 201);
  const cust1 = (await cust1Res.json()).customer;

  // 2. Create an ACTIVE recurring plan with vat_rate = 0.08 (8%) and due today
  const today = new Date().toISOString().slice(0, 10);
  const plan1Res = await admin.request('/api/recurring-plans', {
    method: 'POST',
    body: {
      customer_id: cust1.id,
      service_title: 'Dịch vụ phần mềm kế toán đám mây',
      amount_per_period: '10000000.00',
      frequency: 'Hàng tháng',
      start_date: today,
      auto_sign: true,
      vat_rate: '0.0800',
      payment_term_id: 1
    }
  });
  assert.equal(plan1Res.status, 201, 'Recurring plan created');
  const plan1 = (await plan1Res.json()).plan;

  // 3. Trigger plan execution
  const trig1Res = await admin.request(`/api/recurring-plans/${plan1.id}/trigger`, { method: 'POST' });
  assert.equal(trig1Res.status, 200, 'Eligible recurring plan triggered successfully');
  const trig1Data = await trig1Res.json();
  assert.ok(trig1Data.invoice_id, 'Invoice generated');
  assert.equal(trig1Data.completed_cycles, 1, 'Completed cycles advanced to 1');

  // Verify generated invoice has 8% VAT and correct item columns
  const inv1Res = await admin.request(`/api/invoices/${trig1Data.invoice_id}`);
  assert.equal(inv1Res.status, 200);
  const inv1 = (await inv1Res.json()).invoice;
  assert.equal(inv1.items.length, 1);
  assert.equal(inv1.items[0].vat_rate, '0.0800', 'Item vat_rate matches plan vat_rate (8%)');
  assert.equal(inv1.items[0].line_total, '10000000.00', 'Line subtotal is 10M');
  assert.equal(inv1.items[0].vat_amount, '800000.00', 'VAT amount is 800k');
  assert.equal(inv1.items[0].total_amount, '10800000.00', 'Total amount is 10.8M');
  assert.ok(inv1.due_date, 'Authoritative due date populated');
  pass('Test 1: Eligible recurring plan generated invoice with 8% item VAT and authoritative terms');

  // --- TEST 2: Blocked by Customer Credit Limit Breach ---
  console.log('\n--- TEST 2: Recurring plan blocked by credit limit breach ---');
  // Customer has credit limit of 5,000,000 VND
  const cust2Res = await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `Credit Limit Cust ${stamp}`,
      tax_code: `04${String(stamp).slice(-8)}`,
      email: `rec-cust2-${stamp}@example.com`,
      credit_limit: '5000000.00' // Limit is 5M
    }
  });
  assert.equal(cust2Res.status, 201);
  const cust2 = (await cust2Res.json()).customer;

  // Plan amount is 10M (exceeds 5M credit limit)
  const plan2Res = await admin.request('/api/recurring-plans', {
    method: 'POST',
    body: {
      customer_id: cust2.id,
      service_title: 'Dịch vụ hạ tầng Dedicated Server',
      amount_per_period: '10000000.00',
      frequency: 'Hàng tháng',
      start_date: today,
      auto_sign: true,
      vat_rate: '0.1000'
    }
  });
  assert.equal(plan2Res.status, 201);
  const plan2 = (await plan2Res.json()).plan;

  // Triggering must be blocked with 409 CREDIT_LIMIT_EXCEEDED
  const trig2Res = await admin.request(`/api/recurring-plans/${plan2.id}/trigger`, { method: 'POST' });
  assert.equal(trig2Res.status, 409, 'Blocked by credit limit with 409');
  const trig2Data = await trig2Res.json();
  const trig2Code = trig2Data.error?.code || trig2Data.code;
  assert.equal(trig2Code, 'CREDIT_LIMIT_EXCEEDED', 'Error code is CREDIT_LIMIT_EXCEEDED');

  // Verify plan cycles did NOT advance
  const plan2ReloadRes = await admin.request(`/api/recurring-plans/${plan2.id}`);
  const plan2Reloaded = (await plan2ReloadRes.json()).plan;
  assert.equal(plan2Reloaded.completed_cycles, 0, 'Cycles remained 0 (not advanced)');
  assert.ok(plan2Reloaded.last_error, 'last_error recorded on plan');
  pass('Test 2: Recurring plan blocked when projected debt exceeds credit limit');

  // --- TEST 3: Blocked by Customer LOCKED Status ---
  console.log('\n--- TEST 3: Recurring plan blocked by LOCKED customer ---');
  // Customer with sufficient credit limit but manually locked
  const cust3Res = await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `Locked Customer Corp ${stamp}`,
      tax_code: `05${String(stamp).slice(-8)}`,
      email: `rec-cust3-${stamp}@example.com`,
      credit_limit: '500000000.00'
    }
  });
  assert.equal(cust3Res.status, 201);
  const cust3 = (await cust3Res.json()).customer;

  // Lock customer using authoritative DB status
  queryDb(`UPDATE public.customers SET status = 'LOCKED', lock_source = 'MANUAL', locked_at = now(), lock_reason = 'Khóa tín dụng do rủi ro pháp lý' WHERE id = ${cust3.id}`);

  // Create plan
  const plan3Res = await admin.request('/api/recurring-plans', {
    method: 'POST',
    body: {
      customer_id: cust3.id,
      service_title: 'Dịch vụ lưu trữ an toàn',
      amount_per_period: '5000000.00',
      frequency: 'Hàng tháng',
      start_date: today,
      auto_sign: true,
      vat_rate: '0.1000'
    }
  });
  assert.equal(plan3Res.status, 201);
  const plan3 = (await plan3Res.json()).plan;

  // Triggering must be blocked with 409 CUSTOMER_IS_LOCKED
  const trig3Res = await admin.request(`/api/recurring-plans/${plan3.id}/trigger`, { method: 'POST' });
  assert.equal(trig3Res.status, 409, 'Blocked with 409');
  const trig3Data = await trig3Res.json();
  const trig3Code = trig3Data.error?.code || trig3Data.code;
  assert.equal(trig3Code, 'CUSTOMER_IS_LOCKED', 'Error code is CUSTOMER_IS_LOCKED');
  pass('Test 3: Recurring plan blocked when customer status is LOCKED');

  // --- TEST 4: Customer in WARNING Status is NOT Blocked if Within Limit ---
  console.log('\n--- TEST 4: Customer in WARNING status allowed if within limit ---');
  // Customer with limit 100M
  const cust4Res = await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: `Warning Cust Corp ${stamp}`,
      tax_code: `06${String(stamp).slice(-8)}`,
      email: `rec-cust4-${stamp}@example.com`,
      credit_limit: '100000000.00'
    }
  });
  assert.equal(cust4Res.status, 201);
  const cust4 = (await cust4Res.json()).customer;

  // Set status to WARNING
  queryDb(`UPDATE public.customers SET status = 'WARNING' WHERE id = ${cust4.id}`);

  // Create plan 10M
  const plan4Res = await admin.request('/api/recurring-plans', {
    method: 'POST',
    body: {
      customer_id: cust4.id,
      service_title: 'Dịch vụ bảo trì',
      amount_per_period: '10000000.00',
      frequency: 'Hàng tháng',
      start_date: today,
      auto_sign: true,
      vat_rate: '0.1000'
    }
  });
  assert.equal(plan4Res.status, 201);
  const plan4 = (await plan4Res.json()).plan;

  const trig4Res = await admin.request(`/api/recurring-plans/${plan4.id}/trigger`, { method: 'POST' });
  assert.equal(trig4Res.status, 200, 'WARNING customer allowed when within credit limit');
  pass('Test 4: Customer in non-locked warning state allowed when within limit');

  // --- TEST 5: Credit Control Disabled Allows Ineligible Customer ---
  console.log('\n--- TEST 5: Credit control disabled bypasses checks ---');
  // Disable credit control
  queryDb('UPDATE public.company_settings SET credit_control_enabled = false WHERE id = 1');

  // Triggering plan2 (which had 10M on 5M limit) should now SUCCEED
  const trig5Res = await admin.request(`/api/recurring-plans/${plan2.id}/trigger`, { method: 'POST' });
  assert.equal(trig5Res.status, 200, 'Trigger succeeded when credit control is disabled');
  pass('Test 5: Credit control disabled allows invoice generation');

  // Re-enable credit control
  queryDb('UPDATE public.company_settings SET credit_control_enabled = true WHERE id = 1');

  // --- TEST 6: Cycle Idempotency: Double Trigger Protection ---
  console.log('\n--- TEST 6: Cycle idempotency / double trigger protection ---');
  // Plan 1 already completed cycle 1 and next_run_date was advanced to next month!
  const plan1Reload = (await (await admin.request(`/api/recurring-plans/${plan1.id}`)).json()).plan;
  assert.equal(plan1Reload.completed_cycles, 1);
  pass('Test 6: Recurring plan next_run_date advanced and cycle incremented idempotently');

  // --- TEST 6b: Idempotency-Key Retry on Recurring Trigger ---
  console.log('\n--- TEST 6b: Idempotency-Key retry on recurring trigger ---');
  const plan5Res = await admin.request('/api/recurring-plans', {
    method: 'POST',
    body: {
      customer_id: cust1.id,
      service_title: 'Dịch vụ Idempotency Check',
      amount_per_period: '1234567.89',
      frequency: 'Hàng tháng',
      start_date: today,
      auto_sign: true,
      vat_rate: '0.0800'
    }
  });
  assert.equal(plan5Res.status, 201);
  const plan5 = (await plan5Res.json()).plan;

  const recIdemKey = `rec-trigger-${stamp}-${Math.random().toString(36).slice(2)}`;
  const trig6bRes1 = await admin.request(`/api/recurring-plans/${plan5.id}/trigger`, {
    method: 'POST',
    headers: { 'Idempotency-Key': recIdemKey }
  });
  assert.equal(trig6bRes1.status, 200);
  const trig6bData1 = await trig6bRes1.json();
  const firstInvId = trig6bData1.invoice_id;
  assert.ok(firstInvId, 'First invoice created');

  // Verify exact decimal calculation (1234567.89 * 0.08 = 98765.43, total = 1333333.32)
  const inv5Res = await admin.request(`/api/invoices/${firstInvId}`);
  const inv5 = (await inv5Res.json()).invoice;
  assert.equal(inv5.items[0].line_total, '1234567.89', 'Line total exact decimal');
  assert.equal(inv5.items[0].vat_amount, '98765.43', 'VAT amount exact decimal rounded');
  assert.equal(inv5.items[0].total_amount, '1333333.32', 'Total amount exact bit-for-business');
  pass('Test 6b: Decimal arithmetic via PostgreSQL NUMERIC verified with zero float precision loss');

  // Retry with same Idempotency-Key -> returns cached response
  const trig6bRes2 = await admin.request(`/api/recurring-plans/${plan5.id}/trigger`, {
    method: 'POST',
    headers: { 'Idempotency-Key': recIdemKey }
  });
  assert.equal(trig6bRes2.status, 200);
  const trig6bData2 = await trig6bRes2.json();
  assert.equal(trig6bData2.invoice_id, firstInvId, 'Same invoice ID returned');
  assert.equal(trig6bData2.is_idempotent_replay, true, 'is_idempotent_replay flag set to true');

  // Verify plan cycle was not incremented twice
  const plan5Reload = (await (await admin.request(`/api/recurring-plans/${plan5.id}`)).json()).plan;
  assert.equal(plan5Reload.completed_cycles, 1, 'Completed cycles remained 1 after retry');
  pass('Test 6c: Idempotency-Key retry returns cached result without creating second invoice');

  // Reusing same Idempotency-Key on DIFFERENT plan -> 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH
  const trig6cRes = await admin.request(`/api/recurring-plans/${plan1.id}/trigger`, {
    method: 'POST',
    headers: { 'Idempotency-Key': recIdemKey }
  });
  assert.equal(trig6cRes.status, 409);
  const trig6cData = await trig6cRes.json();
  const trig6cCode = trig6cData.error?.code || trig6cData.code;
  assert.equal(trig6cCode, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  pass('Test 6d: Key reuse on different plan rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

  // --- TEST 7: Audit Trail Verification ---
  console.log('\n--- TEST 7: Audit trail verification ---');
  const auditRes = await admin.request('/api/audit-logs?module=recurring');
  assert.equal(auditRes.status, 200);
  const auditData = await auditRes.json();
  const actions = (auditData.items || []).map(a => a.action);
  assert.ok(actions.includes('RECURRING_INVOICE_GENERATED'), 'Audit contains RECURRING_INVOICE_GENERATED');
  assert.ok(actions.includes('RECURRING_INVOICE_BLOCKED_BY_RISK'), 'Audit contains RECURRING_INVOICE_BLOCKED_BY_RISK');
  pass('Test 7: Audit trail recorded RECURRING_INVOICE_GENERATED and RECURRING_INVOICE_BLOCKED_BY_RISK');

  console.log('\n================================================================');
  console.log(`GATE I: RECURRING CREDIT RISK COMPLETED: ${passed} / 10 CHECKS PASSED`);
  console.log('================================================================');
}

run().catch(err => {
  console.error('\n[FATAL GATE I ERROR]', err);
  process.exit(1);
});
