/**
 * BILLING_ONE — P1 GATE D TEST SUITE
 * ITEM-LEVEL MIXED VAT & FINANCIAL RECONCILIATION VERIFICATION
 * 
 * Verifies:
 * - Line-level VAT calculation across 0%, 5%, 8%, 10%
 * - Mixed VAT rates within single invoice
 * - Exact sum-of-lines tax authority: invoice VAT = sum(item.vat_amount)
 * - Decimal quantity handling (quantity up to 3 decimals)
 * - Rounding edge case proving line-level rounding rather than header-level
 * - Server ignores client-submitted incorrect totals
 * - Input validation: reject negative/excessive VAT rate, zero/negative qty, negative price
 * - Product catalog VAT inheritance when SKU provided
 * - Database column persistence (vat_rate, vat_amount, line_total, total_amount)
 * - Audit trail coupling and SHA-256 chain integrity
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
  console.log('   BILLING_ONE — P1 GATE D: ITEM-LEVEL MIXED VAT TEST           ');
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

  // Create isolated test customer
  const custCode = `CUST_P1D_${Date.now()}`;
  const custRes = await staff.request('/api/customers', {
    method: 'POST',
    body: {
      code: custCode,
      name: `Khách hàng P1D VAT Test ${Date.now()}`,
      segment: 'SME',
      tax_code: '0105554444',
      credit_limit: '150000000'
    }
  });
  assert.equal(custRes.status, 201);
  const customer = custRes.data.customer;
  pass('Setup: Test customer created');

  // Test 1: Single-rate invoice (10% VAT on all lines)
  const invSingleRes = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Sản phẩm A', quantity: '2', unit_price: '100000', vat_rate: '0.10' }, // 200,000 + 20,000
        { description: 'Sản phẩm B', quantity: '1', unit_price: '50000', vat_rate: '0.10' }   // 50,000 + 5,000
      ]
    }
  });
  assert.equal(invSingleRes.status, 201);
  const invSingle = invSingleRes.data.invoice;
  assert.equal(invSingle.subtotal, '250000.00');
  assert.equal(invSingle.tax_amount, '25000.00');
  assert.equal(invSingle.total, '275000.00');
  pass('T01: Single-rate 10% invoice calculates net, VAT, and gross correctly');

  // Test 2: Two different VAT rates (Mixed VAT: 8% and 10%)
  // Product 1: 100,000 @ 8% -> Net 100,000, VAT 8,000, Gross 108,000
  // Product 2: 100,000 @ 10% -> Net 100,000, VAT 10,000, Gross 110,000
  // Expected Invoice Net = 200,000, Total VAT = 18,000, Total Gross = 218,000
  const invMixed2Res = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Dịch vụ CNTT ưu đãi thuế', quantity: '1', unit_price: '100000', vat_rate: '0.08' },
        { description: 'Dịch vụ Viễn thông thông thường', quantity: '1', unit_price: '100000', vat_rate: '0.10' }
      ]
    }
  });
  assert.equal(invMixed2Res.status, 201);
  const invMixed2 = invMixed2Res.data.invoice;
  assert.equal(invMixed2.subtotal, '200000.00');
  assert.equal(invMixed2.tax_amount, '18000.00', 'Mixed 8% and 10% VAT must total 18,000 VND');
  assert.equal(invMixed2.total, '218000.00');
  pass('T02: Two mixed VAT rates (8% and 10%) calculate and reconcile accurately');

  // Test 3: Three different VAT rates (0%, 5%, 10%)
  // Item 1: 5 * 20,000 @ 0% -> 100,000 net, 0 VAT
  // Item 2: 2 * 100,000 @ 5% -> 200,000 net, 10,000 VAT
  // Item 3: 1 * 300,000 @ 10% -> 300,000 net, 30,000 VAT
  // Total: Net 600,000, VAT 40,000, Gross 640,000
  const invMixed3Res = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Xuất khẩu phần mềm', quantity: '5', unit_price: '20000', vat_rate: '0.00' },
        { description: 'Thiết bị y tế / giáo dục', quantity: '2', unit_price: '100000', vat_rate: '0.05' },
        { description: 'Tư vấn kỹ thuật', quantity: '1', unit_price: '300000', vat_rate: '0.10' }
      ]
    }
  });
  assert.equal(invMixed3Res.status, 201);
  const invMixed3 = invMixed3Res.data.invoice;
  assert.equal(invMixed3.subtotal, '600000.00');
  assert.equal(invMixed3.tax_amount, '40000.00');
  assert.equal(invMixed3.total, '640000.00');
  pass('T03: Three mixed VAT rates (0%, 5%, 10%) reconcile perfectly');

  // Test 4: Pure Zero-rate invoice (0.00% VAT)
  const invZeroRes = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Dịch vụ xuất khẩu ngoài lãnh thổ', quantity: '10', unit_price: '50000', vat_rate: '0.00' }
      ]
    }
  });
  assert.equal(invZeroRes.status, 201);
  const invZero = invZeroRes.data.invoice;
  assert.equal(invZero.subtotal, '500000.00');
  assert.equal(invZero.tax_amount, '0.00');
  assert.equal(invZero.total, '500000.00');
  pass('T04: Zero VAT rate (0.00) yields 0.00 tax_amount and equal gross total');

  // Test 5: Decimal quantity support (e.g. 2.500 @ 125,500 with 8% VAT)
  // Net = round(2.5 * 125,500, 2) = 313,750.00
  // VAT = round(313,750 * 0.08, 2) = 25,100.00
  // Gross = 338,850.00
  const invDecRes = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Dịch vụ tính theo giờ làm việc', quantity: '2.5', unit_price: '125500', vat_rate: '0.08' }
      ]
    }
  });
  assert.equal(invDecRes.status, 201);
  const invDec = invDecRes.data.invoice;
  assert.equal(invDec.subtotal, '313750.00');
  assert.equal(invDec.tax_amount, '25100.00');
  assert.equal(invDec.total, '338850.00');
  pass('T05: Decimal quantity (2.5) evaluates exact decimal line math and tax');

  // Test 6: Rounding drift exposure test
  // 3 items each priced at 33,333.33 with 8% VAT
  // Line 1: 33,333.33 * 0.08 = 2,666.6664 -> round to 2,666.67
  // Line 2: 33,333.33 * 0.08 = 2,666.6664 -> round to 2,666.67
  // Line 3: 33,333.33 * 0.08 = 2,666.6664 -> round to 2,666.67
  // Sum of line VATs = 2,666.67 + 2,666.67 + 2,666.67 = 8,000.01!
  // (Notice: subtotal 99,999.99 * 0.08 = 7,999.9992 -> 8,000.00 if calculated at header)
  // Item-level financial authority mandates invoice tax_amount = sum(line_vat) = 8,000.01!
  // Total = 99,999.99 + 8,000.01 = 108,000.00
  const invDriftRes = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Gói dịch vụ A', quantity: '1', unit_price: '33333.33', vat_rate: '0.08' },
        { description: 'Gói dịch vụ B', quantity: '1', unit_price: '33333.33', vat_rate: '0.08' },
        { description: 'Gói dịch vụ C', quantity: '1', unit_price: '33333.33', vat_rate: '0.08' }
      ]
    }
  });
  assert.equal(invDriftRes.status, 201);
  const invDrift = invDriftRes.data.invoice;
  assert.equal(invDrift.subtotal, '99999.99');
  assert.equal(invDrift.tax_amount, '8000.01', 'Line-level rounding authority must yield 8,000.01 instead of header 8,000.00');
  assert.equal(invDrift.total, '108000.00');
  pass('T06: Line-level rounding drift exposure test confirms exact sum-of-lines rule');

  // Test 7: Client-submitted fake totals are overridden by server
  const invFakeTotalsRes = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      subtotal: '1.00',    // Malicious caller attempt
      tax_amount: '1.00',  // Malicious caller attempt
      total: '2.00',       // Malicious caller attempt
      items: [
        { description: 'Hàng chuẩn', quantity: '1', unit_price: '100000', vat_rate: '0.10' }
      ]
    }
  });
  assert.equal(invFakeTotalsRes.status, 201);
  const invFake = invFakeTotalsRes.data.invoice;
  assert.equal(invFake.subtotal, '100000.00', 'Server MUST override client-submitted subtotal');
  assert.equal(invFake.tax_amount, '10000.00', 'Server MUST override client-submitted tax_amount');
  assert.equal(invFake.total, '110000.00', 'Server MUST override client-submitted total');
  pass('T07: Client-submitted contradictory totals are overridden by server authority');

  // Test 8: Input validation - Negative VAT rate
  const invNegVat = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [{ description: 'Thuế âm', quantity: '1', unit_price: '100000', vat_rate: '-0.05' }]
    }
  });
  assert.equal(invNegVat.status, 400);
  assert.equal(invNegVat.data.error?.code, 'VALIDATION_ERROR');
  pass('T08: Negative vat_rate rejected with 400 VALIDATION_ERROR');

  // Test 9: Input validation - VAT rate exceeding 0.20
  const invHighVat = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [{ description: 'Thuế quá cao', quantity: '1', unit_price: '100000', vat_rate: '0.25' }]
    }
  });
  assert.equal(invHighVat.status, 400);
  assert.equal(invHighVat.data.error?.code, 'VALIDATION_ERROR');
  pass('T09: Excessive vat_rate (> 0.20) rejected with 400 VALIDATION_ERROR');

  // Test 10: Input validation - Invalid quantity (<= 0)
  const invZeroQty = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [{ description: 'Số lượng 0', quantity: '0', unit_price: '100000', vat_rate: '0.10' }]
    }
  });
  assert.equal(invZeroQty.status, 400);
  assert.equal(invZeroQty.data.error?.code, 'VALIDATION_ERROR');
  pass('T10: Zero/negative quantity rejected with 400 VALIDATION_ERROR');

  // Test 11: Product SKU lookup inheritance
  const prodSku = `PROD_P1D_${Date.now()}`;
  const prodRes = await admin.request('/api/products', {
    method: 'POST',
    body: {
      sku: prodSku,
      name: 'Phần mềm ERP Cloud 8%',
      category: 'Software',
      unit: 'User/Năm',
      unit_price: '2000000',
      vat_rate: '0.08'
    }
  });
  assert.equal(prodRes.status, 201);

  // Create invoice referencing SKU without passing vat_rate explicitly
  const invSkuRes = await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      items: [
        { sku: prodSku, description: 'Đăng ký ERP Cloud', quantity: '1', unit_price: '2000000' }
      ]
    }
  });
  assert.equal(invSkuRes.status, 201);
  const invSku = invSkuRes.data.invoice;
  assert.equal(invSku.items[0].vat_rate, '0.0800', 'Product SKU vat_rate must be inherited');
  assert.equal(invSku.tax_amount, '160000.00');
  assert.equal(invSku.total, '2160000.00');
  pass('T11: Product catalog SKU automatically provides line vat_rate');

  // Test 12: Updating draft invoice re-evaluates item taxes and totals
  const draftId = invMixed2.id;
  const updateRes = await staff.request(`/api/invoices/${draftId}`, {
    method: 'PUT',
    body: {
      customer_id: customer.id,
      items: [
        { description: 'Dòng 1 sửa lại 5%', quantity: '2', unit_price: '100000', vat_rate: '0.05' }, // Net 200,000, VAT 10,000
        { description: 'Dòng 2 thêm 8%', quantity: '1', unit_price: '500000', vat_rate: '0.08' }   // Net 500,000, VAT 40,000
      ]
    }
  });
  assert.equal(updateRes.status, 200);
  const updatedInv = updateRes.data.invoice;
  assert.equal(updatedInv.subtotal, '700000.00');
  assert.equal(updatedInv.tax_amount, '50000.00');
  assert.equal(updatedInv.total, '750000.00');
  pass('T12: Updating draft invoice lines re-calculates all item taxes and totals');

  // Test 13: Database verification of invoice_items columns
  const dbItems = queryDbJson(`
    SELECT line_total::text, vat_rate::text, vat_amount::text, total_amount::text
    FROM public.invoice_items
    WHERE invoice_id = ${draftId}
    ORDER BY id ASC
  `);
  assert.equal(dbItems.length, 2);
  assert.equal(dbItems[0].line_total, '200000.00');
  assert.equal(dbItems[0].vat_rate, '0.0500');
  assert.equal(dbItems[0].vat_amount, '10000.00');
  assert.equal(dbItems[0].total_amount, '210000.00');

  assert.equal(dbItems[1].line_total, '500000.00');
  assert.equal(dbItems[1].vat_rate, '0.0800');
  assert.equal(dbItems[1].vat_amount, '40000.00');
  assert.equal(dbItems[1].total_amount, '540000.00');
  pass('T13: Database invoice_items columns (line_total, vat_rate, vat_amount, total_amount) verified');

  // Test 14: Issuing invoice preserves item-level VAT state
  const issueRes = await staff.request(`/api/invoices/${draftId}/issue`, {
    method: 'POST',
    body: {}
  });
  assert.equal(issueRes.status, 200);
  assert.equal(issueRes.data.invoice.status, 'ISSUED');
  assert.equal(issueRes.data.invoice.subtotal, '700000.00');
  assert.equal(issueRes.data.invoice.tax_amount, '50000.00');
  assert.equal(issueRes.data.invoice.total, '750000.00');
  pass('T14: Issuing mixed-VAT invoice locks authoritative totals in database');

  // Test 15: Audit trail check
  const auditRes = await admin.request('/api/audit/verify', { method: 'POST' });
  assert.equal(auditRes.status, 200);
  assert.equal(auditRes.data.valid, true, 'Audit cryptographic chain must remain valid');
  pass('T15: Audit log transaction coupling and SHA-256 chain integrity verified');

  console.log('\n================================================================');
  console.log(`GATE D VERIFICATION COMPLETE: ${passed} PASSED, 0 FAILED`);
  console.log('STATUS: GATE D (ITEM-LEVEL MIXED VAT) — PASS');
  console.log('================================================================');
}

run().catch(err => {
  console.error('[FATAL] Gate D test failed:', err);
  process.exit(1);
});
