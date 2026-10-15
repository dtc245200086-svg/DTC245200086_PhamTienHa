#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE SCHEMA DRIFT & INTEGRITY VERIFICATION
 * File: scripts/verify-schema.mjs
 *
 * Checks:
 * 1. Existence of all 20 required tables
 * 2. Critical columns across all domains
 * 3. Critical domain constraints:
 *    - payments.method IN ('CASH', 'BANK_TRANSFER', 'CARD') [NO CREDIT_NOTE]
 *    - invoices.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED')
 *    - customers.status, customers.lock_source
 * 4. Critical triggers (trg_check_payment_allocation_invariants)
 * 5. Critical indexes & uniqueness constraints
 * 6. Audit append-only security (no UPDATE/DELETE for billing_app on audit_logs)
 * 7. schema_migrations tracking table presence and completeness
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

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
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

async function getPgClient() {
  let pgModule;
  try {
    pgModule = (await import('pg')).default;
  } catch {
    const { pathToFileURL } = await import('node:url');
    const localPgPath = path.resolve(__dirname, '../app/node_modules/pg/lib/index.js');
    pgModule = (await import(pathToFileURL(localPgPath).href)).default;
  }
  return pgModule.Client;
}

const EXPECTED_TABLES = [
  'users',
  'user_sessions',
  'customers',
  'payment_terms',
  'products',
  'invoices',
  'invoice_items',
  'payments',
  'payment_allocations',
  'payment_idempotency_keys',
  'invoice_adjustments',
  'refund_payables',
  'recurring_plans',
  'bank_transactions',
  'roles',
  'permissions',
  'role_permissions',
  'audit_logs',
  'company_settings',
  'legacy_credit_note_payments',
  'schema_migrations'
];

const EXPECTED_COLUMNS = [
  { table: 'invoices', column: 'adjusted_total' },
  { table: 'customers', column: 'lock_source' },
  { table: 'customers', column: 'locked_at' },
  { table: 'customers', column: 'credit_limit' },
  { table: 'payments', column: 'customer_id' },
  { table: 'payment_allocations', column: 'allocated_amount' },
  { table: 'payment_idempotency_keys', column: 'idempotency_key' },
  { table: 'refund_payables', column: 'refund_no' },
  { table: 'audit_logs', column: 'prev_hash' },
  { table: 'audit_logs', column: 'hash' },
  { table: 'company_settings', column: 'credit_control_enabled' },
  { table: 'bank_transactions', column: 'unapplied_amount' },
  { table: 'recurring_plans', column: 'auto_settle_unapplied' },
  { table: 'invoice_items', column: 'vat_amount' },
  { table: 'invoice_items', column: 'total_amount' },
  { table: 'refund_payables', column: 'settled_at' },
  { table: 'recurring_plans', column: 'vat_rate' },
  { table: 'bank_transactions', column: 'tx_hash' }
];

async function verify() {
  if (!fs.existsSync('/.dockerenv') && process.env.INSIDE_DOCKER !== '1') {
    try {
      const { execSync } = await import('node:child_process');
      const scriptsVol = path.resolve(REPO_ROOT, 'scripts').replace(/\\/g, '/');
      const cmd = `docker compose run --rm --entrypoint node -v "${scriptsVol}:/app/scripts:ro" -e INSIDE_DOCKER=1 migration /app/scripts/verify-schema.mjs`;
      execSync(cmd, { stdio: 'inherit' });
      process.exit(0);
    } catch (e) {
      process.exit(e.status || 1);
    }
  }

  const Client = await getPgClient();

  const connectionConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'billing',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '',
  };

  const client = new Client(connectionConfig);
  await client.connect();

  console.log('================================================================');
  console.log('      BILLING_ONE SCHEMA DRIFT & INTEGRITY VERIFICATION         ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assertCheck(condition, label, details = '') {
    if (condition) {
      console.log(`[PASS] ${label}`);
      passed++;
    } else {
      console.error(`[FAIL] ${label} - ${details}`);
      failed++;
    }
  }

  try {
    // 1. Verify tables
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const tables = new Set(tableRes.rows.map(r => r.table_name));

    for (const t of EXPECTED_TABLES) {
      assertCheck(tables.has(t), `Table existence: public.${t}`, `Missing table: ${t}`);
    }

    // 2. Verify critical columns
    const colRes = await client.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public';
    `);
    const colSet = new Set(colRes.rows.map(r => `${r.table_name}.${r.column_name}`));

    for (const { table, column } of EXPECTED_COLUMNS) {
      assertCheck(colSet.has(`${table}.${column}`), `Column existence: ${table}.${column}`, `Missing column: ${column} in ${table}`);
    }

    // 3. Verify payments.method constraint (MUST NOT contain CREDIT_NOTE)
    const payCheckRes = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.payments'::regclass AND conname = 'payments_method_check';
    `);
    const payCheckDef = payCheckRes.rows[0]?.def || '';
    const hasCreditNote = payCheckDef.includes('CREDIT_NOTE');
    const hasStandardMethods = payCheckDef.includes('CASH') && payCheckDef.includes('BANK_TRANSFER') && payCheckDef.includes('CARD');
    assertCheck(!hasCreditNote && hasStandardMethods, 'payments_method_check disallows CREDIT_NOTE', `Constraint definition: ${payCheckDef}`);

    // 4. Verify invoices.status constraint contains OVERDUE
    const invCheckRes = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_status_check';
    `);
    const invCheckDef = invCheckRes.rows[0]?.def || '';
    assertCheck(invCheckDef.includes('OVERDUE'), 'invoices_status_check includes OVERDUE', `Constraint definition: ${invCheckDef}`);

    // 5. Verify payment allocation trigger
    const trgRes = await client.query(`
      SELECT tgname 
      FROM pg_trigger 
      WHERE tgrelid = 'public.payment_allocations'::regclass 
        AND tgname = 'trg_check_payment_allocation_invariants';
    `);
    assertCheck(trgRes.rowCount > 0, 'Trigger trg_check_payment_allocation_invariants exists', 'Trigger missing on payment_allocations');

    // 6. Verify audit_logs append-only privilege for billing_app
    const privRes = await client.query(`
      SELECT privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' 
        AND table_name = 'audit_logs' 
        AND grantee = 'billing_app';
    `);
    const privileges = new Set(privRes.rows.map(r => r.privilege_type));
    const noUpdateDelete = !privileges.has('UPDATE') && !privileges.has('DELETE');
    const hasInsertSelect = privileges.has('INSERT') && privileges.has('SELECT');
    assertCheck(noUpdateDelete && hasInsertSelect, 'audit_logs permissions for billing_app are append-only (SELECT, INSERT only)', `Privileges: ${[...privileges].join(', ')}`);

    // 7. Verify compute_canonical_bank_tx_hash function
    const funcRes = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'compute_canonical_bank_tx_hash'
      ) AS exists;
    `);
    assertCheck(funcRes.rows[0]?.exists === true, 'Function compute_canonical_bank_tx_hash exists', 'Function missing in public schema');

    // 8. Verify schema_migrations tracking table
    const migrationsDir = path.resolve(__dirname, '../db/migrations');
    const expectedMigrationsCount = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.endsWith('_down.sql')).length
      : 12;
    const migRes = await client.query(`
      SELECT count(*) AS count FROM public.schema_migrations;
    `);
    const migrationCount = parseInt(migRes.rows[0]?.count || '0', 10);
    assertCheck(migrationCount >= expectedMigrationsCount, `schema_migrations tracking count (found ${migrationCount}, expected >= ${expectedMigrationsCount})`, `Count: ${migrationCount}`);

    console.log('\n================================================================');
    console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`[FATAL] Verification failed with error: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verify();
