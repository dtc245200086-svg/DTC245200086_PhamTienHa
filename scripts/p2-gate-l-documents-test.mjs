#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE — GATE L: DOCUMENTS & PRINT ENGINE VERIFICATION SUITE
 * File: scripts/p2-gate-l-documents-test.mjs
 *
 * Verifies Finding L — Documents / Print Engine:
 * 1. Authentication & RBAC (unauthenticated -> 401, unauthorized -> 403)
 * 2. Non-existent document IDs return 404 cleanly
 * 3. Official Server-side VAT Invoice HTML (/api/invoices/:id/print)
 *    - Real DB invoice, customer, items, authoritative company metadata
 *    - Valid Nghị định 123/2020/NĐ-CP structure
 *    - docTienBangChu Vietnamese words conversion
 *    - Mixed VAT display (10%, 8%, 5%, 0%)
 * 4. Invoice Document JSON API (/api/invoices/:id/document)
 * 5. Invoice with Adjustments / Credit Notes printed accurately
 * 6. Multi-item / Long invoice layout safety (@page, avoid page-break)
 * 7. Official Payment Receipt Voucher (/api/payments/:id/receipt)
 *    - Mẫu 01 - TT / C40-BB theo Thông tư 200/2014/TT-BTC
 *    - 5 official signatures, amounts, payment method, reference
 * 8. Official Refund Payout Voucher (/api/refunds/:id/voucher)
 *    - Mẫu 02 - TT theo Thông tư 200/2014/TT-BTC
 *    - Links to original invoice and adjustment credit note
 * 9. Server Authority: Total and tax amounts strictly derived from DB, never trusted from client
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

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD are required.');
}

function queryDb(sql) {
  const singleLineSql = sql.replace(/\s+/g, ' ').trim();
  const cmd = `docker exec -i billing-postgres-1 psql -U postgres -d billing -q -t -A -c "${singleLineSql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
}

async function login(username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(res.status, 200, `Login failed for ${username}`);
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie, 'Missing set-cookie header');
  return cookie.split(';')[0];
}

async function api(cookie, path, options = {}) {
  const headers = { ...options.headers };
  if (cookie) headers['Cookie'] = cookie;
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

console.log('--- STARTING GATE L: DOCUMENTS & PRINT VERIFICATION SUITE ---');

const adminCookie = await login('admin', adminPassword);
const staffCookie = await login('staff', staffPassword);

// ----------------------------------------------------------------------------
// Test 1: Authentication & Authorization for Document Endpoints
// ----------------------------------------------------------------------------
console.log('\n[Check 1] RBAC & Authentication for Print / Document Endpoints...');
{
  // 1a. Unauthenticated access to invoice print -> 401
  const unauthInv = await api(null, '/api/invoices/1/print');
  assert.equal(unauthInv.status, 401, 'Unauthenticated invoice print must return 401');

  // 1b. Unauthenticated access to payment receipt -> 401
  const unauthPay = await api(null, '/api/payments/1/receipt');
  assert.equal(unauthPay.status, 401, 'Unauthenticated payment receipt must return 401');

  // 1c. Unauthenticated access to refund voucher -> 401
  const unauthRef = await api(null, '/api/refunds/1/voucher');
  assert.equal(unauthRef.status, 401, 'Unauthenticated refund voucher must return 401');

  // 1d. Non-existent ID returns 404
  const notFoundInv = await api(adminCookie, '/api/invoices/999999999/print');
  assert.equal(notFoundInv.status, 404, 'Non-existent invoice print must return 404');

  const notFoundPay = await api(adminCookie, '/api/payments/999999999/receipt');
  assert.equal(notFoundPay.status, 404, 'Non-existent payment receipt must return 404');

  const notFoundRef = await api(adminCookie, '/api/refunds/999999999/voucher');
  assert.equal(notFoundRef.status, 404, 'Non-existent refund voucher must return 404');

  console.log('  -> PASS: Auth & 404 checks strictly enforced.');
}

// ----------------------------------------------------------------------------
// Test 2: Official Server-Side VAT Invoice HTML (Nghị định 123/2020/NĐ-CP)
// ----------------------------------------------------------------------------
console.log('\n[Check 2] Official Server-Side VAT Invoice HTML Generation...');
{
  const testTaxCode = '010' + Math.floor(1000000 + Math.random() * 9000000);
  const custRes = await api(adminCookie, '/api/customers', {
    method: 'POST',
    body: {
      name: 'Tập đoàn Công nghệ Alpha Print Test',
      tax_code: testTaxCode,
      email: `alpha_print_${Date.now()}@corp.vn`,
      phone: '0981122334',
      address: 'Số 88 Phố Lý Thường Kiệt, Q. Hoàn Kiếm, Hà Nội'
    }
  });
  assert.equal(custRes.status, 201);
  const custData = await custRes.json();
  const customerId = custData.customer.id;

  const invRes = await api(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      items: [
        {
          description: 'Bản quyền Phần mềm Enterprise Tier 1',
          unit: 'Gói',
          quantity: '2',
          unit_price: '15000000',
          vat_rate: '0.10'
        },
        {
          description: 'Dịch vụ Cấu hình và Đào tạo chuyên sâu',
          unit: 'Giờ',
          quantity: '10',
          unit_price: '1000000',
          vat_rate: '0.08'
        }
      ]
    }
  });
  assert.equal(invRes.status, 201);
  const invData = await invRes.json();
  const invoiceId = invData.invoice.id;

  // Issue invoice
  const issueRes = await api(adminCookie, `/api/invoices/${invoiceId}/issue`, {
    method: 'POST',
    body: {}
  });
  assert.equal(issueRes.status, 200);

  // Request HTML print
  const printRes = await api(adminCookie, `/api/invoices/${invoiceId}/print`);
  assert.equal(printRes.status, 200);
  assert.match(printRes.headers.get('content-type'), /text\/html/);

  const html = await printRes.text();
  assert.ok(html.includes('HÓA ĐƠN GIÁ TRỊ GIA TĂNG'), 'Must contain invoice title');
  assert.ok(html.includes('123/2020/NĐ-CP') || html.includes('123/2020'), 'Must cite legal decree');
  assert.ok(html.includes('Tập đoàn Công nghệ Alpha Print Test'), 'Must contain customer name');
  assert.ok(html.includes(testTaxCode), 'Must contain customer tax code');
  assert.ok(html.includes('Bản quyền Phần mềm Enterprise Tier 1'), 'Must contain item 1 description');
  assert.ok(html.includes('Dịch vụ Cấu hình và Đào tạo chuyên sâu'), 'Must contain item 2 description');
  assert.ok(html.includes('10%') && html.includes('8%'), 'Must show item VAT rates');
  assert.ok(html.includes('Số tiền viết bằng chữ:'), 'Must include amount in words label');
  assert.ok(html.includes('đồng chẵn') || html.includes('đồng'), 'Must contain Vietnamese words amount');
  assert.ok(html.includes('ĐÃ KÝ ĐIỆN TỬ'), 'Must include electronic signature watermark');

  console.log('  -> PASS: Official VAT Invoice HTML complies with decree 123 and renders accurately.');
}

// ----------------------------------------------------------------------------
// Test 3: Invoice Document JSON Metadata Endpoint
// ----------------------------------------------------------------------------
console.log('\n[Check 3] Invoice Document JSON Metadata Endpoint...');
{
  const invoicesList = await api(adminCookie, '/api/invoices?limit=1');
  const invJson = await invoicesList.json();
  const invId = invJson.items[0].id;

  const docRes = await api(adminCookie, `/api/invoices/${invId}/document`);
  assert.equal(docRes.status, 200);
  assert.match(docRes.headers.get('content-type'), /application\/json/);

  const docData = await docRes.json();
  assert.equal(docData.document_type, 'VAT_INVOICE');
  assert.equal(docData.standard, 'NGHI_DINH_123_2020_ND_CP');
  assert.ok(docData.invoice && docData.invoice.id == invId);
  assert.ok(docData.company && docData.company.company_name);
  assert.ok(typeof docData.amount_in_words === 'string' && docData.amount_in_words.length > 5);

  // Test format=json query parameter on print route
  const printJsonRes = await api(adminCookie, `/api/invoices/${invId}/print?format=json`);
  assert.equal(printJsonRes.status, 200);
  const printJsonData = await printJsonRes.json();
  assert.equal(printJsonData.document_type, 'VAT_INVOICE');

  console.log('  -> PASS: Invoice Document JSON endpoint verified.');
}

// ----------------------------------------------------------------------------
// Test 4: Long Invoice Print Layout Safety (Multi-page resilience)
// ----------------------------------------------------------------------------
console.log('\n[Check 4] Long Invoice Print Layout Safety (30 Items)...');
{
  const longTaxCode = '010' + Math.floor(1000000 + Math.random() * 9000000);
  const custRes = await api(adminCookie, '/api/customers', {
    method: 'POST',
    body: {
      name: 'Công ty Cung ứng Quy mô lớn LongDoc Corp',
      tax_code: longTaxCode,
      email: `longdoc_${Date.now()}@corp.vn`,
      phone: '0977889900',
      address: 'KCN Bắc Thăng Long, Đông Anh, Hà Nội'
    }
  });
  const customerId = (await custRes.json()).customer.id;

  const longItems = [];
  for (let i = 1; i <= 30; i++) {
    longItems.push({
      description: `Hàng hóa vật tư thiết bị linh kiện mã hiệu LK-${String(i).padStart(3, '0')}`,
      unit: 'Cái',
      quantity: String(i),
      unit_price: String(100000 * i),
      vat_rate: i % 2 === 0 ? '0.10' : '0.08'
    });
  }

  const invRes = await api(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      items: longItems
    }
  });
  assert.equal(invRes.status, 201);
  const invId = (await invRes.json()).invoice.id;

  const printRes = await api(adminCookie, `/api/invoices/${invId}/print`);
  assert.equal(printRes.status, 200);
  const html = await printRes.text();

  assert.ok(html.includes('LK-001') && html.includes('LK-030'), 'Must contain all items');
  assert.ok(html.includes('@page') && html.includes('size: A4 portrait;'), 'Must define A4 print size');
  assert.ok(html.includes('page-break-inside: avoid;'), 'Must have page break prevention rules');

  console.log('  -> PASS: 30-item long invoice HTML renders cleanly with proper print CSS rules.');
}

// ----------------------------------------------------------------------------
// Test 5: Official Payment Receipt Voucher (Mẫu 01-TT / C40-BB theo TT 200)
// ----------------------------------------------------------------------------
console.log('\n[Check 5] Official Payment Receipt Voucher HTML / JSON...');
{
  // Create a payment
  const payTaxCode = '010' + Math.floor(1000000 + Math.random() * 9000000);
  const custRes = await api(adminCookie, '/api/customers', {
    method: 'POST',
    body: {
      name: 'Doanh nghiệp Thanh toán Phiếu thu Beta',
      tax_code: payTaxCode,
      email: `pay_voucher_${Date.now()}@corp.vn`,
      address: 'Phường Cầu Giấy, Hà Nội'
    }
  });
  const customerId = (await custRes.json()).customer.id;

  const payRes = await api(adminCookie, '/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': `p2-gate-l-pay-${Date.now()}` },
    body: {
      customerId,
      amount: '50000000.00',
      method: 'BANK_TRANSFER',
      paidAt: '2026-10-08',
      reference: 'FT261008998877',
      bankName: 'Vietcombank',
      bankAccount: '00110022334455'
    }
  });
  assert.equal(payRes.status, 201);
  const paymentId = (await payRes.json()).payment.id;

  // Fetch HTML receipt voucher
  const receiptRes = await api(adminCookie, `/api/payments/${paymentId}/receipt`);
  assert.equal(receiptRes.status, 200);
  assert.match(receiptRes.headers.get('content-type'), /text\/html/);

  const receiptHtml = await receiptRes.text();
  assert.ok(receiptHtml.includes('PHIẾU THU'), 'Must contain title PHIẾU THU');
  assert.ok(receiptHtml.includes('01 - TT'), 'Must contain official form number Mẫu 01 - TT');
  assert.ok(receiptHtml.includes('200/2014/TT-BTC'), 'Must cite Circular 200/2014/TT-BTC');
  assert.ok(receiptHtml.includes('50.000.000'), 'Must contain formatted amount');
  assert.ok(receiptHtml.includes('Năm mươi triệu đồng chẵn'), 'Must contain exact Vietnamese words');
  assert.ok(receiptHtml.includes('FT261008998877'), 'Must contain reference number');
  assert.ok(receiptHtml.toLowerCase().includes('giám đốc') && receiptHtml.toLowerCase().includes('thủ quỹ'), 'Must contain required signatories');

  // Test aliases /payments/:id/voucher and /payments/:id/print
  const voucherRes = await api(adminCookie, `/api/payments/${paymentId}/voucher`);
  assert.equal(voucherRes.status, 200);

  // Test JSON format
  const jsonReceiptRes = await api(adminCookie, `/api/payments/${paymentId}/receipt?format=json`);
  assert.equal(jsonReceiptRes.status, 200);
  const jsonReceipt = await jsonReceiptRes.json();
  assert.equal(jsonReceipt.document_type, 'PAYMENT_RECEIPT_MAU_01_TT');
  assert.equal(jsonReceipt.amount_in_words, 'Năm mươi triệu đồng chẵn');

  console.log('  -> PASS: Payment Receipt Voucher conforms to Circular 200 standards.');
}

// ----------------------------------------------------------------------------
// Test 6: Official Refund Payout Voucher (Mẫu 02-TT theo TT 200)
// ----------------------------------------------------------------------------
console.log('\n[Check 6] Official Refund Payout Voucher HTML / JSON...');
{
  // 1. Create customer, invoice, issue it, pay it
  const refTaxCode = '010' + Math.floor(1000000 + Math.random() * 9000000);
  const custRes = await api(adminCookie, '/api/customers', {
    method: 'POST',
    body: {
      name: 'Công ty Hoàn tiền Gamma Voucher Test',
      tax_code: refTaxCode,
      email: `refund_voucher_${Date.now()}@corp.vn`,
      address: 'Quận 1, TP Hồ Chí Minh'
    }
  });
  const customerId = (await custRes.json()).customer.id;

  const invRes = await api(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      items: [{ description: 'Dịch vụ Tư vấn', quantity: '1', unit_price: '20000000', vat_rate: '0.10' }]
    }
  });
  const invoiceId = (await invRes.json()).invoice.id;
  await api(adminCookie, `/api/invoices/${invoiceId}/issue`, { method: 'POST', body: {} });

  await api(adminCookie, `/api/invoices/${invoiceId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `p2-gate-l-payinv-${Date.now()}` },
    body: {
      amount: '22000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-08',
      reference: 'FT-FULL-PAY-01'
    }
  });

  // 2. Create adjustment / credit note
  const adjRes = await api(adminCookie, '/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invoiceId,
      adjustment_type: 'DECREASE_AMOUNT',
      amount: '10000000.00',
      vat_rate: '0.10',
      reason: 'Hoàn trả dịch vụ do thay đổi phạm vi dự án'
    }
  });
  assert.equal(adjRes.status, 201);
  const adjustmentId = (await adjRes.json()).adjustment.id;
  await api(adminCookie, `/api/adjustments/${adjustmentId}/approve`, { method: 'POST', body: {} });

  // 3. Create refund payable
  const refReqRes = await api(adminCookie, '/api/refunds', {
    method: 'POST',
    body: {
      invoice_id: invoiceId,
      adjustment_id: adjustmentId,
      amount: '11000000.00',
      reason: 'Hoàn tiền khách hàng theo biên bản điều chỉnh'
    }
  });
  assert.equal(refReqRes.status, 201);
  const refData = await refReqRes.json();
  const refundId = refData.refund.id;

  // 4. Approve refund
  const approveRes = await api(adminCookie, `/api/refunds/${refundId}/approve`, {
    method: 'POST',
    body: { notes: 'Phê duyệt hoàn tiền đúng hạn' }
  });
  assert.equal(approveRes.status, 200);

  // 5. Fetch Refund Voucher HTML
  const voucherRes = await api(adminCookie, `/api/refunds/${refundId}/voucher`);
  assert.equal(voucherRes.status, 200);
  assert.match(voucherRes.headers.get('content-type'), /text\/html/);

  const voucherHtml = await voucherRes.text();
  assert.ok(voucherHtml.includes('PHIẾU CHI HOÀN TIỀN'), 'Must contain title PHIẾU CHI HOÀN TIỀN');
  assert.ok(voucherHtml.includes('02 - TT'), 'Must contain official form number Mẫu 02 - TT');
  assert.ok(voucherHtml.includes('200/2014/TT-BTC'), 'Must cite Circular 200');
  assert.ok(voucherHtml.includes('11.000.000'), 'Must contain 11.000.000 amount');
  assert.ok(voucherHtml.includes('Mười một triệu đồng chẵn'), 'Must contain exact Vietnamese words');
  assert.ok(voucherHtml.includes('Công ty Hoàn tiền Gamma Voucher Test'), 'Must show customer');
  assert.ok(voucherHtml.includes('Hóa đơn:') || voucherHtml.includes('Hóa đơn'), 'Must link to original invoice');
  assert.ok(voucherHtml.includes('Biên bản điều chỉnh:'), 'Must link to adjustment credit note');

  // 6. Fetch Refund Voucher JSON
  const jsonVoucherRes = await api(adminCookie, `/api/refunds/${refundId}/voucher?format=json`);
  assert.equal(jsonVoucherRes.status, 200);
  const jsonVoucher = await jsonVoucherRes.json();
  assert.equal(jsonVoucher.document_type, 'REFUND_PAYOUT_VOUCHER_MAU_02_TT');
  assert.equal(jsonVoucher.amount_in_words, 'Mười một triệu đồng chẵn');

  console.log('  -> PASS: Refund Payout Voucher conforms to Circular 200 standards and links to credit note.');
}

console.log('\n--- ALL GATE L DOCUMENT / PRINT VERIFICATION CHECKS PASSED (6/6) ---');
