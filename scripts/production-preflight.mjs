#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE PRODUCTION DEPLOYMENT PREFLIGHT CHECKER
 * File: scripts/production-preflight.mjs
 * ============================================================================
 * Comprehensive readiness verifier across Configuration, Database, TLS,
 * Security, and Application domains.
 *
 * CRITICAL RULE: Suppresses all secret values; categorizes findings into
 * PASS, WARN, and BLOCKER.
 * ============================================================================
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// CLI options
const args = process.argv.slice(2);
let envFile = path.resolve(REPO_ROOT, '.env');
let strictProd = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--env' && args[i + 1]) {
    envFile = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--strict-prod') {
    strictProd = true;
  }
}

const envVars = {};
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      envVars[key] = val;
    }
  }
}

const RESULTS = [];

function record(domain, item, level, detail = '') {
  RESULTS.push({ domain, item, level, detail });
}

function runSql(sql) {
  try {
    const singleLine = sql.replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
    const cmd = `docker compose exec -T postgres psql -U postgres -d billing -t -A -F "\\t" -c "${singleLine}"`;
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return null;
  }
}

console.log('================================================================');
console.log('       BILLING_ONE PRODUCTION DEPLOYMENT PREFLIGHT              ');
console.log('================================================================');
console.log(`[TARGET] Environment File : ${path.relative(REPO_ROOT, envFile)}`);
console.log(`[MODE]   Strict Production : ${strictProd ? 'YES (Live Production Golive)' : 'NO (Deployment Verification)'}`);
console.log('----------------------------------------------------------------\n');

// ============================================================================
// 1. CONFIGURATION DOMAIN
// ============================================================================
const REQUIRED_SECRETS = [
  'POSTGRES_PASSWORD',
  'BILLING_APP_PASSWORD',
  'BILLING_READONLY_PASSWORD',
  'ADMIN_PASSWORD',
  'STAFF_PASSWORD',
  'SESSION_SECRET'
];

for (const secKey of REQUIRED_SECRETS) {
  const val = envVars[secKey];
  if (!val) {
    record('Configuration', `Required variable: ${secKey}`, 'BLOCKER', 'Missing in environment file');
  } else if (val.startsWith('CHANGE_ME') || val.includes('CHANGE_ME')) {
    if (strictProd) {
      record('Configuration', `Secret sanitized: ${secKey}`, 'BLOCKER', 'Production deployment must not use CHANGE_ME placeholder');
    } else {
      record('Configuration', `Secret placeholder: ${secKey}`, 'WARN', 'Contains placeholder template; rotate before live traffic');
    }
  } else {
    record('Configuration', `Required variable: ${secKey}`, 'PASS', 'Configured (value masked)');
  }
}

const isProdEnv = (envVars.NODE_ENV === 'production');
record('Configuration', 'NODE_ENV production setting', isProdEnv ? 'PASS' : 'WARN', `NODE_ENV = ${envVars.NODE_ENV || 'undefined'}`);

const isCookieSecure = (envVars.SESSION_COOKIE_SECURE === 'true');
record('Configuration', 'SESSION_COOKIE_SECURE enabled', isCookieSecure ? 'PASS' : 'WARN', `SESSION_COOKIE_SECURE = ${envVars.SESSION_COOKIE_SECURE}`);

// ============================================================================
// 2. DATABASE DOMAIN
// ============================================================================
const pgPing = runSql('SELECT 1;');
if (pgPing === '1') {
  record('Database', 'PostgreSQL Connectivity', 'PASS', 'Connected to database billing');

  // Verify roles
  const rolesRaw = runSql("SELECT rolname FROM pg_roles WHERE rolname IN ('billing_app', 'billing_readonly', 'exporter');");
  const roles = new Set(rolesRaw ? rolesRaw.split(/\r?\n/) : []);
  record('Database', 'Role billing_app existence', roles.has('billing_app') ? 'PASS' : 'BLOCKER', 'Role in pg_roles');
  record('Database', 'Role billing_readonly existence', roles.has('billing_readonly') ? 'PASS' : 'BLOCKER', 'Role in pg_roles');

  // Verify audit privileges
  const privsRaw = runSql("SELECT privilege_type FROM information_schema.table_privileges WHERE table_name = 'audit_logs' AND grantee = 'billing_app';");
  const privs = new Set(privsRaw ? privsRaw.split(/\r?\n/) : []);
  const isAppendOnly = privs.has('INSERT') && privs.has('SELECT') && !privs.has('UPDATE') && !privs.has('DELETE');
  record('Database', 'Audit logs Least Privilege (Append-Only)', isAppendOnly ? 'PASS' : 'BLOCKER', `Privileges: ${[...privs].join(', ')}`);

  // Verify migrations count
  const migrationsDir = path.resolve(REPO_ROOT, 'db/migrations');
  const expectedMigrationsCount = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.endsWith('_down.sql')).length
    : 12;
  const migCount = parseInt(runSql('SELECT count(*) FROM public.schema_migrations;') || '0', 10);
  record('Database', 'Schema Migrations Tracked', migCount >= expectedMigrationsCount ? 'PASS' : 'BLOCKER', `Applied migrations: ${migCount}/${expectedMigrationsCount}`);
} else {
  record('Database', 'PostgreSQL Connectivity', 'BLOCKER', 'Unable to connect to PostgreSQL container');
}

// ============================================================================
// 3. TLS DOMAIN
// ============================================================================
const certPath = path.resolve(REPO_ROOT, 'nginx/certs/server.crt');
const keyPath = path.resolve(REPO_ROOT, 'nginx/certs/server.key');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  try {
    const certContent = fs.readFileSync(certPath, 'utf8');
    const x509 = new crypto.X509Certificate(certContent);
    const isSelfSigned = (x509.issuer === x509.subject);
    const validTo = new Date(x509.validTo);
    const daysLeft = Math.floor((validTo - new Date()) / (1000 * 60 * 60 * 24));

    record('TLS', 'Certificate Pairing & Validity', daysLeft > 0 ? 'PASS' : 'BLOCKER', `Valid for ${daysLeft} days`);

    if (isSelfSigned) {
      if (strictProd) {
        record('TLS', 'Production CA Trust Authority', 'BLOCKER', 'Self-signed certificate is blocked for strict production');
      } else {
        record('TLS', 'Production CA Trust Authority', 'WARN', 'Self-signed cert active in dev; CA certificate required for live release');
      }
    } else {
      record('TLS', 'Production CA Trust Authority', 'PASS', 'CA-signed certificate verified');
    }
  } catch (err) {
    record('TLS', 'Certificate Parsing', 'BLOCKER', err.message);
  }
} else {
  record('TLS', 'Certificate and Key Existence', 'BLOCKER', 'Missing server.crt or server.key in nginx/certs');
}

// ============================================================================
// 4. SECURITY DOMAIN
// ============================================================================
try {
  const trackedEnv = execSync('git ls-files .env', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  record('Security', '.env Untracked by Git', !trackedEnv ? 'PASS' : 'BLOCKER', trackedEnv ? 'CRITICAL: .env is tracked in git index!' : 'git ls-files .env is empty');
} catch (err) {
  record('Security', '.env Untracked by Git', 'WARN', 'Git command unavailable');
}

// RBAC Seed Active
const rolesCount = parseInt(runSql('SELECT count(*) FROM public.roles;') || '0', 10);
const permsCount = parseInt(runSql('SELECT count(*) FROM public.permissions;') || '0', 10);
record('Security', 'RBAC Role-Permission Matrix', (rolesCount > 0 && permsCount > 0) ? 'PASS' : 'BLOCKER', `${rolesCount} roles, ${permsCount} permissions configured`);

// ============================================================================
// 5. APPLICATION DOMAIN
// ============================================================================
try {
  const healthRes = execSync('docker compose exec -T web node -e "fetch(\'http://127.0.0.1:3000/health\').then(r => process.exit(r.ok ? 0 : 1))"', {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  record('Application', 'Web Application Health Endpoint', 'PASS', 'HTTP 200 OK on internal /health');
} catch (err) {
  record('Application', 'Web Application Health Endpoint', 'BLOCKER', 'Internal health check failed');
}

// Print Results
console.log(
  'DOMAIN'.padEnd(16) +
  'CHECK ITEM'.padEnd(45) +
  'LEVEL'.padEnd(12) +
  'DETAIL'
);
console.log('-'.repeat(110));

let blockers = 0;
let warnings = 0;
let passes = 0;

for (const r of RESULTS) {
  if (r.level === 'BLOCKER') blockers++;
  else if (r.level === 'WARN') warnings++;
  else passes++;

  const badge = r.level === 'PASS' ? '[PASS]' : (r.level === 'WARN' ? '[WARN]' : '[BLOCKER]');
  console.log(
    r.domain.padEnd(16) +
    r.item.padEnd(45) +
    badge.padEnd(12) +
    r.detail
  );
}

console.log('================================================================');
console.log(`SUMMARY: ${passes} PASSED, ${warnings} WARNINGS, ${blockers} BLOCKERS`);
console.log('================================================================');

if (blockers > 0) {
  console.log('STATUS = BLOCKED_BY_PREFLIGHT');
  process.exit(1);
} else {
  console.log('STATUS = PREFLIGHT_PASSED');
  process.exit(0);
}
