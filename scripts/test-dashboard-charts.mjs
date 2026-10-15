import assert from 'node:assert/strict';
import https from 'node:https';
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
const agent = new https.Agent({ rejectUnauthorized: false });

async function api(path, options = {}) {
  const url = `${BASE_URL}/api${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

async function login(username, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const cookie = res.headers.get('set-cookie');
  assert.ok(res.ok, `Login failed for ${username}: ${res.status}`);
  assert.ok(cookie, 'Missing cookie on login');
  return cookie.split(';')[0];
}

async function run() {
  console.log('============================================================');
  console.log('TESTING DASHBOARDS & BUSINESS CHARTS');
  console.log('============================================================');

  const adminPass = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const staffPass = process.env.STAFF_PASSWORD || 'Staff@123456';

  // 1. ADMIN DASHBOARD
  console.log('\n--- 1. Testing ADMIN Dashboard Analytics ---');
  const adminCookie = await login('admin', adminPass);

  const adminRes = await fetch(`${BASE_URL}/api/dashboard/admin-analytics`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(adminRes.status, 200, 'Admin analytics status 200');
  const adminData = await adminRes.json();

  console.log('Admin User Roles:', adminData.user_roles);
  assert.ok(Array.isArray(adminData.user_roles), 'user_roles is array');
  assert.ok(adminData.user_roles.some(r => r.role === 'ADMIN'), 'Has ADMIN role');
  assert.ok(adminData.user_roles.some(r => r.role === 'DIRECTOR'), 'Has DIRECTOR role');
  assert.ok(adminData.user_roles.some(r => r.role === 'STAFF'), 'Has STAFF role');

  console.log('Admin System Activity (14d count):', adminData.system_activity?.length);
  assert.ok(Array.isArray(adminData.system_activity), 'system_activity is array');
  adminData.system_activity.forEach(a => {
    assert.ok(!isNaN(Number(a.count)), `count is NaN: ${a.count}`);
  });

  console.log('Admin Monthly Invoices (12m count):', adminData.invoice_volume?.length);
  assert.ok(Array.isArray(adminData.invoice_volume), 'invoice_volume is array');
  adminData.invoice_volume.forEach(v => {
    assert.ok(!isNaN(Number(v.count)), `count is NaN: ${v.count}`);
  });

  console.log('Admin Module Activity:', adminData.module_activity?.length);
  assert.ok(Array.isArray(adminData.module_activity), 'module_activity is array');

  console.log('Admin Security Events:', adminData.security_events);
  console.log('Admin Total Audit Events:', adminData.total_audit_events);
  assert.ok(!isNaN(Number(adminData.security_events)));
  assert.ok(!isNaN(Number(adminData.total_audit_events)));
  assert.ok(Array.isArray(adminData.recent_audits));
  console.log('[PASS] ADMIN analytics endpoint verified successfully.');

  // 2. DIRECTOR DASHBOARD (Periods test)
  console.log('\n--- 2. Testing DIRECTOR Dashboard Analytics (Periods & Integrity) ---');
  const periods = ['7d', '30d', '3m', '6m', '12m', 'all'];

  for (const p of periods) {
    const directorRes = await fetch(`${BASE_URL}/api/dashboard/director-analytics?period=${p}`, {
      headers: { Cookie: adminCookie } // Admin has full director analytics access or can view
    });
    assert.equal(directorRes.status, 200, `Director analytics status 200 for period ${p}`);
    const dData = await directorRes.json();

    assert.ok(dData.kpis, 'KPIs present');
    const { revenue, collected, receivables, overdue_amount, dso, cei, mrr, arr } = dData.kpis;
    [revenue, collected, receivables, overdue_amount, dso, cei, mrr, arr].forEach(val => {
      assert.ok(val !== null && val !== undefined && !isNaN(Number(val)), `KPI value invalid: ${val}`);
    });

    assert.ok(Array.isArray(dData.revenue_trend), 'revenue_trend array');
    assert.ok(Array.isArray(dData.status_distribution), 'status_distribution array');
    assert.ok(Array.isArray(dData.monthly_stacked), 'monthly_stacked array');
    assert.ok(dData.aging, 'aging present');
    ['current_amount', 'bucket1_30', 'bucket31_60', 'bucket61_90', 'bucket_over90', 'total_receivable'].forEach(k => {
      assert.ok(!isNaN(Number(dData.aging[k])), `aging.${k} is NaN`);
    });
    assert.ok(Array.isArray(dData.top_customers), 'top_customers array');
    assert.ok(dData.pipeline, 'pipeline present');
    ['total_issued', 'payment_active', 'fully_settled'].forEach(k => {
      assert.ok(!isNaN(Number(dData.pipeline[k])), `pipeline.${k} is NaN`);
    });

    console.log(`[PASS] Period ${p.padEnd(4)}: Revenue=${Number(revenue).toLocaleString()} | Collected=${Number(collected).toLocaleString()} | Receivables=${Number(receivables).toLocaleString()} | DSO=${dso} | CEI=${cei}%`);
  }

  // 3. STAFF DASHBOARD
  console.log('\n--- 3. Testing STAFF Dashboard Analytics ---');
  const staffCookie = await login('staff', staffPass);
  const staffRes = await fetch(`${BASE_URL}/api/dashboard/staff-analytics`, {
    headers: { Cookie: staffCookie }
  });
  assert.equal(staffRes.status, 200, 'Staff analytics status 200');
  const staffData = await staffRes.json();

  assert.ok(staffData.workload, 'Staff workload present');
  console.log('Staff Workload:', staffData.workload);
  assert.ok(!isNaN(Number(staffData.workload.draft_invoices)));
  assert.ok(!isNaN(Number(staffData.workload.issued_invoices)));
  assert.ok(!isNaN(Number(staffData.workload.overdue_invoices)));
  assert.ok(!isNaN(Number(staffData.workload.unallocated_payments)));
  assert.ok(!isNaN(Number(staffData.workload.unmatched_bank_txs)));
  assert.ok(!isNaN(Number(staffData.workload.pending_adjustments)));

  assert.ok(Array.isArray(staffData.invoice_status), 'invoice_status is array');
  assert.ok(Array.isArray(staffData.urgent_invoices), 'urgent_invoices is array');

  // Strict check: Staff endpoint does NOT leak executive financial metrics
  assert.strictEqual(staffData.mrr, undefined);
  assert.strictEqual(staffData.arr, undefined);
  assert.strictEqual(staffData.dso, undefined);
  console.log('[PASS] STAFF operational analytics verified with zero executive metric leaks.');

  // 4. MODULE-SPECIFIC ANALYTICS ENDPOINTS
  console.log('\n--- 4. Testing Module-Specific Analytics ---');
  const invRes = await fetch(`${BASE_URL}/api/dashboard/invoices-analytics`, { headers: { Cookie: adminCookie } });
  assert.equal(invRes.status, 200);
  const invData = await invRes.json();
  assert.ok(Array.isArray(invData.statuses));
  console.log('Invoices Analytics Statuses:', invData.statuses.map(s => `${s.status}: ${s.count}`).join(', '));

  const payRes = await fetch(`${BASE_URL}/api/dashboard/payments-analytics`, { headers: { Cookie: adminCookie } });
  assert.equal(payRes.status, 200);
  const payData = await payRes.json();
  assert.ok(Array.isArray(payData.methods));
  console.log('Payments Methods:', payData.methods.map(m => `${m.method}: ${m.count}`).join(', '));

  const recRes = await fetch(`${BASE_URL}/api/dashboard/reconciliation-analytics`, { headers: { Cookie: adminCookie } });
  assert.equal(recRes.status, 200);
  const recData = await recRes.json();
  assert.ok(Array.isArray(recData.statuses));
  console.log('Reconciliation Statuses:', recData.statuses.map(r => `${r.status}: ${r.count}`).join(', '));

  console.log('\n============================================================');
  console.log('ALL DASHBOARD & CHART BACKEND SUITES PASSED (100%)');
  console.log('============================================================\n');
}

run().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
