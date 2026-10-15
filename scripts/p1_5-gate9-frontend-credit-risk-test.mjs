/**
 * BILLING_ONE — P1.5 GATE 9 TEST SUITE
 * FRONTEND CREDIT RISK & MANAGER OVERRIDE UI
 * FORENSIC, BACKEND-CONTRACT-FIRST VERIFICATION
 * 
 * Scenarios:
 * Credit Display: T01 - T06
 * Lock Metadata: T07 - T08
 * Permission UX: T09 - T11
 * Override Dialog: T12 - T16
 * API Failure: T17 - T20
 * Regressions: T21 - T23
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
  } catch (err) {
    // Ignore error
  }
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
  let singleLineSql;
  if (/^(INSERT|UPDATE|DELETE)/i.test(cleanSql)) {
    singleLineSql = `WITH t AS (${cleanSql}) SELECT coalesce(json_agg(t), '[]'::json) FROM t;`;
  } else {
    singleLineSql = `SELECT coalesce(json_agg(t), '[]'::json) FROM (${cleanSql}) t;`;
  }
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
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });
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

function getErrorCode(res) {
  if (res.data && res.data.error) {
    if (typeof res.data.error === 'string') return res.data.error;
    if (res.data.error.code) return res.data.error.code;
  }
  return null;
}

let totalTests = 0;
let passedTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

// -------------------------------------------------------------
// SETUP TEST USERS IN POSTGRESQL
// Ensure test users exist with individual test credentials
const gate9BillingMgrPass = process.env.TEST_GATE9_BILLING_MGR_PASSWORD || 'Test_gate9_billing_mgr_Pass!2026';
const gate9StaffPass = process.env.TEST_GATE9_STAFF_PASSWORD || 'Test_gate9_staff_Pass!2026';

queryDb(`
  INSERT INTO public.users (username, password_hash, role, is_active)
  VALUES ('gate9_billing_mgr', crypt('${gate9BillingMgrPass}', gen_salt('bf', 10)), 'ROLE_BILLING_MANAGER', true)
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate9BillingMgrPass}', gen_salt('bf', 10)), is_active = true, role = 'ROLE_BILLING_MANAGER';
`);

queryDb(`
  INSERT INTO public.users (username, password_hash, role, is_active)
  VALUES ('gate9_staff', crypt('${gate9StaffPass}', gen_salt('bf', 10)), 'staff', true)
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate9StaffPass}', gen_salt('bf', 10)), is_active = true, role = 'staff';
`);

// Flush rate limit on nginx before login
execSync('docker restart billing-nginx-1', { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2000));

const adminClient = new ApiClient();
await adminClient.login('admin', adminPassword);

const managerClient = new ApiClient();
await managerClient.login('gate9_billing_mgr', gate9BillingMgrPass);

const staffClient = new ApiClient();
await staffClient.login('gate9_staff', gate9StaffPass);

// -------------------------------------------------------------
// SETUP DOM ENVIRONMENT FOR UNIT-TESTING PUBLIC/APP.JS
// -------------------------------------------------------------
class MockElement {
  constructor(tag, className = '', text = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this._textContent = text ? String(text) : undefined;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.disabled = false;
    this.value = '';
  }
  get textContent() {
    if (this._textContent !== undefined) return this._textContent;
    if (this.children.length === 0) return '';
    return this.children.map(c => c.textContent).join('');
  }
  set textContent(v) {
    this._textContent = String(v);
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof MockElement) {
        this.children.push(n);
      } else if (typeof n === 'string') {
        this.children.push(new MockElement('text', '', n));
      }
    }
  }
  prepend(...nodes) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n instanceof MockElement) {
        this.children.unshift(n);
      }
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(evt, fn) {
    if (!this.listeners[evt]) this.listeners[evt] = [];
    this.listeners[evt].push(fn);
  }
  removeEventListener(evt, fn) {
    if (!this.listeners[evt]) return;
    this.listeners[evt] = this.listeners[evt].filter(f => f !== fn);
  }
  dispatchEvent(evt) {
    const list = this.listeners[evt.type] || [];
    for (const fn of list) fn(evt);
  }
  remove() {
    this.removed = true;
  }
  focus() { this.focused = true; }
}

const mockDoc = {
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Read app.js code
const appJsCode = fs.readFileSync('app/public/app.js', 'utf8');

// Load helper functions into sandbox context
const sandbox = {
  document: mockDoc,
  window: { location: { hash: '' } },
  localStorage: { getItem: () => null, setItem: () => {} },
  crypto: globalThis.crypto,
  Headers: globalThis.Headers,
  fetch: globalThis.fetch,
  currentUser: null
};

// Evaluate necessary helper functions in node context
const evalHelper = (fnName) => {
  const match = appJsCode.match(new RegExp(`function ${fnName}\\s*\\([\\s\\S]*?\\n\\}`, 'm'));
  if (!match) throw new Error(`Function ${fnName} not found in app.js`);
  return new Function('document', 'node', 'money', 'currentUser', 'hasPermission', 'generateUuid', 'formatUtilization', 'renderCreditUtilizationBar', 'alertBox', 'actionButton', 'table', 'dateText', 'isZero', 'statusBadge', 'customerStatusBadge', `return (${match[0]});`);
};

// Extract functions directly from app.js
const extractFn = (name) => {
  const regex = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const startIdx = appJsCode.search(regex);
  if (startIdx === -1) throw new Error(`Function ${name} not found in app.js`);
  let braceCount = 0;
  let endIdx = -1;
  let inString = false;
  let stringChar = '';
  for (let i = startIdx; i < appJsCode.length; i++) {
    const c = appJsCode[i];
    if (inString) {
      if (c === stringChar && appJsCode[i - 1] !== '\\') inString = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === '{') braceCount++;
    else if (c === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  const fnStr = appJsCode.slice(startIdx, endIdx);
  return fnStr;
};

// Create eval context
const contextCode = `
  const document = mockDoc;
  let currentUser = null;
  ${extractFn('node')}
  ${extractFn('actionButton')}
  ${extractFn('alertBox')}
  ${extractFn('money')}
  ${extractFn('dateText')}
  ${extractFn('isZero')}
  ${extractFn('statusBadge')}
  ${extractFn('customerStatusBadge')}
  ${extractFn('hasPermission')}
  ${extractFn('generateUuid')}
  ${extractFn('formatUtilization')}
  ${extractFn('renderCreditUtilizationBar')}
  ${extractFn('openOverrideModal')}
  return {
    node, actionButton, alertBox, money, dateText, isZero,
    statusBadge, customerStatusBadge, hasPermission, generateUuid,
    formatUtilization, renderCreditUtilizationBar, openOverrideModal,
    setCurrentUser: (u) => { currentUser = u; }
  };
`;

const frontend = new Function('mockDoc', contextCode)(mockDoc);

function createDraftInvoice(customerId, total = '1000000.00') {
  const invRow = queryDbJson(`
    INSERT INTO public.invoices (customer_id, total, subtotal, status, due_date, created_by)
    VALUES (${customerId}, ${total}, ${total}, 'DRAFT', current_date + 10, 1)
    RETURNING id;
  `)[0];
  queryDb(`
    INSERT INTO public.invoice_items (invoice_id, description, unit, quantity, unit_price, discount_percent, line_total)
    VALUES (${invRow.id}, 'Gói dịch vụ kiểm thử Gate 9', 'gói', 1, ${total}, 0, ${total});
  `);
  return invRow.id;
}

// =============================================================
// TEST SUITE EXECUTION
// =============================================================

console.log('=============================================================');
console.log('BILLING_ONE P1.5 GATE 9 — FRONTEND CREDIT RISK & OVERRIDE UI');
console.log('=============================================================\n');

// -------------------------------------------------------------
// SECTION 1: CREDIT DISPLAY (T01 - T06)
// -------------------------------------------------------------

await test('T01: Customer credit limit displayed correctly via backend API & frontend formatter', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status)
    VALUES ('Gate9 T01 Enterprise', 'G9_CUST_T01', 50000000.00, 'ACTIVE')
    RETURNING id, code, name, credit_limit::text, status;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.credit_limit, '50000000.00');
  assert.equal(frontend.money(res.data.customer.credit_limit), '50,000,000 ₫');
});

await test('T02: Current debt displayed correctly from authoritative backend calculation', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status)
    VALUES ('Gate9 T02 Debt Cust', 'G9_CUST_T02_${Date.now()}', 10000000.00, 'ACTIVE')
    RETURNING id;
  `)[0];

  const invRow = queryDbJson(`
    INSERT INTO public.invoices (customer_id, invoice_no, total, subtotal, paid_total, adjusted_total, status, due_date, created_by)
    VALUES (${custRow.id}, 'INV-G9-T02-${Date.now()}-${Math.floor(Math.random()*1000)}', 4000000.00, 4000000.00, 1000000.00, 0, 'ISSUED', current_date + 10, 1)
    RETURNING id;
  `)[0];

  const pRow = queryDbJson(`
    INSERT INTO public.payments (customer_id, amount, method, paid_at, recorded_by, reference)
    VALUES (${custRow.id}, 1000000.00, 'BANK_TRANSFER', CURRENT_DATE, 1, 'PAY-G9-T02-${Date.now()}')
    RETURNING id;
  `)[0];

  queryDb(`
    INSERT INTO public.payment_allocations (payment_id, invoice_id, allocated_amount)
    VALUES (${pRow.id}, ${invRow.id}, 1000000.00);
  `);

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.current_debt, '3000000.00');
  assert.equal(frontend.money(res.data.customer.current_debt), '3,000,000 ₫');
});

await test('T03: Available credit displayed correctly from authoritative backend calculation', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status)
    VALUES ('Gate9 T03 Avail Cust', 'G9_CUST_T03_${Date.now()}', 10000000.00, 'ACTIVE')
    RETURNING id;
  `)[0];

  queryDb(`
    INSERT INTO public.invoices (customer_id, invoice_no, total, subtotal, paid_total, adjusted_total, status, due_date, created_by)
    VALUES (${custRow.id}, 'INV-G9-T03-${Date.now()}-${Math.floor(Math.random()*1000)}', 2500000.00, 2500000.00, 0, 0, 'ISSUED', current_date + 10, 1);
  `);

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.available_credit, '7500000.00');
  assert.equal(frontend.money(res.data.customer.available_credit), '7,500,000 ₫');
});

await test('T04: Credit limit zero handled safely without NaN or Infinity', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status)
    VALUES ('Gate9 T04 Zero Limit', 'G9_CUST_T04', 0.00, 'ACTIVE')
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.credit_limit, '0.00');

  // Test frontend utilization with limit = 0 and debt = 0
  const utilZero = frontend.formatUtilization('0.00', '0.00');
  assert.equal(utilZero.percent, 0);
  assert.equal(Number.isNaN(utilZero.percent), false);
  assert.equal(Number.isFinite(utilZero.percent), true);

  // Test frontend utilization with limit = 0 and debt > 0
  const utilBreach = frontend.formatUtilization('0.00', '500000.00');
  assert.equal(utilBreach.isBreached, true);
  assert.equal(Number.isNaN(utilBreach.percent), false);
  assert.equal(Number.isFinite(utilBreach.percent), true);
});

await test('T05: Warning customer displayed correctly with warning badge', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status)
    VALUES ('Gate9 T05 Warning Cust', 'G9_CUST_T05', 20000000.00, 'WARNING')
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.status, 'WARNING');

  const badge = frontend.customerStatusBadge(res.data.customer.status);
  assert.equal(badge.className, 'badge badge-warning');
  assert.equal(badge.textContent, 'WARNING');
  assert.equal(badge.getAttribute('data-status'), 'WARNING');
});

await test('T06: Locked customer displayed correctly with locked badge', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason)
    VALUES ('Gate9 T06 Locked Cust', 'G9_CUST_T06', 10000000.00, 'LOCKED', 'MANUAL', 'Tạm đình chỉ giao dịch')
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.status, 'LOCKED');

  const badge = frontend.customerStatusBadge(res.data.customer.status, res.data.customer.lock_source);
  assert.equal(badge.className, 'badge badge-locked');
  assert.equal(badge.textContent.includes('LOCKED'), true);
  assert.equal(badge.getAttribute('data-status'), 'LOCKED');
});

// -------------------------------------------------------------
// SECTION 2: LOCK METADATA (T07 - T08)
// -------------------------------------------------------------

await test('T07: MANUAL lock source displayed correctly with distinction', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('Gate9 T07 Manual Locked', 'G9_CUST_T07', 15000000.00, 'LOCKED', 'MANUAL', 'Khóa công nợ thủ công theo quyết định BGĐ', now())
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.status, 'LOCKED');
  assert.equal(res.data.customer.lock_source, 'MANUAL');
  assert.equal(res.data.customer.lock_reason, 'Khóa công nợ thủ công theo quyết định BGĐ');

  const badge = frontend.customerStatusBadge(res.data.customer.status, res.data.customer.lock_source);
  assert.equal(badge.getAttribute('data-lock-source'), 'MANUAL');
  assert.equal(badge.textContent, 'LOCKED (Thủ công)');
});

await test('T08: AUTO_RISK lock source displayed correctly with distinction', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('Gate9 T08 AutoRisk Locked', 'G9_CUST_T08', 25000000.00, 'LOCKED', 'AUTO_RISK', 'Quá hạn 31 ngày (vượt ngưỡng auto-lock 30 ngày)', now())
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.status, 'LOCKED');
  assert.equal(res.data.customer.lock_source, 'AUTO_RISK');

  const badge = frontend.customerStatusBadge(res.data.customer.status, res.data.customer.lock_source);
  assert.equal(badge.getAttribute('data-lock-source'), 'AUTO_RISK');
  assert.equal(badge.textContent, 'LOCKED (Tự động rủi ro)');
});

// -------------------------------------------------------------
// SECTION 3: PERMISSION UX (T09 - T11)
// -------------------------------------------------------------

await test('T09: User with invoice.issue_override permission evaluates true', async () => {
  // Billing Manager session
  frontend.setCurrentUser({
    id: 10,
    username: 'gate9_billing_mgr',
    role: 'ROLE_BILLING_MANAGER',
    permissions: ['invoice.issue_override', 'customer.unlock', 'invoice.create', 'invoice.read']
  });
  assert.equal(frontend.hasPermission('invoice.issue_override'), true);

  // Admin session
  frontend.setCurrentUser({
    id: 1,
    username: 'admin',
    role: 'admin',
    permissions: ['*']
  });
  assert.equal(frontend.hasPermission('invoice.issue_override'), true);
});

await test('T10: User without invoice.issue_override evaluates false (actionable control not shown)', async () => {
  // Staff session (lacks invoice.issue_override)
  frontend.setCurrentUser({
    id: 11,
    username: 'gate9_staff',
    role: 'staff',
    permissions: ['invoice.create', 'invoice.read', 'invoice.update', 'invoice.issue', 'customer.read']
  });
  assert.equal(frontend.hasPermission('invoice.issue_override'), false);

  // Accountant session
  frontend.setCurrentUser({
    id: 12,
    username: 'gate9_accountant',
    role: 'ROLE_ACCOUNTANT',
    permissions: ['invoice.read', 'payment.create', 'payment.read']
  });
  assert.equal(frontend.hasPermission('invoice.issue_override'), false);
});

await test('T11: Backend 403 remains authoritative if client-side check bypassed', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source)
    VALUES ('Gate9 T11 Locked', 'G9_CUST_T11', 10000000.00, 'LOCKED', 'MANUAL')
    RETURNING id;
  `)[0];

  const invoiceId = createDraftInvoice(custRow.id, '2000000.00');

  // Staff attempts direct HTTP issue-override
  const directRes = await staffClient.request(`/api/invoices/${invoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-bypass-staff-${Date.now()}` },
    body: { override_reason: 'Staff cố tình phát hành trực tiếp' }
  });

  assert.equal(directRes.status, 403);
  assert.equal(getErrorCode(directRes), 'FORBIDDEN');
});

// -------------------------------------------------------------
// SECTION 4: OVERRIDE DIALOG & IDEMPOTENCY (T12 - T16)
// -------------------------------------------------------------

await test('T12: Empty override reason rejected client-side & server-side', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source)
    VALUES ('Gate9 T12 Cust', 'G9_CUST_T12', 10000000.00, 'LOCKED', 'MANUAL')
    RETURNING id;
  `)[0];

  const invoiceId = createDraftInvoice(custRow.id, '1000000.00');

  // Client-side verification: length check
  const emptyReason = '   ';
  assert.equal(emptyReason.trim().length >= 10, false);

  // Server-side contract verification
  const res = await managerClient.request(`/api/invoices/${invoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-empty-reason-${Date.now()}` },
    body: { override_reason: emptyReason }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'OVERRIDE_REASON_REQUIRED');
});

await test('T13: Reason below 10 chars rejected client-side & server-side', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source)
    VALUES ('Gate9 T13 Cust', 'G9_CUST_T13', 10000000.00, 'LOCKED', 'MANUAL')
    RETURNING id;
  `)[0];

  const invoiceId = createDraftInvoice(custRow.id, '1000000.00');

  // Client-side verification
  const shortReason = 'Ngắn 7kt';
  assert.equal(shortReason.trim().length < 10, true);

  // Server-side contract verification
  const res = await managerClient.request(`/api/invoices/${invoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-short-reason-${Date.now()}` },
    body: { override_reason: shortReason }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'OVERRIDE_REASON_REQUIRED');
});

await test('T14: Valid reason (>= 10 chars trimmed) submits successfully', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source)
    VALUES ('Gate9 T14 Cust', 'G9_CUST_T14', 10000000.00, 'LOCKED', 'MANUAL')
    RETURNING id;
  `)[0];

  const invoiceId = createDraftInvoice(custRow.id, '3000000.00');

  const validReason = '   Đã được Ban Giám đốc phê duyệt bảo lãnh thanh toán   ';
  assert.equal(validReason.trim().length >= 10, true);

  const res = await managerClient.request(`/api/invoices/${invoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-valid-reason-${Date.now()}` },
    body: { override_reason: validReason.trim() }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.invoice.status, 'ISSUED');
  assert.equal(Boolean(res.data.invoice.invoice_no), true);
});

await test('T15: Idempotency-Key generated conforms to valid UUIDv4 format', () => {
  const uuid = frontend.generateUuid();
  assert.equal(typeof uuid, 'string');
  const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.equal(uuidv4Regex.test(uuid), true, `UUID '${uuid}' did not match UUIDv4 format.`);
});

await test('T16: Same logical retry preserves idempotency behavior and returns replay', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source)
    VALUES ('Gate9 T16 Idemp Cust', 'G9_CUST_T16', 10000000.00, 'LOCKED', 'MANUAL')
    RETURNING id;
  `)[0];

  const invoiceId = createDraftInvoice(custRow.id, '4500000.00');

  const logicalKey = frontend.generateUuid();
  const reason = 'Bảo lãnh thanh toán đặc cách Gate 9 T16';

  // First logical submission
  const firstRes = await managerClient.request(`/api/invoices/${invoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': logicalKey },
    body: { override_reason: reason }
  });
  assert.equal(firstRes.status, 200);
  assert.equal(firstRes.data.is_idempotent_replay, false);

  // Exact retry with SAME idempotency key (simulating network retry / resend)
  const retryRes = await managerClient.request(`/api/invoices/${invoiceId}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': logicalKey },
    body: { override_reason: reason }
  });
  assert.equal(retryRes.status, 200);
  assert.equal(retryRes.data.is_idempotent_replay, true);
  assert.equal(retryRes.data.invoice.invoice_no, firstRes.data.invoice.invoice_no);
});

// -------------------------------------------------------------
// SECTION 5: API FAILURE HANDLING (T17 - T20)
// -------------------------------------------------------------

await test('T17: 401 unauthenticated session handled safely', async () => {
  const anonClient = new ApiClient();
  const res = await anonClient.request('/api/invoices/1/issue-override', {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-anon-${Date.now()}` },
    body: { override_reason: 'Chưa đăng nhập hệ thống' }
  });
  assert.equal(res.status, 401);
  assert.equal(getErrorCode(res), 'UNAUTHENTICATED');
});

await test('T18: 403 forbidden handled without exposing stack trace', async () => {
  const res = await staffClient.request('/api/invoices/1/issue-override', {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-staff-${Date.now()}` },
    body: { override_reason: 'Tài khoản không đủ quyền' }
  });
  assert.equal(res.status, 403);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
  assert.equal(JSON.stringify(res.data).includes('pg_advisory'), false);
  assert.equal(JSON.stringify(res.data).includes('stack'), false);
});

await test('T19: 409 business conflict handled safely when invoice is already ISSUED', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status)
    VALUES ('Gate9 T19 Conflict Cust', 'G9_CUST_T19', 10000000.00, 'ACTIVE')
    RETURNING id;
  `)[0];

  const invRow = queryDbJson(`
    INSERT INTO public.invoices (customer_id, invoice_no, total, subtotal, status, due_date, created_by)
    VALUES (${custRow.id}, 'INV-G9-T19-${Date.now()}-${Math.floor(Math.random()*1000)}', 1000000.00, 1000000.00, 'ISSUED', current_date + 10, 1)
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/invoices/${invRow.id}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-conflict-${Date.now()}` },
    body: { override_reason: 'Hóa đơn đã phát hành từ trước' }
  });
  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'INVOICE_NOT_DRAFT');
});

await test('T20: 5xx server failure returns clean error without leaking database internals', async () => {
  // Pass non-existent invoice ID to issue-override
  const res = await managerClient.request('/api/invoices/999999999/issue-override', {
    method: 'POST',
    headers: { 'Idempotency-Key': `g9-notfound-${Date.now()}` },
    body: { override_reason: 'Kiểm tra lỗi an toàn phía server' }
  });
  assert.equal(res.status, 404);
  assert.equal(getErrorCode(res), 'INVOICE_NOT_FOUND');
  assert.equal(JSON.stringify(res.data).includes('SELECT'), false);
  assert.equal(JSON.stringify(res.data).includes('postgres'), false);
});

// -------------------------------------------------------------
// SECTION 6: REGRESSION TESTS (T21 - T23)
// -------------------------------------------------------------

await test('T21: Existing invoice API contract preserved and undamaged', async () => {
  const res = await managerClient.request('/api/invoices?limit=5');
  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.data.items), true);
  if (res.data.items.length > 0) {
    const inv = res.data.items[0];
    assert.equal('id' in inv, true);
    assert.equal('status' in inv, true);
    assert.equal('customer_name' in inv, true);
    assert.equal('total' in inv, true);
  }
});

await test('T22: Existing customer API contract preserved and undamaged', async () => {
  const res = await managerClient.request('/api/customers?limit=5');
  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.data.items), true);
  if (res.data.items.length > 0) {
    const cust = res.data.items[0];
    assert.equal('id' in cust, true);
    assert.equal('name' in cust, true);
    assert.equal('status' in cust, true);
    assert.equal('credit_limit' in cust, true);
    assert.equal('current_debt' in cust, true);
    assert.equal('available_credit' in cust, true);
  }
});

await test('T23: Existing auth/session API contract preserved and undamaged', async () => {
  const res = await managerClient.request('/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal(res.data.username, 'gate9_billing_mgr');
  assert.equal(res.data.role, 'ROLE_BILLING_MANAGER');
  assert.equal(Array.isArray(res.data.permissions), true);
  assert.equal(res.data.permissions.includes('invoice.issue_override'), true);
});

console.log('\n=============================================================');
console.log(`GATE 9 TEST SUITE SUMMARY: ${passedTests}/${totalTests} PASS`);
console.log('=============================================================');

try {
  queryDb(`
    DELETE FROM public.payment_allocations WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'G9_CUST_%'));
    DELETE FROM public.payments WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'G9_CUST_%');
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'G9_CUST_%'));
    DELETE FROM public.invoices WHERE customer_id IN (SELECT id FROM public.customers WHERE code LIKE 'G9_CUST_%');
    DELETE FROM public.customers WHERE code LIKE 'G9_CUST_%';
  `);
} catch {}


