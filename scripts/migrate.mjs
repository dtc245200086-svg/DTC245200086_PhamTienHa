#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE PRODUCTION MIGRATION RUNNER
 * File: scripts/migrate.mjs
 *
 * Responsibilities:
 * 1. Scan db/migrations/ for versioned .sql files.
 * 2. Ensure deterministic version order (e.g. 01, 02, ..., 08).
 * 3. Maintain public.schema_migrations with version, filename, sha256 checksum.
 * 4. Acquire PostgreSQL session advisory lock to prevent concurrent runner races.
 * 5. Verify checksum of previously applied migrations (FAIL LOUD on drift/tamper).
 * 6. Baseline existing database if schema objects already exist without tracking table.
 * 7. Execute unapplied migrations within discrete transactions.
 * 8. Return non-zero exit code on any failure to gate container startup.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env if not populated in environment
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
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

// Resolve pg driver (supports both container /app context and host repo context)
async function getPgClient() {
  let pgModule;
  try {
    pgModule = (await import('pg')).default;
  } catch {
    try {
      const localPgPath = path.resolve(__dirname, '../app/node_modules/pg/lib/index.js');
      pgModule = (await import(localPgPath)).default;
    } catch (err) {
      console.error('[MIGRATE_ERROR] Failed to load pg driver:', err.message);
      process.exit(1);
    }
  }
  return pgModule.Client;
}

// Compute SHA-256 checksum of raw file buffer
function getFileChecksum(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Strip psql client meta-commands (e.g. \set ON_ERROR_STOP on) that standard SQL drivers reject
function sanitizeSqlForPg(sqlText) {
  return sqlText
    .split(/\r?\n/)
    .map(line => (/^\s*\\[a-zA-Z_]+/.test(line) ? `-- [STRIPPED PSQL COMMAND] ${line}` : line))
    .join('\n');
}

// Inspect database schema to detect if specific migration markers are present
async function isMigrationAlreadyAppliedInSchema(client, version) {
  const v = String(version).padStart(2, '0');
  switch (v) {
    case '01': {
      // 01_p0_financial_integrity: legacy_credit_note_payments table and invoices.adjusted_total
      const res = await client.query(`
        SELECT (
          EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'legacy_credit_note_payments')
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'adjusted_total')
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '02': {
      // 02_p1_refund_ledger: refund_payables table and refund_no_seq sequence
      const res = await client.query(`
        SELECT (
          EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'refund_payables')
          AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'refund_no_seq' AND relkind = 'S')
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '03': {
      // 03_p1_2_payment_allocation_v2: payments.customer_id and check_payment_allocation_invariants trigger function
      const res = await client.query(`
        SELECT (
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'customer_id')
          AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'check_payment_allocation_invariants')
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '04': {
      // 04_p1_2_1_payment_idempotency: payment_idempotency_keys table
      const res = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_idempotency_keys'
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '05': {
      // 05_p1_2_2_idempotency_hardening: unique index or constraint on idempotency_key
      const res = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'payment_idempotency_keys_key_unique'
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '06': {
      // 06_p1_3_recurring_auto_settlement: recurring_plans.auto_settle_unapplied column
      const res = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_plans' AND column_name = 'auto_settle_unapplied'
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '07': {
      // 07_p1_4_overdue_lifecycle: invoices_status_check contains OVERDUE
      const res = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'invoices_status_check'
            AND pg_get_constraintdef(oid) LIKE '%OVERDUE%'
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '08': {
      // 08_p1_5_credit_risk_control: customers.lock_source and company_settings.credit_control_enabled
      const res = await client.query(`
        SELECT (
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'lock_source')
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_settings' AND column_name = 'credit_control_enabled')
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '09': {
      // 09_p1_financial_core: invoice_items.vat_amount and invoice_items.total_amount
      const res = await client.query(`
        SELECT (
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'vat_amount')
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'total_amount')
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '10': {
      // 10_p1_settlement_automation: bank_transactions.tx_hash and refund_payables.settled_at
      const res = await client.query(`
        SELECT (
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bank_transactions' AND column_name = 'tx_hash')
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_payables' AND column_name = 'settled_at')
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    case '11': {
      // 11_p2_final_hardening: public.compute_canonical_bank_tx_hash function
      const res = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'compute_canonical_bank_tx_hash'
        ) AS applied;
      `);
      return res.rows[0]?.applied === true;
    }
    default:
      return false;
  }
}

async function main() {
  const ADVISORY_LOCK_ID = 74839201; // Deterministic int4 advisory lock key for Billing_One migrations
  const migrationsDir = process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : path.resolve(__dirname, '../db/migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.error(`[MIGRATE_ERROR] Migrations directory does not exist: ${migrationsDir}`);
    process.exit(1);
  }

  // Find all UP migration files (exclude _down.sql / .down.sql)
  const allFiles = fs.readdirSync(migrationsDir);
  const migrationFiles = allFiles
    .filter(file => {
      if (!file.endsWith('.sql')) return false;
      if (/_down\.sql$|\.down\.sql$/i.test(file)) return false;
      return /^\d+/.test(file);
    })
    .sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)/)[1], 10);
      const numB = parseInt(b.match(/^(\d+)/)[1], 10);
      return numA - numB;
    });

  // Validate that no duplicate version numbers exist
  const seenVersions = new Map();
  for (const file of migrationFiles) {
    const v = file.match(/^(\d+)/)[1].padStart(2, '0');
    if (seenVersions.has(v)) {
      console.error(`[MIGRATE_ERROR] Duplicate migration version '${v}' detected: '${file}' conflicts with '${seenVersions.get(v)}'`);
      process.exit(1);
    }
    seenVersions.set(v, file);
  }

  console.log('================================================================');
  console.log('       BILLING_ONE PRODUCTION MIGRATION RUNNER                  ');
  console.log('================================================================');
  console.log(`[INFO] Migrations directory: ${migrationsDir}`);
  console.log(`[INFO] Discovered ${migrationFiles.length} versioned migration files:`);
  for (const f of migrationFiles) {
    console.log(`       - ${f}`);
  }

  const Client = await getPgClient();

  const connectionConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'billing',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '',
    connectionTimeoutMillis: 10000,
  };

  const client = new Client(connectionConfig);

  try {
    await client.connect();
    console.log(`[INFO] Connected to PostgreSQL at ${connectionConfig.host}:${connectionConfig.port}/${connectionConfig.database} as ${connectionConfig.user}`);
  } catch (err) {
    console.error(`[FATAL] Unable to connect to database: ${err.message}`);
    process.exit(1);
  }

  let lockAcquired = false;

  try {
    // 1. Acquire advisory lock
    console.log('[INFO] Acquiring migration advisory lock...');
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    lockAcquired = true;
    console.log('[INFO] Advisory lock acquired.');

    // 2. Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version VARCHAR(32) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        execution_time_ms INTEGER NOT NULL DEFAULT 0
      );
    `);

    // 3. Query existing applied migrations
    const res = await client.query(`
      SELECT version, filename, checksum, applied_at
      FROM public.schema_migrations
      ORDER BY version ASC;
    `);

    const appliedMap = new Map();
    for (const row of res.rows) {
      appliedMap.set(row.version, row);
    }

    console.log(`[INFO] Existing tracked migrations in schema_migrations: ${appliedMap.size}`);

    // Check if database already has schema objects but 0 entries in schema_migrations (Baseline condition)
    let isBaselineMode = false;
    if (appliedMap.size === 0) {
      // Check if version 01 & 08 are already present in DB schema
      const v1Present = await isMigrationAlreadyAppliedInSchema(client, '01');
      const v8Present = await isMigrationAlreadyAppliedInSchema(client, '08');
      if (v1Present && v8Present) {
        console.log('[WARN] Existing database detected with applied 01-08 schema objects but no schema_migrations table.');
        console.log('[INFO] Entering BASELINE MODE: Verifying schema integrity and recording migration checksums...');
        isBaselineMode = true;
      }
    }

    let appliedCount = 0;
    let baselineCount = 0;

    for (const file of migrationFiles) {
      const match = file.match(/^(\d+)/);
      const rawNum = match[1];
      const version = rawNum.padStart(2, '0');
      const filePath = path.join(migrationsDir, file);
      const diskChecksum = getFileChecksum(filePath);

      if (appliedMap.has(version)) {
        // Previously applied: Verify checksum integrity (FAIL LOUD on drift)
        const recorded = appliedMap.get(version);
        if (recorded.checksum !== diskChecksum) {
          throw new Error(
            `[FATAL CHECKSUM DRIFT] Migration ${file} (version ${version}) has been modified after execution!\n` +
            `  Recorded in DB: ${recorded.checksum} (applied at ${recorded.applied_at})\n` +
            `  Found on Disk : ${diskChecksum}\n` +
            `  Applied migrations are immutable. Rollback or create a new forward migration!`
          );
        }
        console.log(`[OK] Version ${version} (${file}) already applied with verified checksum.`);
        continue;
      }

      // Check if we can baseline this specific migration in baseline mode
      if (isBaselineMode) {
        const schemaVerified = await isMigrationAlreadyAppliedInSchema(client, version);
        if (schemaVerified) {
          console.log(`[BASELINE] Version ${version} (${file}) schema objects verified in DB. Recording baseline checksum...`);
          await client.query(
            `INSERT INTO public.schema_migrations (version, filename, checksum, applied_at, execution_time_ms)
             VALUES ($1, $2, $3, now(), 0)
             ON CONFLICT (version) DO NOTHING;`,
            [version, file, diskChecksum]
          );
          baselineCount++;
          continue;
        } else {
          console.log(`[INFO] Version ${version} (${file}) not yet present in schema. Proceeding with execution.`);
        }
      }

      // Execute migration
      console.log(`[APPLYING] Version ${version} (${file})...`);
      const rawSql = fs.readFileSync(filePath, 'utf8');
      const sanitizedSql = sanitizeSqlForPg(rawSql);

      const startTime = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sanitizedSql);
        const duration = Date.now() - startTime;

        await client.query(
          `INSERT INTO public.schema_migrations (version, filename, checksum, applied_at, execution_time_ms)
           VALUES ($1, $2, $3, now(), $4);`,
          [version, file, diskChecksum, duration]
        );

        await client.query('COMMIT');
        console.log(`[PASS] Version ${version} (${file}) successfully applied in ${duration}ms.`);
        appliedCount++;
      } catch (execErr) {
        await client.query('ROLLBACK');
        throw new Error(
          `[MIGRATION FAILED] Error executing ${file} (version ${version}):\n${execErr.message}\n` +
          `Transaction rolled back. No partial changes committed.`
        );
      }
    }

    console.log('================================================================');
    console.log(`[COMPLETE] Migration runner finished successfully.`);
    console.log(`           Applied migrations : ${appliedCount}`);
    console.log(`           Baselined records  : ${baselineCount}`);
    console.log(`           Total tracked      : ${appliedMap.size + appliedCount + baselineCount}`);
    console.log('================================================================');

    process.exit(0);
  } catch (err) {
    console.error('\n[FATAL ERROR IN MIGRATION RUNNER]');
    console.error(err.message);
    process.exit(1);
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
        console.log('[INFO] Advisory lock released.');
      } catch (unlockErr) {
        console.error('[WARN] Failed to release advisory lock:', unlockErr.message);
      }
    }
    await client.end();
  }
}

main();
