import assert from 'node:assert/strict';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;
const staffPassword = process.env.STAFF_PASSWORD;

if (!adminPassword || !staffPassword) {
  throw new Error('ADMIN_PASSWORD and STAFF_PASSWORD are required.');
}

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async request(path, { method = 'GET', body } = {}) {
    const headers = new Headers();
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.cookie) headers.set('Cookie', this.cookie);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';', 1)[0];
    }
    const payload = response.status === 204 ? null : await response.json();
    return { response, payload };
  }
}

function check(result, expectedStatus, label) {
  assert.equal(
    result.response.status,
    expectedStatus,
    `${label}: expected HTTP ${expectedStatus}, got ${result.response.status}: ${JSON.stringify(result.payload)}`
  );
  return result.payload;
}

async function run() {
  console.log('=== STARTING EXTENDED FEATURES TEST SUITE ===');
  const admin = new ApiClient();
  const staff = new ApiClient();

  // 1. Auth Admin
  await admin.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword }
  }).then(r => check(r, 200, 'Admin login'));

  // 2. Auth Staff
  await staff.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'staff', password: staffPassword }
  }).then(r => check(r, 200, 'Staff login'));

  const stamp = Date.now();

  // --- FEATURE 1: Product Master Catalog ---
  const sku = `SKU-TEST-${stamp}`;
  const prod = check(await admin.request('/api/products', {
    method: 'POST',
    body: {
      sku,
      name: `Test Product ${stamp}`,
      category: 'Cloud Infrastructure',
      unit: 'Tháng',
      unit_price: '25000000.00',
      vat_rate: '0.10',
      description: 'Dedicated test cloud server',
      status: 'ACTIVE'
    }
  }), 201, 'Create product').product;
  assert.equal(prod.sku, sku);
  assert.equal(prod.unit_price, '25000000.00');

  // Verify duplicate SKU rejected
  const dupSku = check(await admin.request('/api/products', {
    method: 'POST',
    body: {
      sku,
      name: 'Duplicate',
      unit_price: '100.00'
    }
  }), 409, 'Duplicate SKU rejected');
  assert.equal(dupSku.error.code, 'PRODUCT_SKU_EXISTS');

  // Verify list & search product
  const prodList = check(await admin.request(`/api/products?q=${encodeURIComponent(sku)}`), 200, 'Search product');
  assert.ok(prodList.items.some(p => p.sku === sku));
  console.log('PASS: Feature 1 - Product Master Catalog');

  // --- FEATURE 2: Payment Terms ---
  const termCode = `TERM_${stamp}`;
  const term = check(await admin.request('/api/payment-terms', {
    method: 'POST',
    body: {
      code: termCode,
      name: `Net 45 Days ${stamp}`,
      days: 45,
      grace_period_days: 5,
      late_penalty_rate: 1.5,
      early_discount_percent: 1.0,
      early_discount_days: 10,
      description: 'Standard 45 days credit'
    }
  }), 201, 'Create payment term').term;
  assert.equal(term.code, termCode);
  assert.equal(term.days, 45);

  const termList = check(await admin.request('/api/payment-terms'), 200, 'List payment terms');
  assert.ok(termList.items.some(t => t.code === termCode));
  console.log('PASS: Feature 2 - Payment Terms Policies');

  // --- FEATURE 3: Customer Financial Profile & Credit Limit ---
  const custName = `Enterprise Client ${stamp}`;
  const customer = check(await admin.request('/api/customers', {
    method: 'POST',
    body: {
      name: custName,
      email: `client-${stamp}@enterprise.vn`,
      phone: '0912345678',
      address: 'Keangnam 72, Hà Nội',
      tax_code: `010${stamp.toString().slice(-7)}`,
      code: `CUST-${stamp.toString().slice(-4)}`,
      contact_person: 'Nguyễn Văn A (CFO)',
      segment: 'Enterprise',
      credit_limit: '100000000.00',
      payment_term_id: term.id
    }
  }), 201, 'Create customer with financial profile').customer;
  assert.equal(customer.segment, 'Enterprise');
  assert.equal(customer.credit_limit, '100000000.00');

  const finProfile = check(await admin.request(`/api/customers/${customer.id}/financial-profile`), 200, 'Read customer financial profile');
  assert.equal(finProfile.profile.credit_limit, '100000000.00');
  assert.equal(finProfile.profile.current_debt, '0.00');
  console.log('PASS: Feature 3 - Customer Credit & Financial Profile');

  // --- FEATURE 4: Enhanced Invoice with SKUs & Discounts ---
  const invoice1 = check(await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      due_date: '2027-06-30',
      tax_rate: '0.10',
      items: [
        {
          sku: prod.sku,
          description: prod.name,
          unit: 'Tháng',
          quantity: '2.000',
          unit_price: '25000000.00',
          discount_percent: '10.00' // 10% discount: 50M * 0.9 = 45M + 4.5M VAT = 49.5M total
        }
      ]
    }
  }), 201, 'Create draft with SKU and discount').invoice;
  assert.equal(invoice1.subtotal, '45000000.00');
  assert.equal(invoice1.tax_amount, '4500000.00');
  assert.equal(invoice1.total, '49500000.00');

  const invoice2 = check(await staff.request('/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      due_date: '2027-07-15',
      tax_rate: '0.10',
      items: [
        {
          description: 'Additional technical support',
          quantity: '1.000',
          unit_price: '10000000.00',
          discount_percent: '0.00'
        }
      ]
    }
  }), 201, 'Create second draft').invoice;
  assert.equal(invoice2.total, '11000000.00');

  // Issue both invoices
  const issued1 = check(await staff.request(`/api/invoices/${invoice1.id}/issue`, { method: 'POST', body: {} }), 200, 'Issue invoice 1').invoice;
  assert.match(issued1.invoice_no, /^INV-\d{4}-\d{6}$/);
  assert.ok(issued1.e_invoice_code);

  const issued2 = check(await staff.request(`/api/invoices/${invoice2.id}/issue`, { method: 'POST', body: {} }), 200, 'Issue invoice 2').invoice;
  console.log('PASS: Feature 4 - Enhanced Invoices with SKUs & Discount Calculation');

  // Verify debt update on customer profile
  const updatedProfile = check(await admin.request(`/api/customers/${customer.id}/financial-profile`), 200, 'Check updated debt profile');
  const expectedDebt = (49500000 + 11000000).toFixed(2);
  assert.equal(updatedProfile.profile.current_debt, expectedDebt);

  // --- FEATURE 5: Multi-Invoice Payment Allocation ---
  // Pay 30,000,000 for invoice 1 and 11,000,000 (full) for invoice 2
  const allocRes = check(await staff.request('/api/payments/allocate', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      total_amount: '41000000.00',
      method: 'BANK_TRANSFER',
      paid_at: '2026-10-06',
      reference: `ALLOC-TEST-${stamp}`,
      bank_name: 'Techcombank',
      bank_account: '19036788889999',
      allocations: [
        { invoice_id: invoice1.id, amount: '30000000.00' },
        { invoice_id: invoice2.id, amount: '11000000.00' }
      ]
    }
  }), 201, 'Multi-invoice payment allocation');

  assert.equal(allocRes.payment.amount, '41000000.00');
  const inv1Updated = allocRes.updatedInvoices.find(i => i.id === invoice1.id);
  const inv2Updated = allocRes.updatedInvoices.find(i => i.id === invoice2.id);
  assert.equal(inv1Updated.status, 'PARTIALLY_PAID');
  assert.equal(inv1Updated.paid_total, '30000000.00');
  assert.equal(inv2Updated.status, 'PAID');
  assert.equal(inv2Updated.paid_total, '11000000.00');
  console.log('PASS: Feature 5 - Multi-Invoice Payment Allocation');

  // --- FEATURE 6: Financial Reports (Aging Matrix, DSO, Revenue, VAT) ---
  const agingReport = check(await admin.request('/api/reports/aging'), 200, 'Aging report');
  assert.ok(agingReport.summary.total_receivable);
  assert.ok(Array.isArray(agingReport.customers));

  const collectionMetrics = check(await admin.request('/api/reports/collection-metrics'), 200, 'Collection metrics');
  assert.ok(typeof collectionMetrics.dso === 'number');
  assert.ok(typeof collectionMetrics.cei === 'number');

  const revenueReport = check(await admin.request('/api/reports/revenue'), 200, 'Revenue analytics');
  assert.ok(revenueReport.mrr);
  assert.ok(revenueReport.arr);
  assert.ok(Array.isArray(revenueReport.monthly_revenue));

  const vatReport = check(await admin.request('/api/reports/vat'), 200, 'VAT compliance report');
  assert.ok(vatReport.summary.total_net);
  assert.ok(vatReport.summary.total_vat);
  console.log('PASS: Feature 6 - Financial Reports (Aging, DSO, Revenue, VAT)');

  // --- FEATURE 7: Invoice Adjustments & Credit Notes ---
  const creditNote = check(await staff.request('/api/adjustments', {
    method: 'POST',
    body: {
      original_invoice_id: invoice1.id,
      adjustment_type: 'DISCOUNT',
      amount: '5000000.00',
      vat_rate: '0.10',
      reason: 'Biên bản chiết khấu thương mại thanh toán đúng hạn',
      notes: 'Thỏa thuận thương mại đợt 1'
    }
  }), 201, 'Create draft credit note').adjustment;
  assert.match(creditNote.credit_note_no, /^ADJ-\d{4}-\d{4}$/);
  assert.equal(creditNote.status, 'DRAFT');
  assert.equal(creditNote.total_amount, '5500000.00');

  // Staff cannot approve credit note
  check(await staff.request(`/api/adjustments/${creditNote.id}/approve`, { method: 'POST', body: {} }), 403, 'Staff credit note approve denied');

  // Admin approves credit note
  const approvedNote = check(await admin.request(`/api/adjustments/${creditNote.id}/approve`, { method: 'POST', body: {} }), 200, 'Admin approves credit note').adjustment;
  assert.equal(approvedNote.status, 'APPROVED');

  // Admin processes credit note
  const processedNote = check(await admin.request(`/api/adjustments/${creditNote.id}/process`, { method: 'POST', body: {} }), 200, 'Admin processes credit note').adjustment;
  assert.equal(processedNote.status, 'PROCESSED');
  console.log('PASS: Feature 7 - Invoice Adjustments & Credit Notes');

  // --- FEATURE 8: Recurring Plans & Subscription Engine ---
  const plan = check(await admin.request('/api/recurring-plans', {
    method: 'POST',
    body: {
      customer_id: customer.id,
      service_title: 'Dịch vụ Thuê bao Máy chủ Cloud v2',
      contract_ref: `CTR-REC-${stamp}`,
      frequency: 'Hàng tháng',
      amount_per_period: '15000000.00',
      next_run_date: '2026-11-01',
      total_cycles: 12,
      auto_sign: true
    }
  }), 201, 'Create recurring plan').plan;
  assert.match(plan.code, /^REC-\d{4}-\d{4}$/);
  assert.equal(plan.status, 'ACTIVE');

  // Trigger recurring execution
  const triggered = check(await admin.request(`/api/recurring-plans/${plan.id}/trigger`, { method: 'POST', body: {} }), 200, 'Trigger recurring plan run').result;
  assert.equal(triggered.completed_cycles, 1);
  assert.equal(triggered.next_run_date, '2026-12-01');
  assert.match(triggered.invoice_no, /^INV-\d{4}-\d{6}$/);
  console.log('PASS: Feature 8 - Recurring Billing Engine & Automation');

  // --- FEATURE 9: Bank Statement Matching & Reconciliation ---
  const bankTx = check(await admin.request('/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-06',
      description: `CONG TY ${customer.name.slice(0, 8)} THANH TOAN CUOC CLOUD`,
      amount: '10000000.00',
      tx_type: 'CREDIT',
      reference: `FT-BANK-${stamp}`,
      bank_name: 'Vietcombank',
      bank_account: '0011004392819'
    }
  }), 201, 'Create bank transaction').transaction;
  assert.equal(bankTx.status, 'UNMATCHED');

  // Test manual match to remaining balance of invoice 1
  const manualMatch = check(await admin.request('/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: bankTx.id,
      invoice_id: invoice1.id
    }
  }), 200, 'Manual match bank transaction to invoice').result;
  assert.equal(manualMatch.invoice_no, issued1.invoice_no);
  console.log('PASS: Feature 9 - Bank Statement Reconciliation & Matching');

  // --- FEATURE 10: RBAC Roles & Permissions ---
  const rolesList = check(await admin.request('/api/rbac/roles'), 200, 'List RBAC roles');
  assert.ok(rolesList.items.length >= 2);
  const permsList = check(await admin.request('/api/rbac/permissions'), 200, 'List RBAC permissions');
  assert.ok(permsList.items.length >= 15);
  console.log('PASS: Feature 10 - Granular RBAC Roles & Permissions');

  // --- FEATURE 11: Business Audit Trail & Verification ---
  const auditLogs = check(await admin.request('/api/audit-logs?limit=20'), 200, 'Read audit logs');
  assert.ok(auditLogs.items.length > 0);
  assert.ok(auditLogs.items[0].hash);
  assert.equal(auditLogs.items[0].verified, true);

  const auditVerify = check(await admin.request('/api/audit-logs/verify', { method: 'POST', body: {} }), 200, 'Verify audit integrity');
  assert.equal(auditVerify.verified, true);
  console.log('PASS: Feature 11 - Business Audit Trail & Cryptographic Verification');

  // --- FEATURE 12: Company Profile & System Settings ---
  const settings = check(await admin.request('/api/settings'), 200, 'Get company settings').settings;
  assert.ok(settings.company_name);

  const updatedSettings = check(await admin.request('/api/settings', {
    method: 'PUT',
    body: {
      company_name: 'Billing One Enterprise Platform',
      tax_code: '0109887766',
      address: 'Hà Nội, Việt Nam',
      bank_name: 'Techcombank',
      bank_account: '19036788889999',
      tax_provider: 'VNPT-CA Cloud HSM Level 3',
      hsm_serial: '5404-98AF-2025-E81D'
    }
  }), 200, 'Update company settings').settings;
  assert.equal(updatedSettings.company_name, 'Billing One Enterprise Platform');
  console.log('PASS: Feature 12 - Company Profile & System Settings');

  console.log('\n====================================================');
  console.log('ALL 12 EXTENDED ENTERPRISE FEATURES PASSED 100%!');
  console.log('====================================================');
}

run().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
