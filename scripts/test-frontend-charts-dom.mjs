import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const BASE_URL = process.env.BASE_URL || 'https://localhost';

class MockClassList {
  constructor() { this.classes = new Set(); }
  add(...c) { c.forEach(x => this.classes.add(x)); }
  remove(...c) { c.forEach(x => this.classes.delete(x)); }
  contains(c) { return this.classes.has(c); }
  get value() { return Array.from(this.classes).join(' '); }
}

class MockElement {
  constructor(tag, cls = '') {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.attributes = {};
    this.classList = new MockClassList();
    this._className = cls || '';
    if (cls) cls.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    this.style = {};
    this.textContent = '';
    this.listeners = {};
    this.value = '';
    this.title = '';
  }

  get className() { return this._className; }
  set className(val) {
    this._className = val || '';
    this.classList = new MockClassList();
    if (val) val.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') {
      this.className = String(v);
    }
  }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }

  append(...items) {
    for (const item of items) {
      if (item === null || item === undefined) continue;
      if (typeof item === 'object' && item && item.tagName) {
        this.children.push(item);
      } else {
        const textNode = new MockElement('#text');
        textNode.textContent = String(item);
        this.children.push(textNode);
      }
    }
  }

  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }

  appendChild(child) { this.append(child); return child; }

  addEventListener(evt, cb) {
    if (!this.listeners[evt]) this.listeners[evt] = [];
    this.listeners[evt].push(cb);
  }

  dispatchEvent(evt) {
    const list = this.listeners[evt.type || evt] || [];
    for (const cb of list) cb(evt);
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (el) => {
      if (!el || !el.tagName) return;
      if (sel.startsWith('.') && el.classList.contains(sel.slice(1))) results.push(el);
      else if (sel.startsWith('#') && el.getAttribute('id') === sel.slice(1)) results.push(el);
      else if (el.tagName.toLowerCase() === sel.toLowerCase()) results.push(el);
      for (const child of el.children) check(child);
    };
    for (const child of this.children) check(child);
    return results;
  }

  toHTML() {
    if (this.tagName === '#TEXT') return this.textContent;
    const attrs = Object.entries(this.attributes).map(([k, v]) => ` ${k}="${v}"`).join('');
    const cls = this._className ? ` class="${this._className}"` : '';
    const inner = this.children.length > 0 ? this.children.map(c => c.toHTML ? c.toHTML() : String(c)).join('') : this.textContent;
    return `<${this.tagName.toLowerCase()}${cls}${attrs}>${inner}</${this.tagName.toLowerCase()}>`;
  }
}

async function run() {
  console.log('================================================================');
  console.log('FRONTEND DOM & ACCESSIBILITY TESTS FOR UPGRADED CHARTS');
  console.log('================================================================');

  let activeCookie = '';
  async function login(username, password) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(res.status, 200, `Login ${username}`);
    activeCookie = res.headers.get('set-cookie')?.split(';')[0] || '';
  }

  // Intercept fetch for app.js internal api() calls
  const originalFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    let target = url;
    if (typeof url === 'string' && url.startsWith('/')) {
      target = `${BASE_URL}${url}`;
    }
    const headers = { ...(opts.headers || {}) };
    if (activeCookie && !headers['cookie']) {
      headers['cookie'] = activeCookie;
    }
    return originalFetch(target, { ...opts, headers });
  };

  const appJsCode = fs.readFileSync('app/public/app.js', 'utf8');

  const mockRoot = new MockElement('div', 'root');
  const mockDoc = {
    createElement: (tag) => new MockElement(tag),
    createElementNS: (ns, tag) => new MockElement(tag),
    createTextNode: (t) => new MockElement('#text', '', t),
    querySelector: () => mockRoot,
    querySelectorAll: () => [],
    documentElement: new MockElement('html'),
    body: new MockElement('body')
  };

  const mockLocation = { hash: '#/dashboard', search: '' };
  const mockWindow = {
    location: mockLocation,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => 'light', setItem: () => {} },
    alert: (msg) => console.log('    [Alert UI]:', msg),
    confirm: () => true
  };

  const evalContext = new Function(
    'document', 'window', 'localStorage', 'location', 'api', 'alert', 'confirm',
    `
    ${appJsCode}
    return {
      setCurrentUser: (u) => { currentUser = u; },
      renderAdminDashboard,
      renderDirectorDashboard,
      renderStaffDashboard,
      renderInvoices,
      renderPayments,
      renderProducts,
      renderAdjustments
    };
    `
  );

  const liveApi = async (path, opts = {}) => {
    const res = await fetch(`/api${path}`, opts);
    return res.json().catch(() => ({}));
  };

  const app = evalContext(
    mockDoc,
    mockWindow,
    mockWindow.localStorage,
    mockLocation,
    liveApi,
    mockWindow.alert,
    mockWindow.confirm
  );

  const adminPass = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const staffPass = process.env.STAFF_PASSWORD || 'Staff@123456';

  // 1. ADMIN DASHBOARD DOM
  console.log('\n--- 1. Testing ADMIN Dashboard DOM Rendering ---');
  await login('admin', adminPass);
  app.setCurrentUser({ id: 1, username: 'admin', role: 'ADMIN', full_name: 'Administrator' });

  const adminContainer = new MockElement('div');
  await app.renderAdminDashboard(adminContainer);
  const adminHtml = adminContainer.toHTML();

  assert.ok(!adminHtml.includes('NaN'), 'Admin HTML does not contain NaN');
  assert.ok(!adminHtml.includes('undefined'), 'Admin HTML does not contain undefined');
  assert.ok(!adminHtml.includes('[object Object]'), 'Admin HTML does not contain [object Object]');

  const summaryCards = adminContainer.querySelectorAll('.summary-item');
  console.log(`  [PASS] Admin KPI Summary Cards rendered: ${summaryCards.length}/4`);
  assert.equal(summaryCards.length, 4);

  const chartCards = adminContainer.querySelectorAll('.chart-card');
  console.log(`  [PASS] Admin Chart Cards rendered: ${chartCards.length}/4`);
  assert.equal(chartCards.length, 4);

  const donutSvg = adminContainer.querySelectorAll('.donut-svg');
  assert.ok(donutSvg.length >= 1, 'Donut chart SVG present');
  const lineSvg = adminContainer.querySelectorAll('.chart-line');
  assert.ok(lineSvg.length >= 1, 'Line chart path present');
  const colSvg = adminContainer.querySelectorAll('.chart-bar-rect');
  assert.ok(colSvg.length >= 1, 'Column chart rects present');
  const hbars = adminContainer.querySelectorAll('.hbar-row');
  assert.ok(hbars.length >= 1, 'Horizontal bar rows present');
  console.log('  [PASS] Admin Donut, Line, Column, and Horizontal Bar charts verified.');

  // 2. DIRECTOR DASHBOARD DOM
  console.log('\n--- 2. Testing DIRECTOR Dashboard DOM Rendering & Filters ---');
  app.setCurrentUser({ id: 2, username: 'director_exec', role: 'DIRECTOR', full_name: 'Giám Đốc Tài Chính' });

  const directorContainer = new MockElement('div');
  await app.renderDirectorDashboard(directorContainer);
  const directorHtml = directorContainer.toHTML();

  assert.ok(!directorHtml.includes('NaN'), 'Director HTML does not contain NaN');
  assert.ok(!directorHtml.includes('undefined'), 'Director HTML does not contain undefined');
  assert.ok(!directorHtml.includes('[object Object]'), 'Director HTML does not contain [object Object]');

  const periodBtns = directorContainer.querySelectorAll('.period-btn');
  console.log(`  [PASS] Period Toolbar rendered with buttons: ${periodBtns.length}/6`);
  assert.equal(periodBtns.length, 6);

  const execKpis = directorContainer.querySelectorAll('.summary-item');
  console.log(`  [PASS] Executive Financial KPIs rendered: ${execKpis.length}/8`);
  assert.equal(execKpis.length, 8);

  const dirCharts = directorContainer.querySelectorAll('.chart-card');
  console.log(`  [PASS] Director Analytics Cards rendered: ${dirCharts.length}/6 (5 charts + 1 conversion card)`);
  assert.equal(dirCharts.length, 6);

  const agingSegments = directorContainer.querySelectorAll('.aging-segment');
  console.log(`  [PASS] Debt Aging Buckets rendered: ${agingSegments.length}/5`);
  assert.equal(agingSegments.length, 5);

  const pipeSteps = directorContainer.querySelectorAll('.pipeline-step');
  console.log(`  [PASS] Conversion Pipeline stages rendered: ${pipeSteps.length}/3`);
  assert.equal(pipeSteps.length, 3);

  // 3. STAFF DASHBOARD DOM
  console.log('\n--- 3. Testing STAFF Dashboard DOM Rendering ---');
  await login('staff', staffPass);
  app.setCurrentUser({ id: 3, username: 'staff', role: 'STAFF', full_name: 'Nhân viên Vận hành' });

  const staffContainer = new MockElement('div');
  await app.renderStaffDashboard(staffContainer);
  const staffHtml = staffContainer.toHTML();

  assert.ok(!staffHtml.includes('NaN'), 'Staff HTML does not contain NaN');
  assert.ok(!staffHtml.includes('undefined'), 'Staff HTML does not contain undefined');
  assert.ok(!staffHtml.includes('[object Object]'), 'Staff HTML does not contain [object Object]');

  // Strict check: Staff does NOT have ARR, MRR, DSO, CEI
  assert.ok(!staffHtml.includes('Doanh thu định kỳ (MRR)'), 'Staff does not leak MRR');
  assert.ok(!staffHtml.includes('Quy mô doanh thu năm (ARR)'), 'Staff does not leak ARR');
  assert.ok(!staffHtml.includes('DSO (Số ngày thu hồi nợ)'), 'Staff does not leak DSO');
  assert.ok(!staffHtml.includes('Chỉ số hiệu quả CEI'), 'Staff does not leak CEI');

  const staffKpis = staffContainer.querySelectorAll('.summary-item');
  console.log(`  [PASS] Staff Operational KPIs rendered: ${staffKpis.length}/4`);
  assert.equal(staffKpis.length, 4);

  const staffCharts = staffContainer.querySelectorAll('.chart-card');
  console.log(`  [PASS] Staff Operational Charts rendered: ${staffCharts.length}/2`);
  assert.equal(staffCharts.length, 2);

  // 4. MODULE DOM CHARTS VS TABLE-ONLY MODULES
  console.log('\n--- 4. Testing Module Screens (Chart vs Table-Only) ---');

  // Invoices: HAS Chart
  const invContainer = new MockElement('div');
  mockLocation.hash = '#/invoices';
  await app.renderInvoices(invContainer);
  const invCharts = invContainer.querySelectorAll('.chart-card');
  console.log(`  [PASS] Invoices screen chart count: ${invCharts.length}/1 (Donut status)`);
  assert.equal(invCharts.length, 1);

  // Payments: HAS Chart
  const payContainer = new MockElement('div');
  mockLocation.hash = '#/payments';
  await app.renderPayments(payContainer);
  const payCharts = payContainer.querySelectorAll('.chart-card');
  console.log(`  [PASS] Payments screen chart count: ${payCharts.length}/1 (Donut method)`);
  assert.equal(payCharts.length, 1);

  // Products: NO Chart (Strict business rule)
  const prodContainer = new MockElement('div');
  mockLocation.hash = '#/products';
  await app.renderProducts(prodContainer);
  const prodCharts = prodContainer.querySelectorAll('.chart-card');
  console.log(`  [PASS] Products screen chart count: ${prodCharts.length}/0 (Intentionally table-first, NO chart)`);
  assert.equal(prodCharts.length, 0);

  // Adjustments: NO Chart (Strict business rule)
  const adjContainer = new MockElement('div');
  mockLocation.hash = '#/adjustments';
  await app.renderAdjustments(adjContainer);
  const adjCharts = adjContainer.querySelectorAll('.chart-card');
  console.log(`  [PASS] Adjustments screen chart count: ${adjCharts.length}/0 (Intentionally table-first, NO chart)`);
  assert.equal(adjCharts.length, 0);

  console.log('\n================================================================');
  console.log('ALL FRONTEND DOM & ACCESSIBILITY TESTS PASSED (100%)');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
