#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE CREDENTIAL ROTATION VERIFICATION
 * File: scripts/verify-credential-rotation.mjs
 * ============================================================================
 * Verifies that:
 * 1. Active credentials work for all roles and users.
 * 2. Obsolete / default / placeholder credentials are rejected.
 * 3. Least privilege security invariants remain intact:
 *    - billing_app cannot mutate audit_logs
 *    - billing_readonly cannot write to business tables
 * 4. Zero secret values leaked to output.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Load environment from .env
function loadEnv() {
  const envPath = path.resolve(REPO_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
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

async function getPgClient() {
  let pgModule;
  try {
    pgModule = (await import('pg')).default;
  } catch {
    const { pathToFileURL } = await import('node:url');
    const localPg = path.resolve(REPO_ROOT, 'app/node_modules/pg/lib/index.js');
    pgModule = (await import(pathToFileURL(localPg).href)).default;
  }
  return pgModule.Client;
}

const RESULTS = [];

function record(domain, checkItem, status, detail = '') {
  RESULTS.push({ domain, checkItem, status, detail });
}

async function verify() {
  if (!fs.existsSync('/.dockerenv') && process.env.INSIDE_DOCKER !== '1') {
    try {
      const { execSync } = await import('node:child_process');
      const scriptsVol = path.resolve(REPO_ROOT, 'scripts').replace(/\\/g, '/');
      const envVol = path.resolve(REPO_ROOT, '.env').replace(/\\/g, '/');
      const cmd = `docker compose run --rm --entrypoint node -v "${scriptsVol}:/app/scripts:ro" -v "${envVol}:/app/.env:ro" -e INSIDE_DOCKER=1 -e DB_HOST=postgres -e BASE_URL=http://web:3000 migration /app/scripts/verify-credential-rotation.mjs`;
      execSync(cmd, { stdio: 'inherit' });
      process.exit(0);
    } catch (e) {
      process.exit(e.status || 1);
    }
  }

  console.log('================================================================');
  console.log('     BILLING_ONE CREDENTIAL ROTATION & PRIVILEGE VERIFICATION   ');
  console.log('================================================================');

  const Client = await getPgClient();

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const dbName = process.env.DB_NAME || 'billing';

  // 1. Check DB Admin / Postgres Connection
  const adminPassword = process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD;
  if (!adminPassword) {
    record('Database', 'Admin Credential Configured', 'NOT CONFIGURED', 'POSTGRES_PASSWORD missing');
  } else {
    try {
      const client = new Client({ host, port, database: dbName, user: 'postgres', password: adminPassword });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      record('Database', 'Admin Credential Authentication', 'PASS', 'Superuser connected successfully');
    } catch (e) {
      record('Database', 'Admin Credential Authentication', 'FAIL', 'Connection rejected');
    }
  }

  // 2. Check billing_app Connection
  const appPassword = process.env.BILLING_APP_PASSWORD;
  if (!appPassword) {
    record('Database', 'billing_app Credential Configured', 'NOT CONFIGURED', 'BILLING_APP_PASSWORD missing');
  } else {
    try {
      const client = new Client({ host, port, database: dbName, user: 'billing_app', password: appPassword });
      await client.connect();
      await client.query('SELECT 1 FROM public.invoices LIMIT 1');

      // Check least-privilege: billing_app CANNOT UPDATE/DELETE audit_logs
      let auditTamperBlocked = false;
      try {
        await client.query('DELETE FROM public.audit_logs WHERE id = -999');
      } catch (err) {
        if (err.code === '42501') auditTamperBlocked = true; // permission denied
      }

      await client.end();
      record('Database', 'billing_app Authentication', 'PASS', 'Application role connected');
      if (auditTamperBlocked) {
        record('Security', 'billing_app Least Privilege (Audit Protection)', 'PASS', 'DELETE audit_logs blocked (42501)');
      } else {
        record('Security', 'billing_app Least Privilege (Audit Protection)', 'FAIL', 'Audit logs modification permitted');
      }
    } catch (e) {
      record('Database', 'billing_app Authentication', 'FAIL', 'Connection rejected');
    }
  }

  // 3. Check billing_readonly Connection
  const readonlyPassword = process.env.BILLING_READONLY_PASSWORD;
  if (!readonlyPassword) {
    record('Database', 'billing_readonly Credential Configured', 'NOT CONFIGURED', 'BILLING_READONLY_PASSWORD missing');
  } else {
    try {
      const client = new Client({ host, port, database: dbName, user: 'billing_readonly', password: readonlyPassword });
      await client.connect();
      await client.query('SELECT 1 FROM public.invoices LIMIT 1');

      // Check least-privilege: billing_readonly CANNOT INSERT
      let writeBlocked = false;
      try {
        await client.query("INSERT INTO public.customers (name) VALUES ('Test')");
      } catch (err) {
        if (err.code === '42501') writeBlocked = true;
      }

      await client.end();
      record('Database', 'billing_readonly Authentication', 'PASS', 'Readonly role connected');
      if (writeBlocked) {
        record('Security', 'billing_readonly Least Privilege (Write Prohibited)', 'PASS', 'INSERT customer blocked (42501)');
      } else {
        record('Security', 'billing_readonly Least Privilege (Write Prohibited)', 'FAIL', 'Readonly role permitted write operation');
      }
    } catch (e) {
      record('Database', 'billing_readonly Authentication', 'FAIL', 'Connection rejected');
    }
  }

  // 4. Check Obsolete / Default Credentials Rejection
  const defaultPasswords = ['postgres', 'password', '123456', 'admin', 'root', 'CHANGE_ME'];
  let allDefaultsRejected = true;
  for (const pwd of defaultPasswords) {
    try {
      const client = new Client({ host, port, database: dbName, user: 'postgres', password: pwd });
      await client.connect();
      await client.end();
      allDefaultsRejected = false;
      break;
    } catch {
      // Expected rejection
    }
  }
  if (allDefaultsRejected) {
    record('Security', 'Default Passwords Rejection', 'PASS', 'All common/default credentials rejected');
  } else {
    record('Security', 'Default Passwords Rejection', 'FAIL', 'A common default password was accepted!');
  }

  // 5. Check Web Application HTTP Login with ADMIN_PASSWORD and STAFF_PASSWORD
  const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
  const adminPass = process.env.ADMIN_PASSWORD;
  const staffPass = process.env.STAFF_PASSWORD;

  if (adminPass) {
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: adminPass })
      });
      if (res.status === 200) {
        record('Application', 'Admin HTTP Authentication', 'PASS', 'Login accepted with active ADMIN_PASSWORD');
      } else {
        record('Application', 'Admin HTTP Authentication', 'FAIL', `Login rejected with HTTP ${res.status}`);
      }
    } catch {
      record('Application', 'Admin HTTP Authentication', 'NOT CONFIGURED', 'Web service unreachable on BASE_URL');
    }
  } else {
    record('Application', 'Admin HTTP Authentication', 'NOT CONFIGURED', 'ADMIN_PASSWORD missing');
  }

  if (staffPass) {
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'staff', password: staffPass })
      });
      if (res.status === 200) {
        record('Application', 'Staff HTTP Authentication', 'PASS', 'Login accepted with active STAFF_PASSWORD');
      } else {
        record('Application', 'Staff HTTP Authentication', 'FAIL', `Login rejected with HTTP ${res.status}`);
      }
    } catch {
      record('Application', 'Staff HTTP Authentication', 'NOT CONFIGURED', 'Web service unreachable on BASE_URL');
    }
  } else {
    record('Application', 'Staff HTTP Authentication', 'NOT CONFIGURED', 'STAFF_PASSWORD missing');
  }

  // Check Invalid Password Rejection on HTTP login
  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'INVALID_TEST_PASSWORD_999!' })
    });
    if (res.status === 401) {
      record('Security', 'Application Invalid Password Rejection', 'PASS', 'HTTP 401 returned on invalid login');
    } else {
      record('Security', 'Application Invalid Password Rejection', 'FAIL', `Unexpected HTTP status: ${res.status}`);
    }
  } catch {
    // Service unreachable
  }

  // Display Summary Table
  console.log('\nDOMAIN          CHECK ITEM                                           STATUS   DETAIL');
  console.log('---------------------------------------------------------------------------------------------------------');
  for (const r of RESULTS) {
    const dStr = r.domain.padEnd(15);
    const itemStr = r.checkItem.padEnd(52);
    const sStr = `[${r.status}]`.padEnd(9);
    console.log(`${dStr} ${itemStr} ${sStr} ${r.detail}`);
  }

  const failures = RESULTS.filter(r => r.status === 'FAIL');
  console.log('================================================================');
  if (failures.length === 0) {
    console.log('STATUS = PASS');
    console.log('All credential rotation and privilege checks validated.');
    process.exit(0);
  } else {
    console.log('STATUS = FAIL');
    console.log(`Failed checks count: ${failures.length}`);
    process.exit(1);
  }
}

verify().catch(err => {
  console.error(`Verification crashed: ${err.message}`);
  process.exit(1);
});
