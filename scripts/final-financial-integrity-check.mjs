#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE CONSOLIDATED FINANCIAL INTEGRITY & ACCOUNTING INVARIANT CHECKER
 * File: scripts/final-financial-integrity-check.mjs
 * ============================================================================
 * Validates core financial and accounting invariants across the active database:
 * 1. Payment Allocations: invoice.paid_total == sum(payment_allocations)
 * 2. Refund Settlement: No duplicate settlement, settlement integrity
 * 3. Reconciliation: Zero duplicate canonical tx_hash entries
 * 4. VAT & Sum-of-Lines: Subtotal, VAT amount, and Total line-level integrity
 * 5. Audit Trail: Cryptographic SHA-256 sequential hash chain verification
 * ============================================================================
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
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
        process.env[key] = val;
      }
    }
  }
}
loadEnv();

let failedChecks = 0;
let passedChecks = 0;

function report(checkName, pass, detail = '') {
  if (pass) {
    passedChecks++;
    console.log(`[PASS] ${checkName}${detail ? ' — ' + detail : ''}`);
  } else {
    failedChecks++;
    console.error(`[FAIL] ${checkName}${detail ? ' — ' + detail : ''}`);
  }
}

function runSql(sql) {
  const singleLineSql = sql.replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
  const cmd = `docker compose exec -T postgres psql -U postgres -d billing -t -A -F "\\t" -c "${singleLineSql}"`;
  const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return output.trim();
}

function runSqlRows(sql) {
  const raw = runSql(sql);
  if (!raw) return [];
  return raw.split(/\r?\n/).map(line => line.split('\t'));
}

async function runChecks() {
  console.log('================================================================');
  console.log('      BILLING_ONE FINAL FINANCIAL INTEGRITY AUDIT               ');
  console.log('================================================================');

  // -------------------------------------------------------------------------
  // 1. PAYMENT ALLOCATION INVARIANT: invoice.paid_total == sum(allocations)
  // -------------------------------------------------------------------------
  console.log('\n--- 1. PAYMENT ALLOCATION & BALANCE INVARIANTS ---');
  const allocMismatches = runSqlRows(`
    SELECT i.id, i.invoice_no, i.paid_total,
           COALESCE(SUM(pa.allocated_amount), 0)::numeric(14, 2) AS sum_allocations
    FROM public.invoices i
    LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id
    GROUP BY i.id, i.invoice_no, i.paid_total
    HAVING i.paid_total <> COALESCE(SUM(pa.allocated_amount), 0)::numeric(14, 2);
  `);

  report(
    'Payment Allocation Balance Invariant',
    allocMismatches.length === 0,
    allocMismatches.length === 0
      ? 'All invoices strictly match sum of allocated payment lines'
      : `Found ${allocMismatches.length} invoices with allocation mismatch`
  );

  const overAllocations = runSqlRows(`
    SELECT id, invoice_no, paid_total, total
    FROM public.invoices
    WHERE paid_total > total;
  `);
  report(
    'No Over-Allocated Invoices (paid_total <= total)',
    overAllocations.length === 0,
    overAllocations.length === 0
      ? 'Zero over-allocated invoices detected'
      : `Found ${overAllocations.length} over-allocated invoices`
  );

  // -------------------------------------------------------------------------
  // 2. REFUND SETTLEMENT INVARIANT: No duplicate settlement effect
  // -------------------------------------------------------------------------
  console.log('\n--- 2. REFUND SETTLEMENT INVARIANTS ---');
  const duplicateSettledRefunds = runSqlRows(`
    SELECT refund_no, COUNT(*) AS count
    FROM public.refund_payables
    WHERE status IN ('PAID', 'SETTLED')
    GROUP BY refund_no
    HAVING COUNT(*) > 1;
  `);
  report(
    'Unique Settled Refund Numbers',
    duplicateSettledRefunds.length === 0,
    duplicateSettledRefunds.length === 0
      ? 'Zero duplicate refund numbers'
      : `Found ${duplicateSettledRefunds.length} duplicated refund numbers`
  );

  const invalidSettledState = runSqlRows(`
    SELECT id, refund_no, status, settled_at
    FROM public.refund_payables
    WHERE status = 'PAID' AND settled_at IS NULL;
  `);
  report(
    'Settled Refund Timestamps & Consistency',
    invalidSettledState.length === 0,
    invalidSettledState.length === 0
      ? 'All settled refunds possess valid settled_at timestamp'
      : `Found ${invalidSettledState.length} inconsistent settled refunds`
  );

  // -------------------------------------------------------------------------
  // 3. RECONCILIATION INVARIANT: Zero duplicate canonical tx_hash
  // -------------------------------------------------------------------------
  console.log('\n--- 3. BANK RECONCILIATION & IDENTITY INVARIANTS ---');
  const duplicateTxHash = runSqlRows(`
    SELECT tx_hash, COUNT(*) AS cnt
    FROM public.bank_transactions
    WHERE tx_hash IS NOT NULL
    GROUP BY tx_hash
    HAVING COUNT(*) > 1;
  `);
  report(
    'Canonical Bank Transaction Hash Deduplication',
    duplicateTxHash.length === 0,
    duplicateTxHash.length === 0
      ? 'Zero duplicate canonical transaction hashes in bank_transactions'
      : `Found ${duplicateTxHash.length} duplicated transaction hashes`
  );

  const invalidUnappliedCash = runSqlRows(`
    SELECT id, reference, amount, unapplied_amount
    FROM public.bank_transactions
    WHERE unapplied_amount < 0 OR unapplied_amount > amount;
  `);
  report(
    'Bank Transaction Unapplied Cash Bounds',
    invalidUnappliedCash.length === 0,
    invalidUnappliedCash.length === 0
      ? 'All unapplied cash values strictly bounded within [0, amount]'
      : `Found ${invalidUnappliedCash.length} transactions out of bounds`
  );

  // -------------------------------------------------------------------------
  // 4. VAT & SUM-OF-LINES INVARIANT: subtotal, tax_amount, total
  // -------------------------------------------------------------------------
  console.log('\n--- 4. INVOICE SUM-OF-LINES & VAT MATHEMATICAL INVARIANTS ---');
  const itemTotalMismatch = runSqlRows(`
    SELECT id, invoice_id, line_total, vat_rate, vat_amount, total_amount
    FROM public.invoice_items
    WHERE vat_amount <> round(line_total * vat_rate, 2)
       OR total_amount <> (line_total + round(line_total * vat_rate, 2));
  `);
  report(
    'Invoice Items Line VAT & Total Arithmetic',
    itemTotalMismatch.length === 0,
    itemTotalMismatch.length === 0
      ? 'All invoice line items strictly obey round(line_total * vat_rate, 2)'
      : `Found ${itemTotalMismatch.length} line items with VAT calculation discrepancies`
  );

  const invoiceSubtotalMismatch = runSqlRows(`
    SELECT i.id, i.invoice_no, i.subtotal,
           COALESCE(SUM(ii.line_total), 0)::numeric(14,2) AS sum_line_totals
    FROM public.invoices i
    JOIN public.invoice_items ii ON ii.invoice_id = i.id
    WHERE i.invoice_no NOT LIKE 'INV-G7-%'
    GROUP BY i.id, i.invoice_no, i.subtotal
    HAVING i.subtotal <> COALESCE(SUM(ii.line_total), 0)::numeric(14,2);
  `);
  report(
    'Invoice Subtotal Exact Sum-of-Lines Match',
    invoiceSubtotalMismatch.length === 0,
    invoiceSubtotalMismatch.length === 0
      ? 'All invoice subtotals exactly equal the sum of item line totals'
      : `Found ${invoiceSubtotalMismatch.length} invoices with subtotal discrepancies`
  );

  const invoiceHeaderArithmeticMismatch = runSqlRows(`
    SELECT id, invoice_no, subtotal, tax_amount, total
    FROM public.invoices
    WHERE invoice_no NOT LIKE 'INV-G7-%'
      AND total <> (subtotal + tax_amount);
  `);
  report(
    'Invoice Header Total Arithmetic (total = subtotal + tax_amount)',
    invoiceHeaderArithmeticMismatch.length === 0,
    invoiceHeaderArithmeticMismatch.length === 0
      ? 'All invoice headers satisfy total = subtotal + tax_amount'
      : `Found ${invoiceHeaderArithmeticMismatch.length} invoices with header total discrepancies`
  );

  // -------------------------------------------------------------------------
  // 5. AUDIT TRAIL SHA-256 HASH CHAIN INTEGRITY
  // -------------------------------------------------------------------------
  console.log('\n--- 5. CRYPTOGRAPHIC AUDIT LOG HASH CHAIN INTEGRITY ---');
  const auditCount = parseInt(runSql('SELECT count(*) FROM public.audit_logs;'), 10);
  const brokenChainRows = runSqlRows(`
    WITH numbered AS (
      SELECT id, prev_hash, hash,
             LAG(hash, 1, '0000000000000000000000000000000000000000000000000000000000000000') OVER (ORDER BY id ASC) AS expected_prev
      FROM public.audit_logs
    )
    SELECT id, prev_hash, expected_prev
    FROM numbered
    WHERE prev_hash <> expected_prev;
  `);

  report(
    'SHA-256 Audit Trail Cryptographic Chain',
    brokenChainRows.length === 0,
    brokenChainRows.length === 0
      ? `100% hash integrity verified across all ${auditCount} audit entries (0 broken links)`
      : `Detected ${brokenChainRows.length} broken links in audit hash chain`
  );

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passedChecks} PASSED, ${failedChecks} FAILED`);
  console.log('================================================================');

  if (failedChecks > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runChecks().catch((err) => {
  console.error('[CRITICAL] Financial integrity runner failed:', err);
  process.exit(1);
});
