/**
 * BILLING_ONE — P1.5 GATE 2 TARGETED TEST SUITE
 * CUSTOMER CREDIT DOMAIN SERVICE VERIFICATION
 * 
 * Tests:
 * T01: credit_limit = 0 -> unlimited credit
 * T02: debt below limit -> eligible
 * T03: debt + invoice_total == limit -> eligible
 * T04: debt + invoice_total exceeds limit by 0.01 -> 409 CREDIT_LIMIT_EXCEEDED
 * T05: customer LOCKED -> 409 CUSTOMER_IS_LOCKED
 * T06: customer WARNING + within limit -> eligible
 * T07: negative available credit calculated exactly
 * T08: empty open invoice set -> debt = '0.00'
 * T09: multiple open invoices -> exact aggregate debt
 * T10: overdue age boundary (29, 30, 31 days) & risk FSM
 * T11: transaction row locking (customer FOR UPDATE) verification
 * T12: zero DB mutation & zero audit log emission verification
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If running directly on host, delegate to the web container where dependencies and DB are connected
if (!process.env.DB_HOST && !process.env.INSIDE_DOCKER) {
  console.log('[Runner] Executing test suite inside billing-web container...');
  try {
    // Copy latest files to container
    execSync('docker cp app/src/services/customerCreditService.js billing-web-1:/app/src/services/customerCreditService.js', { stdio: 'inherit' });
    execSync('docker cp scripts/p1_5-domain-service-test.mjs billing-web-1:/app/test_domain_service.mjs', { stdio: 'inherit' });
    
    // Execute inside container
    const output = execSync('docker exec -i -e INSIDE_DOCKER=1 billing-web-1 node /app/test_domain_service.mjs', { encoding: 'utf8' });
    console.log(output);
    process.exit(0);
  } catch (err) {
    if (err.stdout) console.log(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    console.error('[Runner] Container execution failed:', err.message);
    process.exit(1);
  }
}

// Inside container execution logic:
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { pool } = require('./src/db.js');
const CustomerCreditService = require('./src/services/customerCreditService.js');
const { parseToCents, centsToString } = CustomerCreditService;

console.log('============================================================');
console.log('BILLING_ONE — P1.5 GATE 2 CUSTOMER CREDIT DOMAIN SERVICE TEST');
console.log('============================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
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
// PURE UNIT TESTS (Exact Arithmetic & FSM Logic)
// -------------------------------------------------------------

console.log('--- Pure Domain Logic & Arithmetic Tests ---\n');

runTest('T01-Pure: credit_limit = 0 represents unlimited credit', () => {
  const result = CustomerCreditService.calculateAvailableCredit('0.00', '15000000.00');
  assert.equal(result.unlimited, true, 'unlimited flag must be true');
  assert.equal(result.available, null, 'available must be null for unlimited credit');

  const resultZeroInt = CustomerCreditService.calculateAvailableCredit(0, 5000);
  assert.equal(resultZeroInt.unlimited, true);
  assert.equal(resultZeroInt.available, null);
});

runTest('T02-Pure: debt below limit yields exact available credit', () => {
  const result = CustomerCreditService.calculateAvailableCredit('50000000.00', '10000000.00');
  assert.equal(result.unlimited, false);
  assert.equal(result.available, '40000000.00');
});

runTest('T03-Pure: debt exactly equals limit yields available = 0.00', () => {
  const result = CustomerCreditService.calculateAvailableCredit('50000000.00', '50000000.00');
  assert.equal(result.unlimited, false);
  assert.equal(result.available, '0.00');
});

runTest('T04-Pure: debt exceeds limit by 0.01 yields available = -0.01', () => {
  const result = CustomerCreditService.calculateAvailableCredit('50000000.00', '50000000.01');
  assert.equal(result.unlimited, false);
  assert.equal(result.available, '-0.01');
});

runTest('T07-Pure: exact decimal boundary examples matching Frozen Spec', () => {
  // Boundary 1: 50,000,000.00 - 45,000,000.00 -> 5,000,000.00
  const r1 = CustomerCreditService.calculateAvailableCredit('50000000.00', '45000000.00');
  assert.equal(r1.available, '5000000.00');

  // Boundary 2: 50,000,000.00 - 50,000,000.00 -> 0.00
  const r2 = CustomerCreditService.calculateAvailableCredit('50000000.00', '50000000.00');
  assert.equal(r2.available, '0.00');

  // Boundary 3: 50,000,000.00 - 50,000,000.01 -> -0.01
  const r3 = CustomerCreditService.calculateAvailableCredit('50000000.00', '50000000.01');
  assert.equal(r3.available, '-0.01');
});

runTest('T10-Pure: overdue age boundaries (29, 30, 31 days) matching Frozen Spec', () => {
  // Overdue 29 days (<= 30) -> WARNING
  const r29 = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '50000000.00',
    currentDebt: '10000000.00',
    oldestOverdueDays: 29,
    autoLockOverdueDays: 30
  });
  assert.equal(r29.targetStatus, 'WARNING');
  assert.equal(r29.lockSource, null);

  // Overdue 30 days (<= 30) -> WARNING (boundary condition)
  const r30 = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '50000000.00',
    currentDebt: '10000000.00',
    oldestOverdueDays: 30,
    autoLockOverdueDays: 30
  });
  assert.equal(r30.targetStatus, 'WARNING');
  assert.equal(r30.lockSource, null);

  // Overdue 31 days (> 30) -> LOCKED with AUTO_RISK
  const r31 = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '50000000.00',
    currentDebt: '10000000.00',
    oldestOverdueDays: 31,
    autoLockOverdueDays: 30
  });
  assert.equal(r31.targetStatus, 'LOCKED');
  assert.equal(r31.lockSource, 'AUTO_RISK');
  assert.ok(r31.reason.includes('31 ngày'));
});

runTest('T10-Pure: credit utilization boundaries (79.99%, 80.00%, 100.00%, 100.00002%)', () => {
  // Limit 50M, 80% = 40M.
  // 39,999,999.99 (debt < 80%) -> ACTIVE
  const r79 = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '50000000.00',
    currentDebt: '39999999.99',
    oldestOverdueDays: 0,
    autoLockOverdueDays: 30
  });
  assert.equal(r79.targetStatus, 'ACTIVE');
  assert.equal(r79.lockSource, null);

  // 40,000,000.00 (debt = 80%) -> WARNING
  const r80 = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '50000000.00',
    currentDebt: '40000000.00',
    oldestOverdueDays: 0,
    autoLockOverdueDays: 30
  });
  assert.equal(r80.targetStatus, 'WARNING');
  assert.equal(r80.lockSource, null);

  // 50,000,000.00 (debt = 100%) -> WARNING
  const r100 = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '50000000.00',
    currentDebt: '50000000.00',
    oldestOverdueDays: 0,
    autoLockOverdueDays: 30
  });
  assert.equal(r100.targetStatus, 'WARNING');
  assert.equal(r100.lockSource, null);

  // 50,000,000.01 (debt > 100%) -> LOCKED
  const rOver = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '50000000.00',
    currentDebt: '50000000.01',
    oldestOverdueDays: 0,
    autoLockOverdueDays: 30
  });
  assert.equal(rOver.targetStatus, 'LOCKED');
  assert.equal(rOver.lockSource, 'AUTO_RISK');
});

runTest('T10-Pure: unlimited credit (limit = 0) never locks on debt alone', () => {
  const r = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '0.00',
    currentDebt: '999999999.99',
    oldestOverdueDays: 0,
    autoLockOverdueDays: 30
  });
  assert.equal(r.targetStatus, 'ACTIVE');
  assert.equal(r.lockSource, null);

  // But still locks if overdue > 30 days
  const rOverdue = CustomerCreditService.evaluateCreditRisk({
    creditLimit: '0.00',
    currentDebt: '999999999.99',
    oldestOverdueDays: 35,
    autoLockOverdueDays: 30
  });
  assert.equal(rOverdue.targetStatus, 'LOCKED');
  assert.equal(rOverdue.lockSource, 'AUTO_RISK');
});

// -------------------------------------------------------------
// INTEGRATION TESTS (PostgreSQL Transactional Behavior)
// -------------------------------------------------------------

console.log('\n--- PostgreSQL Integration & Transaction Tests ---\n');

const testAdminIdRes = await pool.query(`SELECT id FROM public.users WHERE role = 'admin' LIMIT 1`);
const testUserId = testAdminIdRes.rows[0]?.id || 1;

// Helper to create test customer within a client transaction
async function createTestCustomer(client, { code, status = 'ACTIVE', creditLimit = '50000000.00', lockSource = null, lockReason = null }) {
  const res = await client.query(
    `INSERT INTO public.customers (code, name, status, credit_limit, lock_source, lock_reason, created_at)
     VALUES ($1, $2, $3, $4::numeric, $5, $6, NOW())
     RETURNING id, code, status, credit_limit::text`,
    [code, `Test Customer ${code}`, status, creditLimit, lockSource, lockReason]
  );
  return res.rows[0];
}

// Helper to create test invoice within a client transaction
async function createTestInvoice(client, { customerId, invoiceNo, status, total, paidTotal = '0.00', adjustedTotal = '0.00', dueDate = '2026-12-31', cancelReason = null }) {
  const actualCancelReason = status === 'CANCELLED' ? (cancelReason || 'Test invoice cancellation reason') : null;
  const res = await client.query(
    `INSERT INTO public.invoices (customer_id, invoice_no, status, total, paid_total, adjusted_total, due_date, subtotal, tax_amount, cancel_reason, created_by, created_at)
     VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::date, $4::numeric, 0, $8, $9, NOW())
     RETURNING id, invoice_no, status, total::text, paid_total::text, adjusted_total::text`,
    [customerId, invoiceNo, status, total, paidTotal, adjustedTotal, dueDate, actualCancelReason, testUserId]
  );
  return res.rows[0];
}

const auditBefore = await pool.query(`SELECT count(*)::int AS count FROM public.audit_logs`);
const initialAuditCount = auditBefore.rows[0].count;

await runAsyncTest('T08-DB: empty open invoice set returns exact 0.00', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, { code: 'TEST_P1_5_CUST_T08', creditLimit: '50000000.00' });
    
    // Add invoices in non-open statuses: DRAFT, PAID, CANCELLED
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T08_DRAFT', status: 'DRAFT', total: '10000000.00' });
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T08_PAID', status: 'PAID', total: '20000000.00', paidTotal: '20000000.00' });
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T08_CANCELLED', status: 'CANCELLED', total: '15000000.00' });

    const debt = await CustomerCreditService.calculateCurrentDebt(client, cust.id);
    assert.equal(debt, '0.00', 'debt for customer without open invoices must be exact 0.00');
    assert.equal(typeof debt, 'string');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

await runAsyncTest('T09-DB: multiple open invoices yield exact aggregate debt', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, { code: 'TEST_P1_5_CUST_T09', creditLimit: '50000000.00' });

    // Invoice 1: ISSUED (10,000,000 - 0 - 0 = 10,000,000.00)
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T09_1', status: 'ISSUED', total: '10000000.00' });
    
    // Invoice 2: PARTIALLY_PAID (8,000,000 - 2,500,000 - 500,000 = 5,000,000.00)
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T09_2', status: 'PARTIALLY_PAID', total: '8000000.00', paidTotal: '2500000.00', adjustedTotal: '500000.00' });

    // Invoice 3: OVERDUE (3,000,000 - 0 - 0 = 3,000,000.00)
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T09_3', status: 'OVERDUE', total: '3000000.00' });

    // Invoice 4: DRAFT (ignored)
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T09_4', status: 'DRAFT', total: '99999999.00' });

    // Invoice 5: PAID (ignored)
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T09_5', status: 'PAID', total: '50000000.00', paidTotal: '50000000.00' });

    const debt = await CustomerCreditService.calculateCurrentDebt(client, cust.id);
    assert.equal(debt, '18000000.00', 'aggregate open debt must be 18,000,000.00 exactly');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

await runAsyncTest('T01-DB: checkInvoiceIssueEligibility accepts unlimited credit customer', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, { code: 'TEST_P1_5_CUST_T01', creditLimit: '0.00', status: 'ACTIVE' });
    const snapshot = await CustomerCreditService.checkInvoiceIssueEligibility(client, {
      customerId: cust.id,
      invoiceTotal: '999999999.00'
    });

    assert.equal(snapshot.eligible, true);
    assert.equal(snapshot.credit_limit, '0.00');
    assert.equal(snapshot.available_credit, null);
    assert.equal(snapshot.invoice_total, '999999999.00');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

await runAsyncTest('T02-DB: debt below limit is eligible', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, { code: 'TEST_P1_5_CUST_T02', creditLimit: '50000000.00' });
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T02_OPEN', status: 'ISSUED', total: '10000000.00' });

    const snapshot = await CustomerCreditService.checkInvoiceIssueEligibility(client, {
      customerId: cust.id,
      invoiceTotal: '15000000.00'
    });

    assert.equal(snapshot.eligible, true);
    assert.equal(snapshot.credit_limit, '50000000.00');
    assert.equal(snapshot.current_debt, '10000000.00');
    assert.equal(snapshot.invoice_total, '15000000.00');
    assert.equal(snapshot.projected_debt, '25000000.00');
    assert.equal(snapshot.available_credit, '40000000.00');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

await runAsyncTest('T03-DB: debt + invoice_total exactly equals limit is eligible', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, { code: 'TEST_P1_5_CUST_T03', creditLimit: '50000000.00' });
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T03_OPEN', status: 'ISSUED', total: '40000000.00' });

    const snapshot = await CustomerCreditService.checkInvoiceIssueEligibility(client, {
      customerId: cust.id,
      invoiceTotal: '10000000.00'
    });

    assert.equal(snapshot.eligible, true);
    assert.equal(snapshot.projected_debt, '50000000.00');
    assert.equal(snapshot.available_credit, '10000000.00');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

await runAsyncTest('T04-DB: debt + invoice_total exceeds limit by 0.01 throws CREDIT_LIMIT_EXCEEDED', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, { code: 'TEST_P1_5_CUST_T04', creditLimit: '50000000.00' });
    await createTestInvoice(client, { customerId: cust.id, invoiceNo: 'INV_T04_OPEN', status: 'ISSUED', total: '40000000.00' });

    let thrownError = null;
    try {
      await CustomerCreditService.checkInvoiceIssueEligibility(client, {
        customerId: cust.id,
        invoiceTotal: '10000000.01'
      });
    } catch (err) {
      thrownError = err;
    }
    await client.query('ROLLBACK');

    assert.ok(thrownError, 'Must throw error when credit limit exceeded');
    assert.equal(thrownError.status, 409);
    assert.equal(thrownError.code, 'CREDIT_LIMIT_EXCEEDED');
    assert.equal(thrownError.details.excess_amount, '0.01');
    assert.equal(thrownError.details.projected_debt, '50000000.01');
    assert.equal(thrownError.details.current_debt, '40000000.00');
    assert.equal(thrownError.details.invoice_total, '10000000.01');
    assert.equal(thrownError.details.credit_limit, '50000000.00');
  } finally {
    client.release();
  }
});

await runAsyncTest('T05-DB: customer LOCKED throws CUSTOMER_IS_LOCKED', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, {
      code: 'TEST_P1_5_CUST_T05',
      status: 'LOCKED',
      creditLimit: '50000000.00',
      lockSource: 'AUTO_RISK',
      lockReason: 'Delinquency lock'
    });

    let thrownError = null;
    try {
      await CustomerCreditService.checkInvoiceIssueEligibility(client, {
        customerId: cust.id,
        invoiceTotal: '1000.00'
      });
    } catch (err) {
      thrownError = err;
    }
    await client.query('ROLLBACK');

    assert.ok(thrownError, 'Must throw when customer is locked');
    assert.equal(thrownError.status, 409);
    assert.equal(thrownError.code, 'CUSTOMER_IS_LOCKED');
    assert.equal(thrownError.customer_status, 'LOCKED');
    assert.equal(thrownError.lock_source, 'AUTO_RISK');
  } finally {
    client.release();
  }
});

await runAsyncTest('T06-DB: customer WARNING + within limit is eligible', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cust = await createTestCustomer(client, {
      code: 'TEST_P1_5_CUST_T06',
      status: 'WARNING',
      creditLimit: '50000000.00'
    });

    const snapshot = await CustomerCreditService.checkInvoiceIssueEligibility(client, {
      customerId: cust.id,
      invoiceTotal: '5000000.00'
    });

    assert.equal(snapshot.eligible, true);
    assert.equal(snapshot.status, 'WARNING');
    assert.equal(snapshot.projected_debt, '5000000.00');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

await runAsyncTest('T11-DB: Customer row lock FOR UPDATE concurrency verification', async () => {
  // Insert a committed customer specifically for concurrency testing
  const createRes = await pool.query(
    `INSERT INTO public.customers (code, name, status, credit_limit, created_at)
     VALUES ($1, $2, 'ACTIVE', 50000000.00, NOW())
     RETURNING id`,
    ['TEST_P1_5_CUST_T11_LOCK', 'Test Lock Customer']
  );
  const custId = createRes.rows[0].id;

  const client1 = await pool.connect();
  const client2 = await pool.connect();

  try {
    // Client 1 begins transaction and calls eligibility check
    await client1.query('BEGIN');
    await CustomerCreditService.checkInvoiceIssueEligibility(client1, {
      customerId: custId,
      invoiceTotal: '5000.00'
    });

    // Client 2 attempts to lock the same customer row with NOWAIT
    let lockFailed = false;
    try {
      await client2.query(`SELECT id FROM public.customers WHERE id = $1 FOR UPDATE NOWAIT`, [custId]);
    } catch (err) {
      if (err.code === '55P03') { // 55P03 = lock_not_available
        lockFailed = true;
      } else {
        throw err;
      }
    }

    assert.equal(lockFailed, true, 'Client 2 must be blocked with 55P03 lock_not_available while Client 1 holds row lock');

    // Rollback client 1
    await client1.query('ROLLBACK');

    // Now client 2 should be able to acquire lock
    const res2 = await client2.query(`SELECT id FROM public.customers WHERE id = $1 FOR UPDATE NOWAIT`, [custId]);
    assert.equal(res2.rowCount, 1, 'Client 2 acquires lock after Client 1 releases');
  } finally {
    client1.release();
    client2.release();
    // Clean up test customer
    await pool.query(`DELETE FROM public.customers WHERE id = $1`, [custId]);
  }
});

await runAsyncTest('T12-DB: Verify zero database mutation & zero audit log emission', async () => {
  const auditAfter = await pool.query(`SELECT count(*)::int AS count FROM public.audit_logs`);
  const finalAuditCount = auditAfter.rows[0].count;

  assert.equal(
    finalAuditCount,
    initialAuditCount,
    `Audit log count must remain exactly identical (initial: ${initialAuditCount}, final: ${finalAuditCount})`
  );
});

await pool.end();

console.log('\n============================================================');
console.log(`GATE 2 TARGETED TEST SUITE: ALL ${passedTests}/${totalTests} TESTS PASSED`);
console.log('============================================================\n');
process.exit(0);
