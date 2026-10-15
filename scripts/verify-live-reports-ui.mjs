import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function loadEnv() {
  const envPath = path.resolve(REPO_ROOT, '.env');
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

const baseUrl = process.env.BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  console.error('Missing ADMIN_PASSWORD in environment.');
  process.exit(1);
}

// 1. Authenticate with live system
const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword })
});

if (loginRes.status !== 200) {
  console.error(`Login failed with status ${loginRes.status}`);
  process.exit(1);
}

const cookie = loginRes.headers.get('set-cookie');

// 2. Fetch served app.js from container
const appJsRes = await fetch(`${baseUrl}/app.js`);
const appJs = await appJsRes.text();

// 3. Fetch real live data for the 4 report endpoints
const endpoints = {
  '/reports/aging': await (await fetch(`${baseUrl}/api/reports/aging`, { headers: { cookie } })).json(),
  '/reports/collection-metrics': await (await fetch(`${baseUrl}/api/reports/collection-metrics`, { headers: { cookie } })).json(),
  '/reports/revenue-analytics': await (await fetch(`${baseUrl}/api/reports/revenue-analytics`, { headers: { cookie } })).json(),
  '/reports/vat-declaration': await (await fetch(`${baseUrl}/api/reports/vat-declaration`, { headers: { cookie } })).json()
};

// 4. Create DOM mock to execute the served bundle
class MockNode {
  constructor(tag = '') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.childNodes = [];
    this.children = [];
  }
  appendChild(child) {
    this.childNodes.push(child);
    if (child instanceof MockNode) {
      this.children.push(child);
    }
    return child;
  }
  append(...children) {
    for (const c of children) {
      if (typeof c === 'string') {
        this.appendChild(new MockTextNode(c));
      } else {
        this.appendChild(c);
      }
    }
  }
  get textContent() {
    return this.childNodes.map(c => c.textContent).join('');
  }
  set textContent(val) {
    this.childNodes = [new MockTextNode(val)];
    this.children = [];
  }
  querySelector(sel) { return null; }
  querySelectorAll(sel) {
    const results = [];
    const walk = (n) => {
      if (sel.startsWith('.') && n.className && n.className.split(' ').includes(sel.slice(1))) {
        results.push(n);
      }
      for (const child of n.children) walk(child);
    };
    walk(this);
    return results;
  }
  addEventListener() {}
}

class MockTextNode {
  constructor(text) {
    this.text = String(text);
  }
  get textContent() {
    return this.text;
  }
}

global.Node = MockNode;
global.document = {
  querySelector: () => new MockNode('div'),
  createElement: (tag) => new MockNode(tag),
  createTextNode: (text) => new MockTextNode(text),
  documentElement: {
    setAttribute: () => {},
    getAttribute: () => 'light'
  }
};
global.window = {
  ...global,
  addEventListener: () => {}
};
global.localStorage = {
  getItem: () => null,
  setItem: () => {}
};
global.location = { hash: '#/reports?tab=aging' };
global.fetch = async (url) => {
  const ep = url.replace('/api', '');
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => endpoints[ep] || {}
  };
};

// 5. Evaluate the served app.js
const fn = new Function('global', 'window', 'document', 'Node', 'location', 'localStorage', 'fetch', appJs + '\nreturn { renderReports, node };');
const exported = fn(global, global.window, global.document, global.Node, global.location, global.localStorage, global.fetch);

console.log('================================================================');
console.log('  BILLING_ONE LIVE FINANCIAL REPORTS KPI CARD VALIDATION (E2E)  ');
console.log('================================================================');

const tabs = [
  { id: 'aging', name: 'Ma trận tuổi nợ (Aging Matrix)' },
  { id: 'collection', name: 'Chỉ số thu hồi (DSO / CEI)' },
  { id: 'revenue', name: 'Doanh thu & MRR / ARR' },
  { id: 'vat', name: 'Bảng kê thuế GTGT (Mẫu 01-1)' }
];

let totalCards = 0;
let passedCards = 0;
let bugDetected = false;

for (const tab of tabs) {
  global.location.hash = `#/reports?tab=${tab.id}`;
  const content = new MockNode('div');
  await exported.renderReports(content);

  const cards = content.querySelectorAll('.summary-item');
  console.log(`\n--- TAB: ${tab.name.toUpperCase()} (Found: ${cards.length} KPI Cards) ---`);

  cards.forEach((card, idx) => {
    totalCards++;
    const text = card.textContent;
    const hasObjectBug = text.includes('[object HTML') || text.includes('[object Object]');
    if (hasObjectBug) {
      bugDetected = true;
      console.log(`  [FAIL] Card #${idx + 1} (${card.className}): ${text}`);
    } else {
      passedCards++;
      // Parse label and value
      const label = card.children[0]?.textContent || '';
      const value = card.children[1]?.textContent || '';
      console.log(`  [PASS] Card #${idx + 1} [${card.className.trim()}] -> Label: "${label}" | Value: "${value}"`);
    }
  });
}

console.log('\n================================================================');
console.log(`TOTAL KPI CARDS VERIFIED: ${passedCards}/${totalCards}`);
console.log(`[object HTMLDivElement] PRESENT: ${bugDetected ? 'YES (FAIL)' : 'NO (ALL CLEAN)'}`);
console.log('================================================================');

if (bugDetected || passedCards !== 16) {
  process.exit(1);
} else {
  process.exit(0);
}
