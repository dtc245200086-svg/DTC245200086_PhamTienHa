#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE ISOLATED FRESH DATABASE BOOTSTRAP VERIFICATION
 * File: scripts/test-fresh-deployment.mjs
 *
 * Verifies clean rebuild reproducibility on an isolated ephemeral PostgreSQL
 * instance without touching the live database or pgdata volume.
 *
 * Execution Steps:
 * 1. Spin up ephemeral postgres container 'billing-fresh-test-pg' on isolated network.
 * 2. Wait for postgres initialization (01-schema -> 05-remediation).
 * 3. Run migration runner (scripts/migrate.mjs) - must apply 01 through 08.
 * 4. Run schema verification (scripts/verify-schema.mjs) - all checks must pass.
 * 5. Run migration runner second time - verify 0 rerun & checksum match.
 * 6. Cleanly destroy ephemeral test container and network.
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
        if (process.env[key] === undefined) process.env[key] = val;
      }
    }
  }
}

loadEnv();

const CONTAINER_NAME = 'billing-fresh-test-pg';
const NETWORK_NAME = 'billing_fresh_test_net';
const DB_NAME = 'billing';
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
const BILLING_APP_PASSWORD = process.env.BILLING_APP_PASSWORD;
const BILLING_READONLY_PASSWORD = process.env.BILLING_READONLY_PASSWORD;
const EXPORTER_PASSWORD = process.env.EXPORTER_PASSWORD || 'secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const STAFF_PASSWORD = process.env.STAFF_PASSWORD;

function runCmd(cmd, label) {
  console.log(`[EXEC] ${label}`);
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function cleanup() {
  console.log('[CLEANUP] Removing ephemeral test resources...');
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'ignore' });
  } catch {}
  try {
    execSync(`docker network rm ${NETWORK_NAME}`, { stdio: 'ignore' });
  } catch {}
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('================================================================');
  console.log('    BILLING_ONE ISOLATED FRESH DATABASE BOOTSTRAP TEST          ');
  console.log('================================================================\n');

  cleanup();

  try {
    // 1. Create isolated network
    runCmd(`docker network create ${NETWORK_NAME}`, 'Creating isolated network');

    // 2. Launch ephemeral PostgreSQL container
    const initDbPath = path.resolve(__dirname, '../db/init').replace(/\\/g, '/');
    const dockerRunCmd = [
      'docker run -d',
      `--name ${CONTAINER_NAME}`,
      `--network ${NETWORK_NAME}`,
      `-e POSTGRES_DB=${DB_NAME}`,
      '-e POSTGRES_USER=postgres',
      `-e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}"`,
      `-e BILLING_APP_PASSWORD="${BILLING_APP_PASSWORD}"`,
      `-e BILLING_READONLY_PASSWORD="${BILLING_READONLY_PASSWORD}"`,
      `-e EXPORTER_PASSWORD="${EXPORTER_PASSWORD}"`,
      `-e ADMIN_PASSWORD="${ADMIN_PASSWORD}"`,
      `-e STAFF_PASSWORD="${STAFF_PASSWORD}"`,
      `-v "${initDbPath}":/docker-entrypoint-initdb.d:ro`,
      'postgres:16.15-trixie'
    ].join(' ');

    runCmd(dockerRunCmd, 'Starting ephemeral Postgres container');

    // 3. Wait for Postgres to be fully initialized and final server ready
    console.log('[WAIT] Waiting for Postgres initialization and server restart...');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(2000);
      try {
        const logs = execSync(`docker logs ${CONTAINER_NAME} 2>&1`, { encoding: 'utf8' });
        // Postgres logs "PostgreSQL init process complete; ready for start up." then restarts and logs "database system is ready to accept connections"
        const initComplete = logs.includes('PostgreSQL init process complete; ready for start up.');
        if (initComplete) {
          const check = execSync(
            `docker exec ${CONTAINER_NAME} pg_isready -U postgres -d ${DB_NAME}`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          );
          if (check.includes('accepting connections')) {
            ready = true;
            console.log('[OK] Postgres final server is running and accepting connections.');
            break;
          }
        }
      } catch {}
    }

    if (!ready) {
      throw new Error('Timed out waiting for ephemeral Postgres container initialization.');
    }

    // Additional small safety grace period for socket binding
    await sleep(2000);

    // 4. Run Migration Runner against the fresh database
    console.log('\n--- Step 4: Running Migration Runner on Fresh Database ---');
    const runnerOut = execSync(
      'docker run --rm ' +
      `--network ${NETWORK_NAME} ` +
      `-e DB_HOST=${CONTAINER_NAME} ` +
      '-e DB_PORT=5432 ' +
      `-e DB_NAME=${DB_NAME} ` +
      '-e DB_USER=postgres ' +
      `-e DB_PASSWORD ` +
      `-v "${path.resolve(__dirname, '../db/migrations').replace(/\\/g, '/')}:/app/db/migrations:ro" ` +
      `-v "${path.resolve(__dirname, '../scripts').replace(/\\/g, '/')}:/app/scripts:ro" ` +
      'billing-migration ' +
      'node /app/scripts/migrate.mjs',
      {
        encoding: 'utf8',
        env: { ...process.env, DB_PASSWORD: POSTGRES_PASSWORD }
      }
    );
    console.log(runnerOut);

    const migrationsDir = path.resolve(__dirname, '../db/migrations');
    const expectedMigrationsCount = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && !f.endsWith('_down.sql')).length;

    if (!runnerOut.includes(`Applied migrations : ${expectedMigrationsCount}`)) {
      throw new Error(`Fresh database expected ${expectedMigrationsCount} applied migrations, got different count.`);
    }

    // 5. Run Schema Drift / Verification script against the fresh database
    console.log('\n--- Step 5: Running Schema Drift & Integrity Verification ---');
    const verifyOut = execSync(
      'docker run --rm ' +
      `--network ${NETWORK_NAME} ` +
      `-e DB_HOST=${CONTAINER_NAME} ` +
      '-e DB_PORT=5432 ' +
      `-e DB_NAME=${DB_NAME} ` +
      '-e DB_USER=postgres ' +
      `-e DB_PASSWORD ` +
      `-v "${path.resolve(__dirname, '../scripts').replace(/\\/g, '/')}:/app/scripts:ro" ` +
      'billing-migration ' +
      'node /app/scripts/verify-schema.mjs',
      {
        encoding: 'utf8',
        env: { ...process.env, DB_PASSWORD: POSTGRES_PASSWORD }
      }
    );
    console.log(verifyOut);

    if (!verifyOut.includes('VERIFICATION SUMMARY: 45 PASSED, 0 FAILED')) {
      throw new Error('Schema verification failed on fresh database.');
    }

    // 6. Test Migration Rerun on fresh database (Must apply 0, baseline 0)
    console.log('\n--- Step 6: Testing Migration Rerun on Fresh Database ---');
    const rerunOut = execSync(
      'docker run --rm ' +
      `--network ${NETWORK_NAME} ` +
      `-e DB_HOST=${CONTAINER_NAME} ` +
      '-e DB_PORT=5432 ' +
      `-e DB_NAME=${DB_NAME} ` +
      '-e DB_USER=postgres ' +
      `-e DB_PASSWORD ` +
      `-v "${path.resolve(__dirname, '../db/migrations').replace(/\\/g, '/')}:/app/db/migrations:ro" ` +
      `-v "${path.resolve(__dirname, '../scripts').replace(/\\/g, '/')}:/app/scripts:ro" ` +
      'billing-migration ' +
      'node /app/scripts/migrate.mjs',
      {
        encoding: 'utf8',
        env: { ...process.env, DB_PASSWORD: POSTGRES_PASSWORD }
      }
    );
    console.log(rerunOut);

    if (!rerunOut.includes('Applied migrations : 0')) {
      throw new Error('Migration rerun should have applied 0 migrations.');
    }

    console.log('================================================================');
    console.log('   FRESH DATABASE BOOTSTRAP VERIFICATION PASSED (100% REPRODUCIBLE) ');
    console.log('================================================================');
  } finally {
    cleanup();
  }
}

run().catch(err => {
  console.error('\n[FATAL FRESH DB TEST ERROR]', err.message);
  cleanup();
  process.exit(1);
});
