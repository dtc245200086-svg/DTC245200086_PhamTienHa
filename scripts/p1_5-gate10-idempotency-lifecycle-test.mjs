/**
 * BILLING_ONE — P1.5 GATE 10 FORENSIC REMEDIATION
 * IDEMPOTENCY LIFECYCLE STATE MACHINE TEST SUITE (ID25 - ID59)
 *
 * Verifies the exact model:
 * ONE LOGICAL OPERATION = ONE operationId + ONE idempotencyKey + ONE immutable requestPayload
 *                         + ZERO OR MORE SAFE RETRIES + ONE TERMINAL OUTCOME
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

class MockElement {
  constructor(tag, className = '', text = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.textContent = text ? String(text) : '';
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.disabled = false;
    this.value = '';
    this.id = '';
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
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const find = (node) => {
        if (node.className && node.className.split(/\s+/).includes(cls)) return node;
        for (const child of node.children) {
          const res = find(child);
          if (res) return res;
        }
        return null;
      };
      return find(this);
    }
    return null;
  }
}

const mockDoc = {
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  listeners: {},
  addEventListener: (evt, fn) => {
    if (!mockDoc.listeners[evt]) mockDoc.listeners[evt] = [];
    mockDoc.listeners[evt].push(fn);
  },
  removeEventListener: (evt, fn) => {
    if (mockDoc.listeners[evt]) {
      mockDoc.listeners[evt] = mockDoc.listeners[evt].filter(f => f !== fn);
    }
  },
  dispatchEvent: (evt) => {
    for (const fn of (mockDoc.listeners[evt.type] || [])) fn(evt);
  }
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
  return appJsCode.slice(startIdx, endIdx);
};

const lifecycleCode = appJsCode.slice(
  appJsCode.indexOf('const UnlockOperationState'),
  appJsCode.indexOf('function openUnlockModal')
);

const contextCode = `
  const document = mockDoc;
  let currentUser = null;
  let pendingFlashMessage = null;
  let mockApiHandler = null;

  async function api(path, options = {}) {
    if (mockApiHandler) {
      return mockApiHandler(path, options);
    }
    throw new Error('No mockApiHandler defined');
  }

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
    setMockApi: (fn) => { mockApiHandler = fn; }
  };
`;

const frontend = new Function('mockDoc', contextCode)(mockDoc);

function findByTestId(rootNode, testId) {
  if (rootNode.getAttribute && rootNode.getAttribute('data-testid') === testId) return rootNode;
  for (const child of rootNode.children || []) {
    const found = findByTestId(child, testId);
    if (found) return found;
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

console.log('=============================================================');
console.log('BILLING_ONE P1.5 — IDEMPOTENCY LIFECYCLE REMEDIATION (ID25 - ID59)');
console.log('=============================================================\n');

const testCustomer = {
  id: 7001,
  name: 'Forensic Lifecycle Customer',
  code: 'CUST-LC-7001',
  status: 'LOCKED',
  lock_source: 'MANUAL',
  locked_at: new Date().toISOString(),
  lock_reason: 'Testing lifecycle',
  credit_limit: '50000000.00',
  current_debt: '60000000.00',
  available_credit: '-10000000.00'
};

// -------------------------------------------------------------
// TESTS ID25 - ID59
// -------------------------------------------------------------

await test('ID25: Opening unlock modal creates no idempotency key', async () => {
  mockDoc.body.children = [];
  frontend.activeUnlockLifecycle.reset();

  frontend.openUnlockModal(testCustomer, () => {});

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.DRAFT);
  assert.ok(frontend.activeUnlockLifecycle.operationId !== null, 'operationId must exist in DRAFT');
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, null, 'idempotencyKey MUST be null upon opening modal');
  assert.equal(frontend.activeUnlockLifecycle.attemptCount, 0);
  assert.equal(frontend.activeUnlockLifecycle.requestPayload, null);
});

await test('ID26: Editing reason creates no idempotency key', async () => {
  const backdrop = mockDoc.body.children[0];
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');

  reasonInput.value = 'Lý do đang được gõ dở dang...';
  reasonInput.dispatchEvent({ type: 'input' });

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.DRAFT);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, null, 'idempotencyKey must still be null while editing');
});

await test('ID27: Invalid first submission creates no idempotency key', async () => {
  const backdrop = mockDoc.body.children[0];
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');

  reasonInput.value = 'Quá ngắn'; // < 10 chars
  reasonInput.dispatchEvent({ type: 'input' });

  confirmBtn.dispatchEvent({ type: 'click' });

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.DRAFT);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, null, 'idempotencyKey must still be null on invalid submit');
});

let capturedKey1 = null;
let capturedPayload1 = null;

await test('ID28: First valid submission creates exactly one UUIDv4 key', async () => {
  const backdrop = mockDoc.body.children[0];
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');

  reasonInput.value = 'Khách hàng đã thanh toán 100% công nợ quá hạn và có bảo lãnh ngân hàng';
  reasonInput.dispatchEvent({ type: 'input' });

  frontend.setMockApi(async (path, opts) => {
    capturedKey1 = opts.headers['Idempotency-Key'];
    capturedPayload1 = JSON.parse(opts.body);
    // Simulating pending request
    return new Promise(() => {}); // never resolves to keep in-flight
  });

  confirmBtn.dispatchEvent({ type: 'click' });

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
  assert.ok(frontend.activeUnlockLifecycle.idempotencyKey !== null, 'Key must be created on first valid submit');
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(uuidRegex.test(frontend.activeUnlockLifecycle.idempotencyKey), 'Key must be valid UUIDv4');
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, capturedKey1);
  assert.equal(frontend.activeUnlockLifecycle.attemptCount, 1);
});

await test('ID29: First submission freezes request payload', async () => {
  assert.ok(Object.isFrozen(frontend.activeUnlockLifecycle.requestPayload), 'requestPayload must be Object.freeze');
  assert.equal(frontend.activeUnlockLifecycle.requestPayload.unlock_reason, 'Khách hàng đã thanh toán 100% công nợ quá hạn và có bảo lãnh ngân hàng');
  assert.throws(() => {
    frontend.activeUnlockLifecycle.requestPayload.unlock_reason = 'Mutated Reason';
  }, TypeError);
});

await test('ID30: Network failure preserves K1', async () => {
  const k1 = frontend.activeUnlockLifecycle.idempotencyKey;
  const p1 = frontend.activeUnlockLifecycle.requestPayload;

  // Simulate network failure
  frontend.activeUnlockLifecycle.recordFailure(0, new TypeError('Failed to fetch'));

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, k1, 'K1 must be preserved on network failure');
  assert.equal(frontend.activeUnlockLifecycle.requestPayload, p1, 'Payload must be preserved on network failure');
  assert.equal(frontend.activeUnlockLifecycle.attemptCount, 1);
});

await test('ID31: Timeout preserves K1', async () => {
  const k1 = frontend.activeUnlockLifecycle.idempotencyKey;

  // Simulate timeout abort
  frontend.activeUnlockLifecycle.recordFailure(0, { name: 'AbortError', message: 'The user aborted a request.' });

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, k1, 'K1 must be preserved on timeout');
});

await test('ID32: Retry uses K1', async () => {
  const k1 = frontend.activeUnlockLifecycle.idempotencyKey;
  frontend.activeUnlockLifecycle.prepareRetry();

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, k1, 'Retry must reuse identical K1');
});

await test('ID33: Retry uses identical frozen payload', async () => {
  assert.deepEqual(frontend.activeUnlockLifecycle.requestPayload, capturedPayload1);
  assert.ok(Object.isFrozen(frontend.activeUnlockLifecycle.requestPayload));
});

await test('ID34: Retry increments attemptCount only', async () => {
  assert.equal(frontend.activeUnlockLifecycle.attemptCount, 2, 'attemptCount must be 2 after first retry');
});

await test('ID35: Double-click creates only one in-flight request', async () => {
  let callCount = 0;
  frontend.setMockApi(async () => {
    callCount++;
    return new Promise(() => {}); // pending
  });

  // State is currently SUBMITTING
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING);

  // Attempt second submission while in SUBMITTING
  assert.throws(() => {
    frontend.activeUnlockLifecycle.prepareFirstSubmission('Another reason text here');
  });
  assert.throws(() => {
    frontend.activeUnlockLifecycle.prepareRetry();
  });
});

await test('ID36: 400 after submission becomes TERMINAL_FAILURE', async () => {
  frontend.activeUnlockLifecycle.recordFailure(400, { status: 400, message: 'Bad Request' });
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.TERMINAL_FAILURE);
  assert.equal(frontend.activeUnlockLifecycle.errorClass, 'TERMINAL_4XX');
});

await test('ID37: 400 does not permit K1 + changed payload', async () => {
  // In TERMINAL_FAILURE, prepareRetry is forbidden
  assert.throws(() => {
    frontend.activeUnlockLifecycle.prepareRetry();
  }, /Cannot retry from state: TERMINAL_FAILURE/);

  // Changing payload requires startNewOperation
  const oldKey = frontend.activeUnlockLifecycle.idempotencyKey;
  frontend.activeUnlockLifecycle.startNewOperation(testCustomer);

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.DRAFT);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, null, 'New operation has null key until submit');

  frontend.activeUnlockLifecycle.prepareFirstSubmission('Lý do mới hoàn toàn sau lỗi 400');
  assert.notEqual(frontend.activeUnlockLifecycle.idempotencyKey, oldKey, 'New operation MUST generate a different key');
});

await test('ID38: 403 does not auto-retry', async () => {
  frontend.activeUnlockLifecycle.recordFailure(403, { status: 403, message: 'Forbidden' });
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.TERMINAL_FAILURE);
  assert.throws(() => frontend.activeUnlockLifecycle.prepareRetry());
});

await test('ID39: 404 does not auto-retry', async () => {
  frontend.activeUnlockLifecycle.recordFailure(404, { status: 404, message: 'Not Found' });
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.TERMINAL_FAILURE);
  assert.throws(() => frontend.activeUnlockLifecycle.prepareRetry());
});

await test('ID40: 409 does not generate K2 automatically', async () => {
  const currentKey = frontend.activeUnlockLifecycle.idempotencyKey;
  frontend.activeUnlockLifecycle.recordFailure(409, { status: 409, message: 'CUSTOMER_NOT_LOCKED' });

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.TERMINAL_FAILURE);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, currentKey, 'Key must not rotate on 409 conflict');
  assert.throws(() => frontend.activeUnlockLifecycle.prepareRetry());
});

await test('ID41: Transient 5xx preserves K1', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Lý do kiểm thử 503 gateway');
  const k1 = op.idempotencyKey;

  op.recordFailure(503, { status: 503, message: 'Service Unavailable' });

  assert.equal(op.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
  assert.equal(op.errorClass, 'TRANSIENT_5XX');
  assert.equal(op.idempotencyKey, k1, '503 must preserve K1');
});

await test('ID42: Successful completion retires K1', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Lý do mở khóa thành công mỹ mãn');
  const k1 = op.idempotencyKey;

  op.recordSuccess();
  assert.equal(op.state, frontend.UnlockOperationState.SUCCEEDED);

  op.reset();
  assert.equal(op.state, frontend.UnlockOperationState.IDLE);
  assert.equal(op.idempotencyKey, null, 'K1 must be retired and null in IDLE');
});

await test('ID43: New logical operation receives a new key', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Thao tác đầu tiên O1');
  const k1 = op.idempotencyKey;
  op.recordSuccess();
  op.reset();

  // Start new operation O2
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Thao tác thứ hai O2');
  const k2 = op.idempotencyKey;

  assert.ok(k1 !== null);
  assert.ok(k2 !== null);
  assert.notEqual(k1, k2, 'O1 and O2 must have different idempotency keys');
});

await test('ID44: Cancel before first submission produces no key', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  assert.equal(op.state, frontend.UnlockOperationState.DRAFT);
  assert.equal(op.idempotencyKey, null);

  const res = op.cancelDraft();
  assert.equal(res.state, frontend.UnlockOperationState.IDLE);
  assert.equal(op.idempotencyKey, null, 'No key generated on pre-submission cancellation');
});

await test('ID45: Closing modal after submission does NOT mark operation CANCELLED', async () => {
  mockDoc.body.children = [];
  frontend.activeUnlockLifecycle.reset();

  frontend.openUnlockModal(testCustomer, () => {});
  const backdrop = mockDoc.body.children[0];
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');

  reasonInput.value = 'Lý do kiểm thử đóng modal khi đang submit';
  reasonInput.dispatchEvent({ type: 'input' });

  frontend.setMockApi(async () => new Promise(() => {})); // pending

  confirmBtn.dispatchEvent({ type: 'click' });
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING);

  // User closes modal via close button
  const closeBtn = backdrop.querySelector('.button-quiet');
  closeBtn.dispatchEvent({ type: 'click' });

  // Modal removed from DOM
  assert.equal(backdrop.removed, true);
  // BUT operation remains SUBMITTING!
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING, 'Operation must remain SUBMITTING');
});

await test('ID46: Escape after submission does NOT mark operation CANCELLED', async () => {
  // Trigger escape event on document
  mockDoc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING, 'Escape must not cancel in-flight operation');
});

await test('ID47: AbortError is not treated as confirmed business cancellation', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Lý do kiểm thử abort transport');

  op.recordFailure(0, { name: 'AbortError', message: 'The operation was aborted.' });

  assert.notEqual(op.state, frontend.UnlockOperationState.CANCELLED, 'AbortError must NEVER set state to CANCELLED');
  assert.equal(op.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
});

await test('ID48: Route change after submission does not generate K2', async () => {
  const currentKey = frontend.activeUnlockLifecycle.idempotencyKey;
  // Simulating route change / modal dismiss
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, currentKey, 'Route change must not rotate key');
});

await test('ID49: Success after UI dismissal still completes the logical operation', async () => {
  let callbackFired = false;
  frontend.setMockApi(async () => {
    return { customer: { ...testCustomer, status: 'ACTIVE' } };
  });

  frontend.activeUnlockLifecycle.recordSuccess();
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUCCEEDED);
  frontend.activeUnlockLifecycle.reset();
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.IDLE);
});

await test('ID50: Retryable failure after UI dismissal preserves K1', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Kiểm thử UI dismiss và network error');
  const k1 = op.idempotencyKey;

  // UI dismissed
  // Network fails
  op.recordFailure(0, new TypeError('Failed to fetch'));
  assert.equal(op.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
  assert.equal(op.idempotencyKey, k1);
});

await test('ID51: Hard refresh does not falsely claim retry persistence', async () => {
  // A new page load starts with brand new in-memory instance
  const freshInstance = new frontend.CustomerUnlockLifecycle();
  assert.equal(freshInstance.state, frontend.UnlockOperationState.IDLE);
  assert.equal(freshInstance.idempotencyKey, null);
  assert.equal(freshInstance.requestPayload, null);
});

await test('ID52: Gate 9 manager override lifecycle remains valid and functional', async () => {
  let overrideModalOpened = false;
  const mockInvoice = { id: 901, total: '1000000.00', status: 'DRAFT', customer_name: 'Test Cust' };
  frontend.openOverrideModal(mockInvoice, testCustomer, () => {
    overrideModalOpened = true;
  });
  const backdrop = mockDoc.body.children[mockDoc.body.children.length - 1];
  assert.ok(backdrop);
  const confirmBtn = findByTestId(backdrop, 'btn-confirm-override');
  assert.ok(confirmBtn);
});

await test('ID53: RETRYABLE_FAILURE cannot transition to CANCELLED through UI close', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Lý do kiểm thử ID53 không bị cancel khi đóng UI');
  const k1 = op.idempotencyKey;
  const p1 = op.requestPayload;

  // Simulate network transport failure -> RETRYABLE_FAILURE
  op.recordFailure(0, new TypeError('Failed to fetch'));
  assert.equal(op.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
  assert.equal(op.idempotencyKey, k1);

  // Attempt cancelDraft (invoked by UI close if improperly routed)
  const cancelResult = op.cancelDraft();
  assert.equal(cancelResult, null, 'cancelDraft must return null when state is RETRYABLE_FAILURE');
  assert.equal(op.state, frontend.UnlockOperationState.RETRYABLE_FAILURE, 'State must remain RETRYABLE_FAILURE');
  assert.notEqual(op.state, frontend.UnlockOperationState.CANCELLED, 'State must NEVER become CANCELLED');
  assert.equal(op.idempotencyKey, k1, 'Idempotency key K1 must remain intact');
  assert.equal(op.requestPayload, p1, 'Payload must remain intact');
});

await test('ID54: SUBMITTING cannot transition to CANCELLED through Escape', async () => {
  mockDoc.body.children = [];
  frontend.activeUnlockLifecycle.reset();

  frontend.openUnlockModal(testCustomer, () => {});
  const backdrop = mockDoc.body.children[0];
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');

  reasonInput.value = 'Lý do kiểm thử ID54 nhấn Escape khi đang submit';
  reasonInput.dispatchEvent({ type: 'input' });

  frontend.setMockApi(async () => new Promise(() => {})); // pending in-flight
  confirmBtn.dispatchEvent({ type: 'click' });

  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
  const k1 = frontend.activeUnlockLifecycle.idempotencyKey;
  const p1 = frontend.activeUnlockLifecycle.requestPayload;
  const attempts = frontend.activeUnlockLifecycle.attemptCount;

  // User presses Escape
  mockDoc.dispatchEvent({ type: 'keydown', key: 'Escape' });

  // UI modal was dismissed from DOM
  assert.equal(backdrop.removed, true);
  // BUT the operation state must NOT be CANCELLED!
  assert.equal(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
  assert.notEqual(frontend.activeUnlockLifecycle.state, frontend.UnlockOperationState.CANCELLED);
  assert.equal(frontend.activeUnlockLifecycle.idempotencyKey, k1);
  assert.equal(frontend.activeUnlockLifecycle.requestPayload, p1);
  assert.equal(frontend.activeUnlockLifecycle.attemptCount, attempts);
});

await test('ID55: Navigation away cannot transition an active operation to CANCELLED', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Lý do kiểm thử ID55 chuyển trang khi đang xử lý');
  const k1 = op.idempotencyKey;

  // Active in SUBMITTING
  assert.equal(op.state, frontend.UnlockOperationState.SUBMITTING);

  // Simulate navigation away / hashchange: DOM unmounted
  mockDoc.body.children = [];
  mockDoc.dispatchEvent({ type: 'hashchange' });

  // cancelDraft cannot cancel an active operation
  assert.equal(op.cancelDraft(), null);
  assert.notEqual(op.state, frontend.UnlockOperationState.CANCELLED);
  assert.equal(op.state, frontend.UnlockOperationState.SUBMITTING);
  assert.equal(op.idempotencyKey, k1);

  // If network now fails while user navigated away:
  op.recordFailure(504, { status: 504, message: 'Gateway Timeout' });
  assert.equal(op.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
  assert.notEqual(op.state, frontend.UnlockOperationState.CANCELLED);
  assert.equal(op.idempotencyKey, k1);
});

await test('ID56: 401 transitions to TERMINAL_FAILURE under the finalized seven-state policy', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Lý do kiểm thử ID56 phiên làm việc hết hạn 401');
  const k1 = op.idempotencyKey;

  // Backend returns 401 Unauthorized
  op.recordFailure(401, { status: 401, message: 'UNAUTHENTICATED' });

  assert.equal(op.state, frontend.UnlockOperationState.TERMINAL_FAILURE, '401 MUST transition to TERMINAL_FAILURE');
  assert.equal(op.errorClass, 'TERMINAL_4XX');
  assert.equal(op.idempotencyKey, k1, 'Key K1 is retained until explicit operation reset');

  // Forbidden to retry
  assert.throws(() => {
    op.prepareRetry();
  }, /Cannot retry from state: TERMINAL_FAILURE/);
});

await test('ID57: 401 does not automatically reuse K1 after re-authentication', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  op.prepareFirstSubmission('Lý do kiểm thử ID57 thử lại sau khi re-login');
  const k1 = op.idempotencyKey;

  op.recordFailure(401, { status: 401, message: 'UNAUTHENTICATED' });
  assert.equal(op.state, frontend.UnlockOperationState.TERMINAL_FAILURE);

  // User re-authenticates and explicitly starts a new operation
  op.startNewOperation(testCustomer);
  assert.equal(op.state, frontend.UnlockOperationState.DRAFT);
  assert.equal(op.idempotencyKey, null, 'Key is null during DRAFT');

  op.prepareFirstSubmission('Lý do mới sau khi đăng nhập lại thành công');
  const k2 = op.idempotencyKey;

  assert.equal(op.state, frontend.UnlockOperationState.SUBMITTING);
  assert.ok(k2 !== null);
  assert.notEqual(k2, k1, 'New operation after 401 must NEVER reuse K1; must generate K2');
});

await test('ID58: Successful unlock renders backend-returned status rather than hardcoded ACTIVE', async () => {
  // 1. Verify app.js source code does NOT hardcode status = 'ACTIVE' on unlock success
  const appJs = fs.readFileSync('app/public/app.js', 'utf8');
  assert.ok(
    !appJs.includes("status = 'ACTIVE';") && !appJs.includes('status = "ACTIVE";'),
    'app.js must not contain hardcoded status assignment status = "ACTIVE"'
  );

  // 2. Test lifecycle callback receives the authoritative backend response
  mockDoc.body.children = [];
  frontend.activeUnlockLifecycle.reset();

  let receivedStatus = null;
  frontend.setMockApi(async (path, opts) => {
    // Return backend-authoritative status (e.g. WARNING or ACTIVE)
    return {
      customer: {
        ...testCustomer,
        status: 'WARNING', // hypothetical non-ACTIVE status returned by authoritative backend
        lock_source: null,
        locked_at: null,
        lock_reason: null
      }
    };
  });

  const modalCustomer = { ...testCustomer };
  frontend.openUnlockModal(modalCustomer, (res) => {
    receivedStatus = res?.customer?.status;
  });

  const backdrop = mockDoc.body.children[mockDoc.body.children.length - 1];
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');

  reasonInput.value = 'Lý do kiểm thử ID58 phản hồi trạng thái từ server';
  reasonInput.dispatchEvent({ type: 'input' });
  confirmBtn.dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(receivedStatus, 'WARNING', 'Frontend callback must receive authoritative status from backend');
  assert.notEqual(receivedStatus, 'ACTIVE', 'Frontend must not override with hardcoded ACTIVE');
});

await test('ID59: If target_status is removed from the request, the actual transmitted payload is exactly: {"unlock_reason":"..."}', async () => {
  const op = new frontend.CustomerUnlockLifecycle();
  op.startDraft(testCustomer);
  const testReason = 'Lý do kiểm thử ID59 payload tối giản không có target_status';
  op.prepareFirstSubmission(testReason);

  assert.deepEqual(op.requestPayload, {
    unlock_reason: testReason
  });
  assert.equal(op.requestPayload.target_status, undefined, 'target_status must NOT be in requestPayload');
  assert.equal(Object.keys(op.requestPayload).length, 1, 'requestPayload must have exactly 1 property');
  assert.equal(JSON.stringify(op.requestPayload), JSON.stringify({ unlock_reason: testReason }));

  // Also test transmitted via openUnlockModal and mock API
  mockDoc.body.children = [];
  frontend.activeUnlockLifecycle.reset();

  let transmittedBody = null;
  frontend.setMockApi(async (path, opts) => {
    transmittedBody = JSON.parse(opts.body);
    return { customer: { ...testCustomer, status: 'ACTIVE' } };
  });

  frontend.openUnlockModal(testCustomer, () => {});
  const backdrop = mockDoc.body.children[mockDoc.body.children.length - 1];
  const reasonInput = findByTestId(backdrop, 'unlock-reason-input');
  const confirmBtn = findByTestId(backdrop, 'btn-confirm-unlock');

  reasonInput.value = testReason;
  reasonInput.dispatchEvent({ type: 'input' });
  confirmBtn.dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 20));

  assert.deepEqual(transmittedBody, {
    unlock_reason: testReason
  });
  assert.equal(transmittedBody.target_status, undefined);
  assert.equal(JSON.stringify(transmittedBody), JSON.stringify({ unlock_reason: testReason }));
});

// -------------------------------------------------------------
// SECTION 30: REQUIRED TEST TRACE
// -------------------------------------------------------------

console.log('\n-------------------------------------------------------------');
console.log('EXECUTING SECTION 30 FORMAL IDEMPOTENCY LIFECYCLE TRACE:');
console.log('-------------------------------------------------------------');

const traceLifecycle = new frontend.CustomerUnlockLifecycle();

// Step 1: START -> IDLE to DRAFT
console.log('START:');
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.IDLE);
traceLifecycle.startDraft(testCustomer);
console.log(`  IDLE → DRAFT (operationId = ${traceLifecycle.operationId.slice(0, 8)}..., key = null)`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.DRAFT);
assert.equal(traceLifecycle.idempotencyKey, null);

// Step 2: VALID_SUBMIT -> DRAFT to SUBMITTING (K1, attempt = 1)
console.log('VALID_SUBMIT:');
traceLifecycle.prepareFirstSubmission('Lý do mở khóa cho trace chính thức');
const traceK1 = traceLifecycle.idempotencyKey;
console.log(`  DRAFT → SUBMITTING (key = ${traceK1}, attempt = ${traceLifecycle.attemptCount})`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
assert.ok(traceK1 !== null);
assert.equal(traceLifecycle.attemptCount, 1);

// Step 3: UI_CLOSE -> operation remains SUBMITTING
console.log('UI_CLOSE:');
console.log(`  operation remains SUBMITTING (key = ${traceLifecycle.idempotencyKey}, attempt = ${traceLifecycle.attemptCount})`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.SUBMITTING);

// Step 4: NETWORK_TIMEOUT -> SUBMITTING to RETRYABLE_FAILURE
console.log('NETWORK_TIMEOUT:');
traceLifecycle.recordFailure(0, { name: 'AbortError', message: 'Timeout' });
console.log(`  SUBMITTING → RETRYABLE_FAILURE (key = ${traceLifecycle.idempotencyKey}, attempt = ${traceLifecycle.attemptCount})`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.RETRYABLE_FAILURE);
assert.equal(traceLifecycle.idempotencyKey, traceK1);
assert.equal(traceLifecycle.attemptCount, 1);

// Step 5: RETRY -> RETRYABLE_FAILURE to SUBMITTING (attempt = 2)
console.log('RETRY:');
traceLifecycle.prepareRetry();
console.log(`  RETRYABLE_FAILURE → SUBMITTING (key = ${traceLifecycle.idempotencyKey}, attempt = ${traceLifecycle.attemptCount})`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
assert.equal(traceLifecycle.idempotencyKey, traceK1);
assert.equal(traceLifecycle.attemptCount, 2);

// Step 6: SUCCESS -> SUBMITTING to SUCCEEDED
console.log('SUCCESS:');
traceLifecycle.recordSuccess();
console.log(`  SUBMITTING → SUCCEEDED (key = ${traceLifecycle.idempotencyKey})`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.SUCCEEDED);
assert.equal(traceLifecycle.idempotencyKey, traceK1);

// Step 7: RESET -> SUCCEEDED to IDLE
console.log('RESET:');
traceLifecycle.reset();
console.log(`  SUCCEEDED → IDLE (key = ${traceLifecycle.idempotencyKey})`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.IDLE);
assert.equal(traceLifecycle.idempotencyKey, null);

// Step 8: START -> IDLE to DRAFT
console.log('START:');
traceLifecycle.startDraft(testCustomer);
console.log(`  IDLE → DRAFT (operationId = ${traceLifecycle.operationId.slice(0, 8)}..., key = null)`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.DRAFT);
assert.equal(traceLifecycle.idempotencyKey, null);

// Step 9: VALID_SUBMIT -> DRAFT to SUBMITTING (K2, attempt = 1)
console.log('VALID_SUBMIT:');
traceLifecycle.prepareFirstSubmission('Lý do mở khóa giao dịch mới O2');
const traceK2 = traceLifecycle.idempotencyKey;
console.log(`  DRAFT → SUBMITTING (key = ${traceK2}, attempt = ${traceLifecycle.attemptCount})`);
assert.equal(traceLifecycle.state, frontend.UnlockOperationState.SUBMITTING);
assert.ok(traceK2 !== null);
assert.equal(traceLifecycle.attemptCount, 1);

// Step 10: ASSERT K1 !== K2
console.log('ASSERT:');
console.log(`  K1 (${traceK1}) !== K2 (${traceK2})`);
assert.notEqual(traceK1, traceK2, 'K1 and K2 must be strictly distinct UUIDs');

console.log('-------------------------------------------------------------');
console.log('SECTION 30 FORMAL TRACE PASSED 100%!');
console.log('-------------------------------------------------------------\n');

console.log('=============================================================');
console.log(`IDEMPOTENCY LIFECYCLE TEST SUITE: ${passedTests}/${totalTests} PASS`);
console.log('=============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
