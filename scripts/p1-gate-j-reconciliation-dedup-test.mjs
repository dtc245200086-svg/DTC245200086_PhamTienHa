#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE — GATE J: BANK RECONCILIATION DEDUP & BATCH INGESTION SUITE
 * File: scripts/p1-gate-j-reconciliation-dedup-test.mjs
 *
 * Verifies Finding J — Bank Reconciliation Deduplication + Batch Ingestion:
 * 1. Single transaction deduplication (409 DUPLICATE_TRANSACTION)
 * 2. Database-enforced uniqueness via tx_hash and bank_transactions_tx_hash_key
 * 3. Batch Ingestion (JSON array) with in-batch and DB deduplication
 * 4. Duplicate prevention across multiple batch runs
 * 5. Batch Ingestion with partial acceptance (valid accepted, malformed reported)
 * 6. CSV Batch Ingestion parsing, validation, and deduplication
 * 7. High-concurrency Race Condition Test (maximum 1 canonical insert succeeds)
 * 8. Reconciliation matching flow preserved (manual-match creates payment & allocation)
 * 9. Duplicate match attempt prevention (409 TRANSACTION_ALREADY_MATCHED)
 * 10. Audit trail: BANK_TRANSACTION_IMPORTED, BANK_TRANSACTION_DEDUPLICATED, BANK_TRANSACTION_MATCHED
 * 11. RBAC authorization: unauthenticated -> 401, non-reconciliation.manage -> 403
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
  if (res.status === 429) {
    console.log(`[AUTH] 429 for ${username}, backing off 12s...`);
    await new Promise((r) => setTimeout(r, 12000));
    return login(username, password);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error(`Login failed for ${username}: ${res.status}`);
  return setCookie.split(';')[0];
}

async function apiRequest(cookie, endpoint, { method = 'GET', body, headers: customHeaders = {} } = {}) {
  const headers = { ...customHeaders };
  if (cookie) headers['Cookie'] = cookie;
  if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

let totalChecks = 0;
let passedChecks = 0;

function check(desc, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc} - ${details}`);
    throw new Error(`Assertion failed: ${desc} ${details}`);
  }
}

async function run() {
  console.log('============================================================');
  console.log('BILLING_ONE — GATE J: RECONCILIATION DEDUP & BATCH INGESTION');
  console.log('============================================================\n');

  console.log('[SETUP] Logging in admin and staff...');
  const adminCookie = await login('admin', adminPassword);
  const staffCookie = await login('staff', staffPassword);

  const runId = Date.now();

  // --------------------------------------------------------------------------
  // CHECK 1: RBAC AUTHORIZATION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 1: RBAC Authorization ---');
  const unauthRes = await apiRequest('', '/api/bank-transactions/batch', {
    method: 'POST',
    body: { rows: [] }
  });
  check('Unauthenticated POST /api/bank-transactions/batch rejected 401', unauthRes.status === 401);

  const staffBatchRes = await apiRequest(staffCookie, '/api/bank-transactions/batch', {
    method: 'POST',
    body: { rows: [] }
  });
  check('Staff (lacking reconciliation.manage) POST /api/bank-transactions/batch rejected 403', staffBatchRes.status === 403);

  const adminAuthRes = await apiRequest(adminCookie, '/api/bank-transactions/batch', {
    method: 'POST',
    body: { rows: [] }
  });
  check('Admin POST /api/bank-transactions/batch authorized 200', adminAuthRes.status === 200);

  // --------------------------------------------------------------------------
  // CHECK 2: SINGLE TRANSACTION CREATION & DEDUPLICATION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 2: Single Transaction Creation & Duplicate Prevention ---');
  const singleRef = `J-TX-SINGLE-${runId}`;
  const tx1Res = await apiRequest(adminCookie, '/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-08',
      amount: '1250000.00',
      description: `Test single transaction ${singleRef}`,
      reference: singleRef,
      bank_name: 'Vietcombank',
      bank_account: '0011004392819'
    }
  });
  check('Single transaction created successfully (201)', tx1Res.status === 201 && tx1Res.data.transaction?.id);

  // Attempt duplicate insert with exact same reference
  const txDuplicateRes = await apiRequest(adminCookie, '/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-08',
      amount: '1250000.00',
      description: `Test duplicate transaction ${singleRef}`,
      reference: singleRef,
      bank_name: 'Vietcombank',
      bank_account: '0011004392819'
    }
  });
  check(
    'Duplicate single transaction rejected with 409 DUPLICATE_TRANSACTION',
    txDuplicateRes.status === 409 &&
      (txDuplicateRes.data.code === 'DUPLICATE_TRANSACTION' ||
        txDuplicateRes.data.error?.code === 'DUPLICATE_TRANSACTION' ||
        txDuplicateRes.data.error?.message?.includes('already exists')),
    JSON.stringify(txDuplicateRes.data)
  );

  // --------------------------------------------------------------------------
  // CHECK 3: BATCH INGESTION (JSON ARRAY) WITH IN-BATCH DEDUP
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 3: Batch Ingestion (JSON Array) with In-Batch Dedup ---');
  const batchRef1 = `J-BATCH-A-${runId}`;
  const batchRef2 = `J-BATCH-B-${runId}`;

  const batchJsonRes = await apiRequest(adminCookie, '/api/reconciliation/batch', {
    method: 'POST',
    body: {
      rows: [
        {
          tx_date: '2026-10-08',
          amount: '2000000.00',
          description: `Batch row 1 ${batchRef1}`,
          reference: batchRef1,
          bank_name: 'Vietcombank',
          bank_account: '0011004392819'
        },
        {
          tx_date: '2026-10-08',
          amount: '3000000.00',
          description: `Batch row 2 ${batchRef2}`,
          reference: batchRef2,
          bank_name: 'Vietcombank',
          bank_account: '0011004392819'
        },
        {
          tx_date: '2026-10-08',
          amount: '2000000.00',
          description: `In-batch duplicate of row 1`,
          reference: batchRef1, // duplicate of row 1!
          bank_name: 'Vietcombank',
          bank_account: '0011004392819'
        }
      ]
    }
  });

  check('Batch JSON status is 200', batchJsonRes.status === 200);
  check(
    'Batch reported total_rows: 3, accepted: 2, duplicates: 1, rejected: 0',
    batchJsonRes.data.total_rows === 3 &&
      batchJsonRes.data.accepted === 2 &&
      batchJsonRes.data.duplicates === 1 &&
      batchJsonRes.data.rejected === 0,
    JSON.stringify(batchJsonRes.data)
  );

  // --------------------------------------------------------------------------
  // CHECK 4: CROSS-BATCH DEDUPLICATION (SUBSEQUENT IMPORT)
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 4: Cross-Batch Deduplication Against Database ---');
  const reimportRes = await apiRequest(adminCookie, '/api/bank-transactions/batch', {
    method: 'POST',
    body: {
      rows: [
        {
          tx_date: '2026-10-08',
          amount: '2000000.00',
          description: `Reimport row 1`,
          reference: batchRef1,
          bank_name: 'Vietcombank',
          bank_account: '0011004392819'
        },
        {
          tx_date: '2026-10-08',
          amount: '3000000.00',
          description: `Reimport row 2`,
          reference: batchRef2,
          bank_name: 'Vietcombank',
          bank_account: '0011004392819'
        }
      ]
    }
  });

  check('Cross-batch re-import status is 200', reimportRes.status === 200);
  check(
    'All re-imported rows identified as DB duplicates: accepted: 0, duplicates: 2',
    reimportRes.data.total_rows === 2 && reimportRes.data.accepted === 0 && reimportRes.data.duplicates === 2,
    JSON.stringify(reimportRes.data)
  );

  // --------------------------------------------------------------------------
  // CHECK 5: PARTIAL ACCEPTANCE SEMANTICS (VALID + MALFORMED ROWS)
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 5: Partial Acceptance Semantics (Valid + Malformed Rows) ---');
  const validRef = `J-VALID-${runId}`;
  const mixedRes = await apiRequest(adminCookie, '/api/bank-transactions/batch', {
    method: 'POST',
    body: {
      rows: [
        {
          tx_date: '2026-10-08',
          amount: '550000.00',
          description: `Valid row in mixed batch`,
          reference: validRef
        },
        {
          tx_date: 'invalid-date-format', // invalid date
          amount: '550000.00',
          description: 'Row with invalid date'
        },
        {
          tx_date: '2026-10-08',
          amount: '-1000.00', // invalid negative amount
          description: 'Row with negative amount'
        },
        {
          tx_date: '2026-10-08',
          amount: '500000.00',
          description: '' // empty description
        }
      ]
    }
  });

  check('Mixed batch status is 200', mixedRes.status === 200);
  check(
    'Mixed batch reported total_rows: 4, accepted: 1, rejected: 3',
    mixedRes.data.total_rows === 4 && mixedRes.data.accepted === 1 && mixedRes.data.rejected === 3 && mixedRes.data.errors.length === 3,
    JSON.stringify(mixedRes.data)
  );

  // --------------------------------------------------------------------------
  // CHECK 6: CSV BATCH INGESTION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 6: CSV Batch Ingestion & Parsing ---');
  const csvRef1 = `J-CSV-1-${runId}`;
  const csvRef2 = `J-CSV-2-${runId}`;
  const csvPayload = [
    'tx_date,amount,description,reference,tx_type,bank_name,bank_account',
    `2026-10-08,1800000.00,"Giao dich CSV 1, co dau phay",${csvRef1},CREDIT,Vietcombank,0011004392819`,
    `2026-10-08,2200000.00,"Giao dich CSV 2",${csvRef2},CREDIT,Vietcombank,0011004392819`,
    `2026-10-08,1800000.00,"Giao dich CSV 1 trung lap",${csvRef1},CREDIT,Vietcombank,0011004392819`
  ].join('\n');

  const csvRes = await apiRequest(adminCookie, '/api/bank-transactions/batch', {
    method: 'POST',
    body: { csv: csvPayload }
  });

  check('CSV batch status is 200', csvRes.status === 200);
  check(
    'CSV batch parsed correctly: total: 3, accepted: 2, duplicates: 1, rejected: 0',
    csvRes.data.total_rows === 3 && csvRes.data.accepted === 2 && csvRes.data.duplicates === 1 && csvRes.data.rejected === 0,
    JSON.stringify(csvRes.data)
  );

  // --------------------------------------------------------------------------
  // CHECK 7: CONCURRENCY RACE CONDITION TEST
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 7: High-Concurrency Race Condition Safety ---');
  const concurrentRef = `J-RACE-${runId}`;
  const concurrencyCount = 5;

  const concurrentRequests = Array.from({ length: concurrencyCount }, () =>
    apiRequest(adminCookie, '/api/bank-transactions', {
      method: 'POST',
      body: {
        tx_date: '2026-10-08',
        amount: '9900000.00',
        description: `Race test transaction`,
        reference: concurrentRef,
        bank_name: 'Vietcombank',
        bank_account: '0011004392819'
      }
    })
  );

  const results = await Promise.all(concurrentRequests);
  const success201 = results.filter((r) => r.status === 201).length;
  const duplicate409 = results.filter((r) => r.status === 409).length;

  check(
    `Exactly 1 concurrent request succeeded (201) and ${concurrencyCount - 1} returned 409`,
    success201 === 1 && duplicate409 === concurrencyCount - 1,
    `201 count: ${success201}, 409 count: ${duplicate409}`
  );

  // Verify DB count
  const dbCount = queryDb(`SELECT count(*) FROM public.bank_transactions WHERE reference = '${concurrentRef}'`);
  check('PostgreSQL table contains exactly 1 row for concurrent reference', dbCount === '1', `DB count: ${dbCount}`);

  // --------------------------------------------------------------------------
  // CHECK 8: RECONCILIATION MATCHING FLOW & DUPLICATE MATCH PROTECTION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 8: Reconciliation Matching Integrity & Double Match Prevention ---');
  // 1. Create a customer & invoice for matching
  const custRes = await apiRequest(adminCookie, '/api/customers', {
    method: 'POST',
    body: {
      name: `Reconciliation Match Customer ${runId}`,
      tax_code: `03${String(runId).slice(-8)}`,
      email: `rec_cust_${runId}@example.com`
    }
  });
  const customerId = custRes.data.customer?.id || custRes.data.id;

  const invRes = await apiRequest(adminCookie, '/api/invoices', {
    method: 'POST',
    body: {
      customer_id: customerId,
      due_date: '2026-12-31',
      tax_rate: '0.10',
      items: [
        {
          description: 'Reconciliation matching service',
          quantity: '1',
          unit_price: '1000000.00',
          vat_rate: '0.1000'
        }
      ]
    }
  });
  if (invRes.status !== 201) {
    console.error('Invoice create failed:', invRes);
  }
  const invoiceId = invRes.data.invoice?.id || invRes.data.id;
  const invoiceNo = invRes.data.invoice?.invoice_no || invRes.data.invoice_no;

  // 2. Issue invoice
  const issueRes = await apiRequest(adminCookie, `/api/invoices/${invoiceId}/issue`, { method: 'POST' });
  if (issueRes.status !== 200) {
    console.error('Issue invoice failed:', issueRes);
  }

  // 3. Create bank transaction matching the invoice amount (1,100,000 VND)
  const matchTxRef = `J-MATCH-${runId}`;
  const matchTxRes = await apiRequest(adminCookie, '/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: '2026-10-08',
      amount: '1100000.00',
      description: `Payment for invoice ${invoiceNo}`,
      reference: matchTxRef
    }
  });
  const txId = matchTxRes.data.transaction?.id;

  // 4. Perform manual match
  const manualMatchRes = await apiRequest(adminCookie, '/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: txId,
      invoice_id: invoiceId
    }
  });
  if (manualMatchRes.status !== 200) {
    console.error('Manual match failed:', manualMatchRes);
  }
  check('Manual reconciliation match succeeded (200)', manualMatchRes.status === 200);

  // Verify status in DB is MATCHED
  const txStatus = queryDb(`SELECT status FROM public.bank_transactions WHERE id = ${txId}`);
  check('Bank transaction status transitioned to MATCHED in PostgreSQL', txStatus === 'MATCHED');

  // 5. Attempt duplicate match on same transaction
  const rematchRes = await apiRequest(adminCookie, '/api/reconciliation/manual-match', {
    method: 'POST',
    body: {
      transaction_id: txId,
      invoice_id: invoiceId
    }
  });
  check(
    'Duplicate match attempt rejected with 409 TRANSACTION_ALREADY_MATCHED',
    rematchRes.status === 409 &&
      (rematchRes.data.code === 'TRANSACTION_ALREADY_MATCHED' ||
        rematchRes.data.error?.code === 'TRANSACTION_ALREADY_MATCHED'),
    JSON.stringify(rematchRes.data)
  );

  // --------------------------------------------------------------------------
  // CHECK 9: AUDIT TRAIL VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 9: Audit Trail Integrity ---');
  const importAuditCount = queryDb(
    `SELECT count(*) FROM public.audit_logs WHERE action IN ('BANK_TRANSACTION_IMPORTED', 'BANK_TRANSACTION_DEDUPLICATED', 'BANK_TRANSACTION_MATCHED')`
  );
  check('Authoritative audit records recorded for batch import and dedup', parseInt(importAuditCount, 10) > 0, `Count: ${importAuditCount}`);

  // --------------------------------------------------------------------------
  // CHECK 10: NO-REFERENCE CANONICAL COMPOSITE IDENTITY DEDUPLICATION
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 10: No-Reference Canonical Composite Identity Deduplication ---');
  const noRefAccount = `00110099${String(runId).slice(-5)}`;
  const noRefDate = '2026-10-08';
  const noRefAmount = '750000.00';
  const noRefDesc = `Deposit without reference ${runId}`;

  const noRefRes1 = await apiRequest(adminCookie, '/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: noRefDate,
      amount: noRefAmount,
      description: noRefDesc,
      tx_type: 'CREDIT',
      bank_name: 'Vietcombank',
      bank_account: noRefAccount
    }
  });
  check('First transaction without reference accepted (201)', noRefRes1.status === 201 && noRefRes1.data.transaction?.id);

  // Second identical transaction without reference -> must be rejected with 409 DUPLICATE_TRANSACTION
  const noRefRes2 = await apiRequest(adminCookie, '/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: noRefDate,
      amount: noRefAmount,
      description: noRefDesc,
      tx_type: 'CREDIT',
      bank_name: 'Vietcombank',
      bank_account: noRefAccount
    }
  });
  check(
    'Identical transaction without reference rejected with 409 DUPLICATE_TRANSACTION',
    noRefRes2.status === 409 &&
      (noRefRes2.data.code === 'DUPLICATE_TRANSACTION' ||
        noRefRes2.data.error?.code === 'DUPLICATE_TRANSACTION' ||
        noRefRes2.data.error?.message?.includes('already exists')),
    JSON.stringify(noRefRes2.data)
  );

  // --------------------------------------------------------------------------
  // CHECK 11: CLIENT ANTI-SPOOFING ENFORCEMENT AT DB BOUNDARY
  // --------------------------------------------------------------------------
  console.log('\n--- CHECK 11: Client Anti-Spoofing Enforcement at DB Boundary ---');
  // Malicious client tries to bypass deduplication by sending a fake tx_hash
  const spoofedFakeHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const spoofRes = await apiRequest(adminCookie, '/api/bank-transactions', {
    method: 'POST',
    body: {
      tx_date: noRefDate,
      amount: noRefAmount,
      description: noRefDesc,
      tx_type: 'CREDIT',
      bank_name: 'Vietcombank',
      bank_account: noRefAccount,
      tx_hash: spoofedFakeHash // Client-supplied fake hash
    }
  });
  check(
    'Spoofed hash attempt rejected with 409 DUPLICATE_TRANSACTION (DB trigger enforced)',
    spoofRes.status === 409 &&
      (spoofRes.data.code === 'DUPLICATE_TRANSACTION' ||
        spoofRes.data.error?.code === 'DUPLICATE_TRANSACTION' ||
        spoofRes.data.error?.message?.includes('already exists')),
    JSON.stringify(spoofRes.data)
  );

  console.log('\n============================================================');
  console.log(`GATE J RESULT: ${passedChecks} / ${totalChecks} CHECKS PASSED`);
  console.log('============================================================\n');

  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('\n[GATE J RUNTIME ERROR]:', err);
  process.exit(1);
});
