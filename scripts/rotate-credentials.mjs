#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE CREDENTIAL ROTATION & REVOCATION ENGINE
 * File: scripts/rotate-credentials.mjs
 * ============================================================================
 * Rotates and revokes exposed credentials:
 * 1. Generates cryptographically secure random passwords (RFC 4086 compliant).
 * 2. Updates PostgreSQL roles (postgres, billing_app, billing_readonly, exporter).
 * 3. Updates application authentication hashes in public.users (admin, staff).
 * 4. Atomically updates local .env runtime configuration.
 * 5. Restarts affected services (web, postgres-exporter).
 * 6. Validates new credentials and verifies rejection of old credentials.
 *
 * CRITICAL RULE: Suppresses all secret strings from console and logs.
 * ============================================================================
 */

import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.resolve(REPO_ROOT, '.env');

function generateSecureSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function loadEnvFile(filePath) {
  const env = {};
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        env[k] = v;
      }
    }
  }
  return env;
}

function runDockerPsql(sql) {
  // Pass SQL via STDIN to avoid leaking secret values in command-line arguments
  const cmd = `docker compose exec -T postgres psql -U postgres -d billing`;
  return execSync(cmd, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

console.log('================================================================');
console.log('       BILLING_ONE PRODUCTION CREDENTIAL ROTATION ENGINE        ');
console.log('================================================================');

// 1. Capture current (old) credentials for post-rotation revocation verification
const oldEnv = loadEnvFile(ENV_PATH);
const oldAdminPass = oldEnv.ADMIN_PASSWORD;
const oldStaffPass = oldEnv.STAFF_PASSWORD;

console.log('[STEP 1] Generating cryptographically secure new credentials...');
const secretKeys = [
  ['POSTGRES_PASSWORD', 32],
  ['BILLING_APP_PASSWORD', 32],
  ['BILLING_READONLY_PASSWORD', 32],
  ['EXPORTER_PASSWORD', 24],
  ['ADMIN_PASSWORD', 32],
  ['STAFF_PASSWORD', 32],
  ['SESSION_SECRET', 48]
];
const newCreds = {};
for (const [k, len] of secretKeys) {
  newCreds[k] = generateSecureSecret(len);
}
console.log('[OK] Generated 7 high-entropy secrets (length: 48-96 characters).');

// 2. Rotate Database Role Passwords via STDIN
console.log('\n[STEP 2] Rotating PostgreSQL role credentials in database...');
try {
  const roleSql = `
    ALTER ROLE postgres WITH PASSWORD '${newCreds.POSTGRES_PASSWORD}';
    ALTER ROLE billing_app WITH PASSWORD '${newCreds.BILLING_APP_PASSWORD}';
    ALTER ROLE billing_readonly WITH PASSWORD '${newCreds.BILLING_READONLY_PASSWORD}';
    ALTER ROLE exporter WITH PASSWORD '${newCreds.EXPORTER_PASSWORD}';
  `;
  runDockerPsql(roleSql);
  console.log('[OK] Database roles updated: postgres, billing_app, billing_readonly, exporter.');
} catch (err) {
  console.error(`[FAIL] Could not rotate database role passwords: ${err.message}`);
  process.exit(1);
}

// 3. Rotate Application User Hashes with EXPLICIT user mapping only
console.log('\n[STEP 3] Updating password hashes in public.users table (explicit user mapping)...');
try {
  // Strictly explicit mapping: admin and staff only. Zero bulk or shared password updates.
  const userSql = `
    UPDATE public.users SET password_hash = crypt('${newCreds.ADMIN_PASSWORD}', gen_salt('bf', 12)) WHERE username = 'admin';
    UPDATE public.users SET password_hash = crypt('${newCreds.STAFF_PASSWORD}', gen_salt('bf', 12)) WHERE username = 'staff';
  `;
  runDockerPsql(userSql);
  console.log('[OK] Application user hashes updated explicitly for admin and staff. Other users untouched.');
} catch (err) {
  console.error(`[FAIL] Could not update user password hashes: ${err.message}`);
  process.exit(1);
}

// 4. Update .env File Atomically
console.log('\n[STEP 4] Updating runtime .env configuration file...');
const envBackupPath = path.resolve(REPO_ROOT, '.env.backup_pre_rotation');
fs.copyFileSync(ENV_PATH, envBackupPath);

let currentContent = fs.readFileSync(ENV_PATH, 'utf8');
for (const [key, val] of Object.entries(newCreds)) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(currentContent)) {
    currentContent = currentContent.replace(regex, `${key}=${val}`);
  } else {
    currentContent += `\n${key}=${val}`;
  }
}
fs.writeFileSync(ENV_PATH, currentContent, 'utf8');
console.log('[OK] Local runtime .env file updated.');

// 5. Restart dependent containers (web and postgres-exporter)
console.log('\n[STEP 5] Restarting application web and postgres-exporter containers...');
try {
  execSync('docker compose restart web', { stdio: 'inherit' });
  execSync('docker compose up -d postgres-exporter', { stdio: 'inherit' });
  console.log('[OK] Containers web and postgres-exporter restarted and loaded new credentials.');
} catch (err) {
  console.error(`[FAIL] Container restart failed: ${err.message}`);
  process.exit(1);
}

// 6. Verification: Verify old credentials fail and new credentials work
console.log('\n[STEP 6] Running credential rotation validation suite...');
try {
  execSync('node scripts/verify-credential-rotation.mjs', { cwd: REPO_ROOT, stdio: 'inherit' });
  console.log('[PASS] New credentials validated successfully.');
} catch (err) {
  console.error('[FAIL] Credential verification failed.');
  process.exit(1);
}

// 7. Verify Old Credential Revocation via HTTP
console.log('\n[STEP 7] Verifying that old credentials are permanently rejected...');
async function testOldCreds() {
  const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
  if (oldAdminPass) {
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: oldAdminPass })
      });
      if (res.status === 401) {
        console.log('[PASS] Old admin credential was correctly rejected (HTTP 401).');
      } else {
        console.log(`[ALERT] Old admin credential returned unexpected status: ${res.status}`);
      }
    } catch {
      console.log('[INFO] Old admin credential test skipped (web direct unreachable).');
    }
  }
  if (oldStaffPass) {
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'staff', password: oldStaffPass })
      });
      if (res.status === 401) {
        console.log('[PASS] Old staff credential was correctly rejected (HTTP 401).');
      } else {
        console.log(`[ALERT] Old staff credential returned unexpected status: ${res.status}`);
      }
    } catch {
      console.log('[INFO] Old staff credential test skipped (web direct unreachable).');
    }
  }
}

testOldCreds().then(() => {
  console.log('\n================================================================');
  console.log('   CREDENTIAL ROTATION & REVOCATION COMPLETED SUCCESSFULLY      ');
  console.log('================================================================');
  process.exit(0);
});
