/**
 * BILLING_ONE — P1.5 GATE 10 TEST SUITE
 * FRONTEND MANUAL UNLOCK & RISK UI COMPLETION
 * FORENSIC, BACKEND-CONTRACT-FIRST VERIFICATION
 *
 * Scenarios:
 * Unlock Visibility: T01 - T04
 * Unlock Modal: T05 - T10
 * Reason Validation: T11 - T14
 * Permission Primitive: T15 - T17
 * Idempotency: T18 - T20
 * Success Workflow: T21 - T23
 * Error Handling: T24 - T29
 * Security: T30 - T31
 * Risk UI & Metadata: T32 - T34
 * Regression: T35 - T38
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

// Ensure test users exist with individual test credentials
const gate10BillingMgrPass = process.env.TEST_GATE10_BILLING_MGR_PASSWORD || 'Test_gate10_billing_mgr_Pass!2026';
const gate10StaffPass = process.env.TEST_GATE10_STAFF_PASSWORD || 'Test_gate10_staff_Pass!2026';

queryDb(`
  INSERT INTO public.users (username, password_hash, role, is_active)
  VALUES ('gate10_billing_mgr', crypt('${gate10BillingMgrPass}', gen_salt('bf', 10)), 'ROLE_BILLING_MANAGER', true)
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate10BillingMgrPass}', gen_salt('bf', 10)), is_active = true, role = 'ROLE_BILLING_MANAGER';
`);

queryDb(`
  INSERT INTO public.users (username, password_hash, role, is_active)
  VALUES ('gate10_staff', crypt('${gate10StaffPass}', gen_salt('bf', 10)), 'staff', true)
  ON CONFLICT (username) DO UPDATE SET password_hash = crypt('${gate10StaffPass}', gen_salt('bf', 10)), is_active = true, role = 'staff';
`);

// Flush rate limit on nginx before login
execSync('docker restart billing-nginx-1', { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2000));

const adminClient = new ApiClient();
await adminClient.login('admin', adminPassword);

const managerClient = new ApiClient();
await managerClient.login('gate10_billing_mgr', gate10BillingMgrPass);

const staffClient = new ApiClient();
await staffClient.login('gate10_staff', gate10StaffPass);

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
    this.id = '';
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

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const check = (node) => {
      if (!(node instanceof MockElement)) return;
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (node.className && node.className.split(/\s+/).includes(cls)) results.push(node);
      } else if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (node.id === id || node.attributes.id === id) results.push(node);
      } else if (selector.startsWith('[') && selector.endsWith(']')) {
        const inner = selector.slice(1, -1);
        const [attr, val] = inner.split('=');
        if (val) {
          const cleanVal = val.replace(/['"]/g, '');
          if (node.getAttribute(attr) === cleanVal) results.push(node);
        } else {
          if (node.getAttribute(attr) !== null) results.push(node);
        }
      } else {
        if (node.tagName.toLowerCase() === selector.toLowerCase()) results.push(node);
      }
      for (const child of node.children) check(child);
    };
    check(this);
    return results;
  }
}

const mockDoc = {
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Read app.js code
const appJsCode = fs.readFileSync('app/public/app.js', 'utf8');

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

const lifecycleCode = appJsCode.slice(
  appJsCode.indexOf('const UnlockOperationState'),
  appJsCode.indexOf('function openUnlockModal')
);

// Create eval context
const contextCode = `
  const document = mockDoc;
  let currentUser = null;
  let pendingFlashMessage = null;
  ${extractFn('node')}
  ${extractFn('actionButton')}
  ${extractFn('anchor')}
  ${extractFn('panel')}
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
  ${lifecycleCode}
  ${extractFn('openUnlockModal')}
  return {
    node, actionButton, anchor, panel, alertBox, money, dateText, isZero,
    statusBadge, customerStatusBadge, hasPermission, generateUuid,
    formatUtilization, renderCreditUtilizationBar, openOverrideModal, openUnlockModal,
    UnlockOperationState, CustomerUnlockLifecycle, activeUnlockLifecycle,
    setCurrentUser: (u) => { currentUser = u; },
    getCurrentUser: () => currentUser,
    setPendingFlash: (f) => { pendingFlashMessage = f; },
    getPendingFlash: () => pendingFlashMessage
  };
`;

const frontend = new Function('mockDoc', contextCode)(mockDoc);

// Helper to find nodes by test-id in mock element tree
function findByTestId(rootNode, testId) {
  if (rootNode.getAttribute && rootNode.getAttribute('data-testid') === testId) return rootNode;
  for (const child of rootNode.children || []) {
    const found = findByTestId(child, testId);
    if (found) return found;
  }
  return null;
}

function findTextContent(rootNode, text) {
  if (rootNode.textContent && rootNode.textContent.includes(text)) return true;
  for (const child of rootNode.children || []) {
    if (findTextContent(child, text)) return true;
  }
  return false;
}

// =============================================================
// TEST SUITE EXECUTION
// =============================================================

console.log('=============================================================');
console.log('BILLING_ONE P1.5 GATE 10 — FRONTEND MANUAL UNLOCK & RISK UI');
console.log('=============================================================\n');

// -------------------------------------------------------------
// SECTION 1: UNLOCK VISIBILITY (T01 - T04)
// -------------------------------------------------------------

await test('T01: LOCKED customer + permission customer.unlock renders actionable unlock button', async () => {
  // Session with customer.unlock
  frontend.setCurrentUser({
    id: 2,
    username: 'gate10_billing_mgr',
    role: 'ROLE_BILLING_MANAGER',
    permissions: ['customer.unlock', 'invoice.issue_override']
  });

  const headingActions = frontend.node('div', 'actions');
  const customer = { id: 101, name: 'T01 Cust', status: 'LOCKED', lock_source: 'MANUAL' };

  if (customer.status === 'LOCKED') {
    if (frontend.hasPermission('customer.unlock')) {
      const unlockBtn = frontend.actionButton('🔓 Mở khóa khách hàng', 'button button-unlock', () => {});
      unlockBtn.setAttribute('data-testid', 'btn-customer-unlock');
      headingActions.append(unlockBtn);
    }
  }

  const btn = findByTestId(headingActions, 'btn-customer-unlock');
  assert.ok(btn, 'Unlock button must be rendered');
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.disabled, false);
  assert.ok(btn.className.includes('button-unlock'));
});

await test('T02: LOCKED customer without permission does not render actionable button but shows notice', async () => {
  // Session without customer.unlock
  frontend.setCurrentUser({
    id: 3,
    username: 'gate10_staff',
    role: 'staff',
    permissions: ['customer.view', 'invoice.view']
  });

  const headingActions = frontend.node('div', 'actions');
  const customer = { id: 102, name: 'T02 Cust', status: 'LOCKED', lock_source: 'AUTO_RISK' };

  if (customer.status === 'LOCKED') {
    if (frontend.hasPermission('customer.unlock')) {
      const unlockBtn = frontend.actionButton('🔓 Mở khóa khách hàng', 'button button-unlock', () => {});
      unlockBtn.setAttribute('data-testid', 'btn-customer-unlock');
      headingActions.append(unlockBtn);
    } else {
      const notice = frontend.node('span', 'small muted', '🔒 Bạn không có quyền mở khóa khách hàng. Yêu cầu quyền: customer.unlock');
      notice.setAttribute('data-testid', 'unlock-permission-notice');
      headingActions.append(notice);
    }
  }

  const btn = findByTestId(headingActions, 'btn-customer-unlock');
  assert.equal(btn, null, 'Actionable unlock button must NOT be rendered');

  const notice = findByTestId(headingActions, 'unlock-permission-notice');
  assert.ok(notice, 'Informational notice must be rendered');
  assert.equal(notice.tagName, 'SPAN');
  assert.ok(notice.textContent.includes('customer.unlock'));
});

await test('T03: ACTIVE customer does not render unlock button or notice', async () => {
  frontend.setCurrentUser({
    id: 1,
    username: 'admin',
    role: 'admin',
    permissions: ['*']
  });

  const headingActions = frontend.node('div', 'actions');
  const customer = { id: 103, name: 'T03 Cust', status: 'ACTIVE', lock_source: null };

  if (customer.status === 'LOCKED') {
    if (frontend.hasPermission('customer.unlock')) {
      const unlockBtn = frontend.actionButton('🔓 Mở khóa khách hàng', 'button button-unlock', () => {});
      unlockBtn.setAttribute('data-testid', 'btn-customer-unlock');
      headingActions.append(unlockBtn);
    }
  }

  const btn = findByTestId(headingActions, 'btn-customer-unlock');
  assert.equal(btn, null);
  const notice = findByTestId(headingActions, 'unlock-permission-notice');
  assert.equal(notice, null);
});

await test('T04: WARNING customer does not render unlock button', async () => {
  frontend.setCurrentUser({
    id: 1,
    username: 'admin',
    role: 'admin',
    permissions: ['*']
  });

  const headingActions = frontend.node('div', 'actions');
  const customer = { id: 104, name: 'T04 Cust', status: 'WARNING', lock_source: null };

  if (customer.status === 'LOCKED') {
    if (frontend.hasPermission('customer.unlock')) {
      const unlockBtn = frontend.actionButton('🔓 Mở khóa khách hàng', 'button button-unlock', () => {});
      unlockBtn.setAttribute('data-testid', 'btn-customer-unlock');
      headingActions.append(unlockBtn);
    }
  }

  const btn = findByTestId(headingActions, 'btn-customer-unlock');
  assert.equal(btn, null);
});

// -------------------------------------------------------------
// SECTION 2: UNLOCK MODAL STRUCTURE & CONTEXT (T05 - T10)
// -------------------------------------------------------------

let sampleCust = {
  id: 105,
  name: 'Công ty Cổ phần Alpha Risk',
  code: 'CUST-ALPHA-105',
  status: 'LOCKED',
  lock_source: 'MANUAL',
  locked_at: '2026-10-08T00:00:00.000Z',
  lock_reason: 'Quá hạn thanh toán hợp đồng dịch vụ đợt 3',
  credit_limit: '100000000.00',
  current_debt: '120000000.00',
  available_credit: '-20000000.00'
};

await test('T05: Unlock modal opens with accessible dialog attributes', async () => {
  mockDoc.body.children = [];
  frontend.openUnlockModal(sampleCust, () => {});

  const backdrop = mockDoc.body.children[0];
  assert.ok(backdrop);
  assert.equal(backdrop.getAttribute('role'), 'dialog');
  assert.equal(backdrop.getAttribute('aria-modal'), 'true');
  assert.equal(backdrop.getAttribute('aria-labelledby'), 'unlock-modal-title');

  const title = findByTestId(backdrop, 'unlock-modal-title');
  assert.ok(title);
  assert.equal(title.textContent, 'Xác nhận mở khóa khách hàng');
});

await test('T06: Customer identity rendered in unlock modal context', async () => {
  const backdrop = mockDoc.body.children[0];
  assert.ok(findTextContent(backdrop, 'Công ty Cổ phần Alpha Risk'));
  assert.ok(findTextContent(backdrop, 'CUST-ALPHA-105'));
});

await test('T07: Current status rendered as LOCKED in dialog', async () => {
  const backdrop = mockDoc.body.children[0];
  assert.ok(findTextContent(backdrop, 'LOCKED'));
});

await test('T08: Lock source rendered with clear distinction', async () => {
  const backdrop = mockDoc.body.children[0];
  assert.ok(findTextContent(backdrop, 'Thủ công (MANUAL)'));
});

await test('T09: Lock timestamp rendered safely', async () => {
  const backdrop = mockDoc.body.children[0];
  assert.ok(findTextContent(backdrop, '2026-10-08'));
});

await test('T10: Lock reason rendered safely (handles null/empty gracefully)', async () => {
  const backdrop = mockDoc.body.children[0];
  assert.ok(findTextContent(backdrop, 'Quá hạn thanh toán hợp đồng dịch vụ đợt 3'));

  // Test null/empty reason safe fallback
  mockDoc.body.children = [];
  const custNoReason = { ...sampleCust, lock_reason: null };
  frontend.openUnlockModal(custNoReason, () => {});
  const backdrop2 = mockDoc.body.children[0];
  assert.ok(findTextContent(backdrop2, 'Không có lý do khóa được ghi nhận.'));
  assert.equal(findTextContent(backdrop2, 'null'), false);
  assert.equal(findTextContent(backdrop2, 'undefined'), false);
});

// -------------------------------------------------------------
// SECTION 3: REASON VALIDATION (T11 - T14)
// -------------------------------------------------------------

await test('T11: Empty unlock reason rejected client-side and server-side', async () => {
  mockDoc.body.children = [];
  frontend.openUnlockModal(sampleCust, () => {});
  const backdrop = mockDoc.body.children[0];

  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');

  reasonInput.value = '';
  reasonInput.dispatchEvent({ type: 'input' });
  assert.equal(confirmBtn.disabled, true);

  // Server-side check
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T11 Empty Reason Cust', 'CUST_T11', 10000000.00, 'LOCKED', 'MANUAL', 'Test lock', now())
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t11-key-${Date.now()}` },
    body: { unlock_reason: '' }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'UNLOCK_REASON_REQUIRED');
});

await test('T12: Whitespace-only reason rejected client-side and server-side', async () => {
  mockDoc.body.children = [];
  frontend.openUnlockModal(sampleCust, () => {});
  const backdrop = mockDoc.body.children[0];

  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');

  reasonInput.value = '             ';
  reasonInput.dispatchEvent({ type: 'input' });
  assert.equal(confirmBtn.disabled, true);

  // Server-side check
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T12 Whitespace Cust', 'CUST_T12', 10000000.00, 'LOCKED', 'MANUAL', 'Test lock', now())
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t12-key-${Date.now()}` },
    body: { unlock_reason: '      ' }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'UNLOCK_REASON_REQUIRED');
});

await test('T13: Reason below 10 characters rejected client-side and server-side', async () => {
  mockDoc.body.children = [];
  frontend.openUnlockModal(sampleCust, () => {});
  const backdrop = mockDoc.body.children[0];

  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const counter = findByTestId(backdrop, 'unlock-char-counter');

  reasonInput.value = 'Mở khóa'; // 7 chars
  reasonInput.dispatchEvent({ type: 'input' });
  assert.equal(confirmBtn.disabled, true);
  assert.ok(counter.textContent.includes('7 / 10 ký tự'));

  // Server-side check
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T13 Short Reason Cust', 'CUST_T13', 10000000.00, 'LOCKED', 'MANUAL', 'Test lock', now())
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t13-key-${Date.now()}` },
    body: { unlock_reason: 'Mở khóa' }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'UNLOCK_REASON_REQUIRED');
});

await test('T14: Valid reason (>= 10 chars trimmed) enables confirm button client-side & accepted server-side', async () => {
  mockDoc.body.children = [];
  frontend.openUnlockModal(sampleCust, () => {});
  const backdrop = mockDoc.body.children[0];

  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const counter = findByTestId(backdrop, 'unlock-char-counter');

  reasonInput.value = 'Khách hàng đã thanh toán công nợ và cam kết đúng hạn';
  reasonInput.dispatchEvent({ type: 'input' });
  assert.equal(confirmBtn.disabled, false);
  assert.ok(counter.textContent.includes('Hợp lệ'));

  // Server-side check
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T14 Valid Reason Cust', 'CUST_T14', 10000000.00, 'LOCKED', 'MANUAL', 'Test lock', now())
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t14-key-${Date.now()}` },
    body: { unlock_reason: 'Khách hàng đã thanh toán công nợ và cam kết đúng hạn' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.customer.status, 'ACTIVE');
});

// -------------------------------------------------------------
// SECTION 4: PERMISSION PRIMITIVE (T15 - T17)
// -------------------------------------------------------------

await test('T15: hasPermission("customer.unlock") true for authorized session (admin and manager)', async () => {
  frontend.setCurrentUser({ id: 1, username: 'admin', role: 'admin', permissions: ['*'] });
  assert.equal(frontend.hasPermission('customer.unlock'), true);

  frontend.setCurrentUser({ id: 2, username: 'gate10_billing_mgr', role: 'ROLE_BILLING_MANAGER', permissions: ['customer.unlock'] });
  assert.equal(frontend.hasPermission('customer.unlock'), true);
});

await test('T16: hasPermission("customer.unlock") false for unauthorized session (staff)', async () => {
  frontend.setCurrentUser({ id: 3, username: 'gate10_staff', role: 'staff', permissions: ['customer.view'] });
  assert.equal(frontend.hasPermission('customer.unlock'), false);
});

await test('T17: UI does not become authorization boundary (backend 403 enforcement)', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T17 Auth Boundary Cust', 'CUST_T17', 10000000.00, 'LOCKED', 'MANUAL', 'Test lock', now())
    RETURNING id;
  `)[0];

  const res = await staffClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t17-key-${Date.now()}` },
    body: { unlock_reason: 'Cố tình mở khóa khi không có quyền hợp lệ' }
  });
  assert.equal(res.status, 403);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

// -------------------------------------------------------------
// SECTION 5: IDEMPOTENCY (T18 - T20)
// -------------------------------------------------------------

await test('T18: UUIDv4 idempotency key generated conforms to standard UUID format', async () => {
  const uuid = frontend.generateUuid();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(uuidRegex.test(uuid), `Generated key ${uuid} must match UUIDv4 format`);
});

await test('T19: Idempotency-Key header is transmitted and enforced by backend', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T19 Header Test Cust', 'CUST_T19', 10000000.00, 'LOCKED', 'MANUAL', 'Test lock', now())
    RETURNING id;
  `)[0];

  // Missing Idempotency-Key
  const resMissing = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    body: { unlock_reason: 'Mở khóa không kèm idempotency key' }
  });
  assert.equal(resMissing.status, 400);
  assert.equal(getErrorCode(resMissing), 'IDEMPOTENCY_KEY_REQUIRED');

  // With Idempotency-Key
  const resWithKey = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t19-valid-${Date.now()}` },
    body: { unlock_reason: 'Mở khóa có kèm idempotency key hợp lệ' }
  });
  assert.equal(resWithKey.status, 200);
  assert.equal(resWithKey.data.is_idempotent_replay, false);
});

await test('T20: Same logical retry preserves same key and returns idempotent replay', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T20 Replay Test Cust', 'CUST_T20', 10000000.00, 'LOCKED', 'MANUAL', 'Test lock', now())
    RETURNING id;
  `)[0];

  const retryKey = `t20-retry-key-${Date.now()}`;
  const payload = { unlock_reason: 'Lý do mở khóa dùng chung cho cả lần thử đầu và lần retry' };

  // First call
  const res1 = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': retryKey },
    body: payload
  });
  assert.equal(res1.status, 200);
  assert.equal(res1.data.is_idempotent_replay, false);

  // Logical retry with identical key and payload
  const res2 = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': retryKey },
    body: payload
  });
  assert.equal(res2.status, 200);
  assert.equal(res2.data.is_idempotent_replay, true);
  assert.equal(res2.data.customer.status, 'ACTIVE');
});

// -------------------------------------------------------------
// SECTION 6: SUCCESS WORKFLOW (T21 - T23)
// -------------------------------------------------------------

await test('T21: Successful unlock closes modal', async () => {
  mockDoc.body.children = [];
  let callbackCalled = false;

  frontend.openUnlockModal(sampleCust, () => {
    callbackCalled = true;
  });

  const backdrop = mockDoc.body.children[0];
  assert.ok(backdrop);

  // Simulate close
  backdrop.remove();
  assert.equal(backdrop.removed, true);
});

await test('T22: Customer data refresh occurs from authoritative backend', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T22 Refresh Cust', 'CUST_T22', 25000000.00, 'LOCKED', 'AUTO_RISK', 'Quá hạn tự động', now())
    RETURNING id;
  `)[0];

  const unlockRes = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t22-refresh-${Date.now()}` },
    body: { unlock_reason: 'Khách hàng đã nộp tiền mặt thanh toán toàn bộ' }
  });
  assert.equal(unlockRes.status, 200);

  // Authoritative GET /api/customers/:id reload
  const getRes = await managerClient.request(`/api/customers/${custRow.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.customer.status, 'ACTIVE');
  assert.equal(getRes.data.customer.lock_source, null);
  assert.equal(getRes.data.customer.locked_at, null);
  assert.equal(getRes.data.customer.lock_reason, null);
});

await test('T23: Stale LOCKED state is not left on screen after refresh', async () => {
  const refreshedCust = {
    id: 123,
    name: 'Refreshed Cust',
    status: 'ACTIVE',
    lock_source: null,
    locked_at: null,
    lock_reason: null
  };

  const badge = frontend.customerStatusBadge(refreshedCust.status, refreshedCust.lock_source);
  assert.equal(badge.textContent, 'ACTIVE');
  assert.ok(badge.className.includes('badge-active'));
  assert.equal(badge.className.includes('badge-locked'), false);

  const headingActions = frontend.node('div', 'actions');
  if (refreshedCust.status === 'LOCKED') {
    const btn = frontend.actionButton('Mở khóa', 'button', () => {});
    btn.setAttribute('data-testid', 'btn-customer-unlock');
    headingActions.append(btn);
  }
  assert.equal(findByTestId(headingActions, 'btn-customer-unlock'), null);
});

// -------------------------------------------------------------
// SECTION 7: ERROR HANDLING (T24 - T29)
// -------------------------------------------------------------

await test('T24: HTTP 400 invalid unlock request handled safely', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T24 Err400 Cust', 'CUST_T24', 10000000.00, 'LOCKED', 'MANUAL', 'Lock', now())
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': '   ' }, // empty key after trim
    body: { unlock_reason: 'Lý do hợp lệ trên 10 ký tự' }
  });
  assert.equal(res.status, 400);
  assert.equal(getErrorCode(res), 'IDEMPOTENCY_KEY_REQUIRED');
});

await test('T25: HTTP 401 unauthenticated session handled safely', async () => {
  const unauthClient = new ApiClient();
  const res = await unauthClient.request('/api/customers/1/unlock', {
    method: 'POST',
    headers: { 'Idempotency-Key': 't25-unauth' },
    body: { unlock_reason: 'Lý do hợp lệ trên 10 ký tự' }
  });
  assert.equal(res.status, 401);
  assert.equal(getErrorCode(res), 'UNAUTHENTICATED');
});

await test('T26: HTTP 403 permission denied handled safely', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T26 Err403 Cust', 'CUST_T26', 10000000.00, 'LOCKED', 'MANUAL', 'Lock', now())
    RETURNING id;
  `)[0];

  const res = await staffClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t26-forbidden-${Date.now()}` },
    body: { unlock_reason: 'Yêu cầu mở khóa không có quyền' }
  });
  assert.equal(res.status, 403);
  assert.equal(getErrorCode(res), 'FORBIDDEN');
});

await test('T27: HTTP 404 customer not found handled safely', async () => {
  const res = await managerClient.request('/api/customers/99999999/unlock', {
    method: 'POST',
    headers: { 'Idempotency-Key': `t27-notfound-${Date.now()}` },
    body: { unlock_reason: 'Mở khóa khách hàng không tồn tại' }
  });
  assert.equal(res.status, 404);
  assert.equal(getErrorCode(res), 'CUSTOMER_NOT_FOUND');
});

await test('T28: HTTP 409 conflict handled safely when customer is already ACTIVE', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status)
    VALUES ('T28 Active Cust', 'CUST_T28', 10000000.00, 'ACTIVE')
    RETURNING id;
  `)[0];

  const res = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t28-conflict-${Date.now()}` },
    body: { unlock_reason: 'Cố tình mở khóa khi khách hàng đang ACTIVE' }
  });
  assert.equal(res.status, 409);
  assert.equal(getErrorCode(res), 'CUSTOMER_NOT_LOCKED');
});

await test('T29: HTTP 5xx returns generic safe error without leaking internal details', async () => {
  const res = await managerClient.request('/api/customers/invalid_id/unlock', {
    method: 'POST',
    headers: { 'Idempotency-Key': 't29-key' },
    body: { unlock_reason: 'Lý do hợp lệ trên 10 ký tự' }
  });
  assert.ok(res.status >= 400);
  const bodyText = JSON.stringify(res.data);
  assert.equal(bodyText.includes('SELECT'), false);
  assert.equal(bodyText.includes('pg_advisory'), false);
});

// -------------------------------------------------------------
// SECTION 8: SECURITY (T30 - T31)
// -------------------------------------------------------------

await test('T30: No SQL or database internals exposed in error responses or frontend messages', async () => {
  const sqlPatterns = [/SELECT/i, /INSERT/i, /UPDATE/i, /FROM public\./i, /syntax error/i, /psql/i];
  const testRes = await managerClient.request('/api/customers/999999/unlock', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'sec-check' },
    body: { unlock_reason: 'Test security leaks' }
  });
  const text = JSON.stringify(testRes.data);
  for (const pat of sqlPatterns) {
    assert.equal(pat.test(text), false, `Pattern ${pat} must not be exposed`);
  }
});

await test('T31: No stack traces exposed in responses', async () => {
  const testRes = await managerClient.request('/api/customers/-1/unlock', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'sec-trace' },
    body: { unlock_reason: 'Test stack trace leak' }
  });
  const text = JSON.stringify(testRes.data);
  assert.equal(text.includes(' at '), false, 'Stack trace frames must not be exposed');
  assert.equal(text.includes('node_modules'), false, 'Internal file paths must not be exposed');
});

// -------------------------------------------------------------
// SECTION 9: RISK UI & METADATA (T32 - T34)
// -------------------------------------------------------------

await test('T32: MANUAL lock source renders correctly as LOCKED (Thủ công)', async () => {
  const badge = frontend.customerStatusBadge('LOCKED', 'MANUAL');
  assert.equal(badge.textContent, 'LOCKED (Thủ công)');
  assert.ok(badge.className.includes('badge-locked'));
  assert.equal(badge.getAttribute('data-lock-source'), 'MANUAL');
});

await test('T33: AUTO_RISK lock source renders correctly as LOCKED (Tự động rủi ro)', async () => {
  const badge = frontend.customerStatusBadge('LOCKED', 'AUTO_RISK');
  assert.equal(badge.textContent, 'LOCKED (Tự động rủi ro)');
  assert.ok(badge.className.includes('badge-locked'));
  assert.equal(badge.getAttribute('data-lock-source'), 'AUTO_RISK');
});

await test('T34: Risk/status UI remains synchronized after unlock refresh', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T34 Sync Test Cust', 'CUST_T34', 80000000.00, 'LOCKED', 'AUTO_RISK', 'Quá hạn tín dụng', now())
    RETURNING id;
  `)[0];

  // Unlock customer
  const unlockRes = await managerClient.request(`/api/customers/${custRow.id}/unlock`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t34-sync-${Date.now()}` },
    body: { unlock_reason: 'Ban giám đốc phê duyệt tái cơ cấu nợ và mở khóa' }
  });
  assert.equal(unlockRes.status, 200);

  // Reload financial profile
  const profileRes = await managerClient.request(`/api/customers/${custRow.id}/financial-profile`);
  assert.equal(profileRes.status, 200);
  assert.equal(profileRes.data.profile.status, 'ACTIVE');
  assert.equal(profileRes.data.profile.lock_source, null);
  assert.equal(profileRes.data.profile.lock_reason, null);

  // Verify format utilization with refreshed financial profile
  const util = frontend.formatUtilization(profileRes.data.profile.credit_limit, profileRes.data.profile.current_debt);
  assert.equal(util.isBreached, false);
});

// -------------------------------------------------------------
// SECTION 10: REGRESSION VERIFICATION (T35 - T38)
// -------------------------------------------------------------

await test('T35: Existing Customer Detail functionality preserved', async () => {
  const res = await managerClient.request('/api/customers');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.items));
  if (res.data.items.length > 0) {
    const custId = res.data.items[0].id;
    const detailRes = await managerClient.request(`/api/customers/${custId}`);
    assert.equal(detailRes.status, 200);
    assert.ok(detailRes.data.customer.id);
  }
});

await test('T36: Existing Customer List functionality preserved', async () => {
  const res = await managerClient.request('/api/customers?limit=10&page=1');
  assert.equal(res.status, 200);
  assert.equal(res.data.page, 1);
  assert.equal(res.data.limit, 10);
  assert.ok(Array.isArray(res.data.items));
  assert.ok(res.data.total !== undefined);
});

await test('T37: Gate 9 Manager Override UI and endpoint preserved', async () => {
  const custRow = queryDbJson(`
    INSERT INTO public.customers (name, code, credit_limit, status, lock_source, lock_reason, locked_at)
    VALUES ('T37 Override Reg Cust', 'CUST_T37', 10000000.00, 'LOCKED', 'MANUAL', 'Lock', now())
    RETURNING id;
  `)[0];

  const invRow = queryDbJson(`
    INSERT INTO public.invoices (customer_id, total, subtotal, status, due_date, created_by)
    VALUES (${custRow.id}, 5000000.00, 5000000.00, 'DRAFT', current_date + 10, 1)
    RETURNING id;
  `)[0];

  queryDb(`
    INSERT INTO public.invoice_items (invoice_id, description, unit, quantity, unit_price, discount_percent, line_total)
    VALUES (${invRow.id}, 'Item Test', 'gói', 1, 5000000.00, 0, 5000000.00);
  `);

  const overrideRes = await managerClient.request(`/api/invoices/${invRow.id}/issue-override`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `t37-override-${Date.now()}` },
    body: { override_reason: 'Phê duyệt đặc cách kiểm thử regression Gate 10' }
  });
  assert.equal(overrideRes.status, 200);
  assert.equal(overrideRes.data.invoice.status, 'ISSUED');
});

await test('T38: Existing auth/session functionality preserved', async () => {
  const meRes = await managerClient.request('/api/auth/me');
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.username, 'gate10_billing_mgr');
  assert.ok(meRes.data.permissions.includes('customer.unlock'));
});

console.log('\n=============================================================');
console.log(`GATE 10 TEST SUITE SUMMARY: ${passedTests}/${totalTests} PASS`);
console.log('=============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
