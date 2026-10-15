import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('============================================================');
console.log('TESTING FRONTEND WORKSPACE DISTINCTION & RENDERING');
console.log('============================================================\n');

// Mock DOM
class MockElement {
  constructor(tag, className = '', text = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.textContent = text ? String(text) : '';
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof MockElement) {
        this.children.push(n);
      } else if (typeof n === 'string' || typeof n === 'number') {
        this.children.push(new MockElement('text', '', String(n)));
      }
    }
  }
  prepend(...nodes) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n instanceof MockElement) this.children.unshift(n);
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
  removeEventListener() {}
  remove() { this.removed = true; }
  querySelector(sel) {
    for (const c of this.children) {
      if (c.className && c.className.includes(sel.replace('.', ''))) return c;
      const sub = c.querySelector?.(sel);
      if (sub) return sub;
    }
    return null;
  }
  querySelectorAll(sel) {
    const res = [];
    const walk = (el) => {
      if (el.className && el.className.includes(sel.replace('.', ''))) res.push(el);
      for (const c of el.children) walk(c);
    };
    walk(this);
    return res;
  }
}

const mockRoot = new MockElement('div', 'root');
const mockDoc = {
  createElement: (tag) => new MockElement(tag),
  createTextNode: (t) => new MockElement('text', '', t),
  querySelector: () => mockRoot,
  documentElement: new MockElement('html'),
  body: new MockElement('body')
};

const appJsCode = fs.readFileSync('app/public/app.js', 'utf8');

// Load sandbox
const sandbox = {
  document: mockDoc,
  window: { location: { hash: '' }, addEventListener: () => {} },
  localStorage: { getItem: () => 'light', setItem: () => {} },
  location: { hash: '' },
  currentUser: null,
  api: async (url) => {
    if (url.startsWith('/dashboard/summary')) {
      return { collected: 1000000, outstanding: 500000, overdue_count: 3, by_status: { PAID: 10, DRAFT: 2, ISSUED: 4 } };
    }
    if (url.startsWith('/users')) {
      return { items: [{ id: 1, username: 'admin', role: 'admin', is_active: true }], total: 1 };
    }
    if (url.startsWith('/audit')) {
      return { items: [{ id: 1, action: 'LOGIN', created_at: new Date().toISOString() }] };
    }
    if (url.startsWith('/reports/revenue-analytics')) {
      return { total_invoiced: 2000000, recurring_mrr: 100000, recurring_arr: 1200000 };
    }
    if (url.startsWith('/reports/collection-metrics')) {
      return { dso: 25.5, cei: 98.2 };
    }
    if (url.startsWith('/reports/aging')) {
      return { overdue_total: 300000 };
    }
    if (url.startsWith('/adjustments')) {
      return { items: [] };
    }
    if (url.startsWith('/invoices')) {
      return { items: [] };
    }
    if (url.startsWith('/rbac/roles')) {
      return { items: [{ id: 1, code: 'admin' }, { id: 2, code: 'staff' }, { id: 3, code: 'ROLE_BILLING_MANAGER' }] };
    }
    if (url.startsWith('/rbac/permissions')) {
      return { items: [{ id: 1, code: 'invoice.create', module: 'invoices' }] };
    }
    return {};
  },
  alert: () => {},
  confirm: () => true
};

const evalContext = new Function(
  'document', 'window', 'localStorage', 'location', 'api', 'alert', 'confirm',
  `
  ${appJsCode}
  return {
    setCurrentUser: (u) => { currentUser = u; },
    getCurrentUser: () => currentUser,
    renderShell,
    renderDashboard,
    renderUsers,
    renderRoles,
    getEffectiveRole
  };
  `
);

const env = evalContext(
  mockDoc,
  sandbox.window,
  sandbox.localStorage,
  sandbox.location,
  sandbox.api,
  sandbox.alert,
  sandbox.confirm
);

function collectAllText(el) {
  let txt = el.textContent || '';
  for (const c of el.children) {
    txt += ' ' + collectAllText(c);
  }
  return txt;
}

globalThis.fetch = async (url) => {
  const path = url.replace('https://localhost', '').replace('/api', '');
  let data = {};
  if (path.startsWith('/dashboard/summary')) {
    data = { collected: 1000000, outstanding: 500000, overdue_count: 3, by_status: { PAID: 10, DRAFT: 2, ISSUED: 4 } };
  } else if (path.startsWith('/users')) {
    data = { items: [{ id: 1, username: 'admin', role: 'admin', is_active: true, full_name: 'Administrator', email: 'admin@system.local' }], total: 1 };
  } else if (path.startsWith('/audit/verify')) {
    data = { valid: true, total_records: 100 };
  } else if (path.startsWith('/audit')) {
    data = { items: [{ id: 1, action: 'LOGIN', created_at: new Date().toISOString() }] };
  } else if (path.startsWith('/reports/revenue-analytics')) {
    data = { total_invoiced: 2000000, recurring_mrr: 100000, recurring_arr: 1200000 };
  } else if (path.startsWith('/reports/collection-metrics')) {
    data = { dso: 25.5, cei: 98.2 };
  } else if (path.startsWith('/reports/aging')) {
    data = { overdue_total: 300000 };
  } else if (path.startsWith('/adjustments')) {
    data = { items: [{ id: 1, credit_note_no: 'CR-001', original_invoice_id: 10, total_amount: 50000, reason: 'Test Discount' }] };
  } else if (path.startsWith('/invoices')) {
    data = { items: [{ id: 10, invoice_no: 'INV-001', customer_name: 'Acme Corp', total: 100000, status: 'ISSUED' }] };
  } else if (path.startsWith('/rbac/roles')) {
    data = { items: [{ id: 1, code: 'admin', title: 'Admin' }, { id: 2, code: 'staff', title: 'Staff' }, { id: 3, code: 'ROLE_BILLING_MANAGER', title: 'Billing Manager' }] };
  } else if (path.startsWith('/rbac/permissions')) {
    data = { items: [{ id: 1, code: 'invoice.create', module: 'invoices', description: 'Tạo hóa đơn' }] };
  }
  return {
    ok: true,
    status: 200,
    json: async () => data
  };
};

let passed = 0;
let total = 0;
async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

// 1. Role Detection
await test('1. getEffectiveRole identifies ADMIN, DIRECTOR, and STAFF', () => {
  assert.equal(env.getEffectiveRole({ role: 'admin' }), 'ADMIN');
  assert.equal(env.getEffectiveRole({ role: 'ADMIN' }), 'ADMIN');
  assert.equal(env.getEffectiveRole({ role: 'director' }), 'DIRECTOR');
  assert.equal(env.getEffectiveRole({ role: 'ROLE_BILLING_MANAGER' }), 'DIRECTOR');
  assert.equal(env.getEffectiveRole({ role: 'staff' }), 'STAFF');
});

// 2. ADMIN Workspace Shell & Sidebar
await test('2. ADMIN Workspace renders dedicated Admin sidebar and topbar', () => {
  env.setCurrentUser({ id: 1, username: 'admin', role: 'admin', permissions: ['*'] });
  const content = env.renderShell('/');
  const shellText = collectAllText(mockRoot);

  assert.ok(shellText.includes('Billing Admin'), 'Brand name must be Billing Admin');
  assert.ok(shellText.includes('HỆ THỐNG & NGƯỜI DÙNG'), 'Has HỆ THỐNG & NGƯỜI DÙNG section');
  assert.ok(shellText.includes('Quản lý người dùng'), 'Has Quản lý người dùng link');
  assert.ok(shellText.includes('Vai trò & Phân quyền'), 'Has Vai trò & Phân quyền link');
  assert.ok(shellText.includes('Nhật ký kiểm toán'), 'Has Nhật ký kiểm toán link');
  assert.ok(shellText.includes('Cấu hình hệ thống'), 'Has Cấu hình hệ thống link');
  assert.ok(shellText.includes('Quản trị hệ thống (ADMIN)'), 'Topbar shows ADMIN');
});

// 3. DIRECTOR Workspace Shell & Sidebar
await test('3. DIRECTOR Workspace renders Executive sidebar with approvals and financial focus', () => {
  env.setCurrentUser({ id: 2, username: 'director_user', role: 'director', permissions: ['invoice.issue_override', 'adjustment.approve'] });
  const content = env.renderShell('/');
  const shellText = collectAllText(mockRoot);

  assert.ok(shellText.includes('Billing Executive'), 'Brand name must be Billing Executive');
  assert.ok(shellText.includes('ĐIỀU HÀNH'), 'Has ĐIỀU HÀNH section');
  assert.ok(shellText.includes('Doanh thu'), 'Has Doanh thu link');
  assert.ok(shellText.includes('Công nợ'), 'Has Công nợ link');
  assert.ok(shellText.includes('DSO / CEI'), 'Has DSO / CEI link');
  assert.ok(shellText.includes('Aging Matrix'), 'Has Aging Matrix link');
  assert.ok(shellText.includes('Phê duyệt'), 'Has Phê duyệt link');
  assert.ok(shellText.includes('Điều hành doanh nghiệp (DIRECTOR)'), 'Topbar shows DIRECTOR');

  // Must NOT have admin-only menu items
  assert.ok(!shellText.includes('Quản lý người dùng'), 'DIRECTOR must not see Quản lý người dùng');
  assert.ok(!shellText.includes('Cấu hình hệ thống'), 'DIRECTOR must not see Cấu hình hệ thống');
  assert.ok(!shellText.includes('Nhật ký kiểm toán'), 'DIRECTOR must not see Nhật ký kiểm toán');
});

// 4. STAFF Workspace Shell & Sidebar
await test('4. STAFF Workspace renders Operations sidebar without admin or executive privileges', () => {
  env.setCurrentUser({ id: 3, username: 'staff_user', role: 'staff', permissions: ['invoice.create', 'payment.create'] });
  const content = env.renderShell('/');
  const shellText = collectAllText(mockRoot);

  assert.ok(shellText.includes('Billing Operations'), 'Brand name must be Billing Operations');
  assert.ok(shellText.includes('TỔNG QUAN'), 'Has TỔNG QUAN section');
  assert.ok(shellText.includes('KINH DOANH & BÁN HÀNG'), 'Has KINH DOANH & BÁN HÀNG section');
  assert.ok(shellText.includes('THU NỢ & ĐỐI SOÁT'), 'Has THU NỢ & ĐỐI SOÁT section');
  assert.ok(shellText.includes('Nghiệp vụ vận hành (STAFF)'), 'Topbar shows STAFF');

  // Must NOT have admin or director-only menu items
  assert.ok(!shellText.includes('Quản lý người dùng'), 'STAFF must not see Quản lý người dùng');
  assert.ok(!shellText.includes('Vai trò & Phân quyền'), 'STAFF must not see Vai trò & Phân quyền');
  assert.ok(!shellText.includes('Cấu hình hệ thống'), 'STAFF must not see Cấu hình hệ thống');
  assert.ok(!shellText.includes('Nhật ký kiểm toán'), 'STAFF must not see Nhật ký kiểm toán');
  assert.ok(!shellText.includes('DSO / CEI'), 'STAFF must not see DSO / CEI menu');
  assert.ok(!shellText.includes('Aging Matrix'), 'STAFF must not see Aging Matrix menu');
});

// 5. ADMIN Dashboard Rendering
await test('5. ADMIN Dashboard renders system health, user stats, audit and security cards', async () => {
  env.setCurrentUser({ id: 1, username: 'admin', role: 'admin', permissions: ['*'] });
  const content = new MockElement('main');
  await env.renderDashboard(content);
  const text = collectAllText(content);

  assert.ok(text.includes('Tổng quan Quản trị Hệ thống'), 'Heading matches Admin dashboard');
  assert.ok(text.includes('Trạng thái hệ thống'), 'Has system status card');
  assert.ok(text.includes('Tài khoản người dùng'), 'Has user accounts card');
  assert.ok(text.includes('Bảo mật & Chuỗi kiểm toán'), 'Has security audit card');
  assert.ok(text.includes('Thao tác Quản trị'), 'Has admin actions panel');
});

// 6. DIRECTOR Dashboard Rendering
await test('6. DIRECTOR Dashboard renders 8 executive financial KPIs and pending approvals queue', async () => {
  env.setCurrentUser({ id: 2, username: 'director_user', role: 'ROLE_BILLING_MANAGER', permissions: ['adjustment.approve'] });
  const content = new MockElement('main');
  await env.renderDashboard(content);
  const text = collectAllText(content);

  assert.ok(text.includes('Điều hành Doanh nghiệp'), 'Heading matches Director dashboard');
  assert.ok(text.includes('Tổng doanh thu xuất HĐ'), 'Has revenue KPI');
  assert.ok(text.includes('Tiền đã thu thực tế'), 'Has collected KPI');
  assert.ok(text.includes('Tổng công nợ phải thu'), 'Has debt KPI');
  assert.ok(text.includes('Nợ quá hạn'), 'Has overdue KPI');
  assert.ok(text.includes('DSO (Kỳ thu tiền bq)'), 'Has DSO KPI');
  assert.ok(text.includes('CEI (Hiệu quả thu hồi)'), 'Has CEI KPI');
  assert.ok(text.includes('MRR (Doanh thu tháng)'), 'Has MRR KPI');
  assert.ok(text.includes('ARR (Quy mô năm)'), 'Has ARR KPI');
  assert.ok(text.includes('Biên bản điều chỉnh chờ Giám đốc phê duyệt'), 'Has approvals panel');
});

// 7. STAFF Dashboard Rendering
await test('7. STAFF Dashboard renders operational work items and action shortcuts', async () => {
  env.setCurrentUser({ id: 3, username: 'staff_user', role: 'staff', permissions: ['invoice.create'] });
  const content = new MockElement('main');
  await env.renderDashboard(content);
  const text = collectAllText(content);

  assert.ok(text.includes('Tổng quan Nghiệp vụ Vận hành'), 'Heading matches Staff dashboard');
  assert.ok(text.includes('Hóa đơn cần xử lý'), 'Has invoices to process KPI');
  assert.ok(text.includes('Khách hàng đang phục vụ'), 'Has customers KPI');
  assert.ok(text.includes('Hóa đơn gần đây'), 'Has recent invoices panel');
  assert.ok(text.includes('Thao tác Vận hành'), 'Has operational actions panel');
});

// 8. User Management UI Rendering
await test('8. Users Management UI renders table and action buttons', async () => {
  env.setCurrentUser({ id: 1, username: 'admin', role: 'admin', permissions: ['*'] });
  const content = new MockElement('main');
  await env.renderUsers(content);
  const text = collectAllText(content);

  assert.ok(text.includes('Quản lý Người dùng & Phân quyền'), 'Has users heading');
  assert.ok(text.includes('+ Tạo tài khoản mới'), 'Has create user button');
  assert.ok(text.includes('Danh sách Người dùng Hệ thống'), 'Has users table');
  assert.ok(text.includes('admin'), 'Renders admin user');
});

// 9. Role & Permission Management UI Rendering
await test('9. Roles & Permissions UI renders 3 tiers and permissions matrix', async () => {
  env.setCurrentUser({ id: 1, username: 'admin', role: 'admin', permissions: ['*'] });
  const content = new MockElement('main');
  await env.renderRoles(content);
  const text = collectAllText(content);

  assert.ok(text.includes('Vai trò & Phân quyền'), 'Has roles heading');
  assert.ok(text.includes('Cấp 1: ADMIN'), 'Has tier 1 card');
  assert.ok(text.includes('Cấp 2: DIRECTOR'), 'Has tier 2 card');
  assert.ok(text.includes('Cấp 3: STAFF'), 'Has tier 3 card');
  assert.ok(text.includes('Quản lý Hóa đơn & Phát hành (Invoices)'), 'Has invoice permissions module');
});

// 10. DIRECTOR Sidebar Active State Verification at #/reports?tab=revenue
await test('10. DIRECTOR Sidebar: ONLY "Báo cáo tài chính" is active at #/reports?tab=revenue', () => {
  env.setCurrentUser({ id: 2, username: 'director_user', role: 'director', permissions: ['invoice.issue_override', 'adjustment.approve'] });
  env.renderShell('/reports?tab=revenue');

  const links = mockRoot.querySelectorAll('.nav-link');
  assert.ok(links.length > 0, 'Found sidebar navigation links');

  const activeLinks = links.filter(l => l.getAttribute('aria-current') === 'page' || (l.className && l.className.includes('active')));
  
  // Exactly 1 link must be active
  assert.equal(activeLinks.length, 1, `Expected exactly 1 active link, got ${activeLinks.length}`);
  
  const activeLabel = collectAllText(activeLinks[0]).trim();
  assert.equal(activeLabel, 'Báo cáo tài chính', `Active link must be "Báo cáo tài chính", got "${activeLabel}"`);
  assert.equal(activeLinks[0].getAttribute('href'), '#/reports');

  // Verify specified items are NOT active
  const shouldNotBeActive = [
    'Tổng quan',
    'Doanh thu',
    'Công nợ',
    'Thu hồi nợ',
    'DSO / CEI',
    'Aging Matrix',
    'MRR / ARR',
    'Xuất báo cáo',
    'Hóa đơn',
    'Khách hàng',
    'Thanh toán',
    'Đối soát',
    'Phê duyệt'
  ];

  for (const label of shouldNotBeActive) {
    const item = links.find(l => collectAllText(l).trim() === label);
    assert.ok(item, `Link "${label}" must exist in DIRECTOR sidebar`);
    assert.equal(item.getAttribute('aria-current'), null, `Link "${label}" must NOT have aria-current="page"`);
    assert.ok(!item.className.includes('active'), `Link "${label}" must NOT have active class`);
  }

  // Check route '/' -> 'Tổng quan' active
  env.renderShell('/');
  const linksRoot = mockRoot.querySelectorAll('.nav-link');
  const activeRoot = linksRoot.filter(l => l.getAttribute('aria-current') === 'page' || (l.className && l.className.includes('active')));
  assert.equal(activeRoot.length, 1);
  assert.equal(collectAllText(activeRoot[0]).trim(), 'Tổng quan');

  // Check route '/invoices' -> 'Hóa đơn' active
  env.renderShell('/invoices');
  const linksInv = mockRoot.querySelectorAll('.nav-link');
  const activeInv = linksInv.filter(l => l.getAttribute('aria-current') === 'page' || (l.className && l.className.includes('active')));
  assert.equal(activeInv.length, 1);
  assert.equal(collectAllText(activeInv[0]).trim(), 'Hóa đơn');

  // Check route '/reports?tab=aging' -> 'Báo cáo tài chính' active
  env.renderShell('/reports?tab=aging');
  const linksAging = mockRoot.querySelectorAll('.nav-link');
  const activeAging = linksAging.filter(l => l.getAttribute('aria-current') === 'page' || (l.className && l.className.includes('active')));
  assert.equal(activeAging.length, 1);
  assert.equal(collectAllText(activeAging[0]).trim(), 'Báo cáo tài chính');
});

// 11. CSS Check: No blanket role color on un-selected navigation links
await test('11. CSS Check: Role color applies strictly to .active / [aria-current="page"] only', () => {
  const css = fs.readFileSync('app/public/styles.css', 'utf8');

  // Must not have blanket background applied to all .nav-link in director workspace
  assert.ok(!css.match(/\.director-workspace\s+\.nav-link\s*\{[^}]*background/i), 'Must not apply blanket background to .director-workspace .nav-link');
  assert.ok(!css.match(/\.workspace-director\s+\.nav-link\s*\{[^}]*background/i), 'Must not apply blanket background to .workspace-director .nav-link');

  // Active state role accents are properly defined
  assert.ok(css.includes('.workspace-director .nav-link.active') || css.includes('.director-workspace .nav-link.active'), 'Must have role accent for active director nav link');
  assert.ok(css.includes('var(--role-director)'), 'Uses --role-director token');
});

console.log('\n============================================================');
console.log(`FRONTEND WORKSPACES SUITE: ALL ${passed}/${total} TESTS PASSED (100%)`);
console.log('============================================================\n');
