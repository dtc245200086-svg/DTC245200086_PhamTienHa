#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE FULL REPOSITORY REGRESSION RUNNER
 * File: scripts/run-all-tests.mjs
 * ============================================================================
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim();
        process.env[key] = val;
      }
    }
  }
}
loadEnv();

const ACTIVE_SUITES = [
  // Group A — P0 / Security
  'p0-security-audit-test.mjs',
  'p0-remediation-test.mjs',
  'cp2-smoke.mjs',

  // Group B — Core accounting/lifecycle
  'p1-refund-ledger-test.mjs',
  'p1_2-payment-allocation-test.mjs',
  'p1_2_1-idempotency-test.mjs',
  'p1_2_2-mandatory-idempotency-test.mjs',
  'p1_3-auto-settlement-test.mjs',
  'p1_3_1-remediation-test.mjs',
  'p1_4-overdue-lifecycle-test.mjs',

  // Group C — Credit/RBAC
  'p1_5-domain-service-test.mjs',
  'p1_5-gate3-rbac-issue-test.mjs',
  'p1_5-gate4-customer-hardening-test.mjs',
  'p1_5-gate5-manager-override-test.mjs',
  'p1_5-gate6-manual-unlock-test.mjs',
  'p1_5-gate7-risk-scanner-test.mjs',
  'p1_5-gate8-rbac-permission-test.mjs',
  'p1_5-gate9-frontend-credit-risk-test.mjs',
  'p1_5-gate10-frontend-unlock-risk-test.mjs',
  'p1_5-gate10-idempotency-lifecycle-test.mjs',

  // Group D — Financial Core
  'p1-gate-c-payment-terms-test.mjs',
  'p1-gate-d-mixed-vat-test.mjs',
  'p1-gate-e-dso-cei-test.mjs',

  // Group E — P1/P2 final
  'p1-gate-h-refund-settlement-test.mjs',
  'p1-gate-i-recurring-risk-test.mjs',
  'p1-gate-j-reconciliation-dedup-test.mjs',
  'p1-gate-k-vat-reporting-test.mjs',
  'p2-gate-l-documents-test.mjs',

  // Group F — Extended / E2E
  'extended-features-test.mjs',
  'frontend-e2e-test.mjs',

  // Group G — Integrity
  'verify-audit-chain.mjs'
];

const LEGACY_DEPRECATED_SUITES = [
  {
    file: 'remediation-verification.mjs',
    reason: 'Pre-P1.1 legacy expectation asserting obsolete CREDIT_NOTE payment method in cash ledger'
  }
];

const SUITE_TIMEOUT_MS = 180000; // 180 seconds per suite

console.log('================================================================');
console.log('      BILLING_ONE COMPLETE REPOSITORY REGRESSION RUNNER         ');
console.log(`      Active Release Gates     : ${ACTIVE_SUITES.length}`);
console.log(`      Legacy / Deprecated      : ${LEGACY_DEPRECATED_SUITES.length}`);
console.log(`      Per-Suite Timeout        : ${SUITE_TIMEOUT_MS / 1000}s`);
console.log('================================================================\n');

const activeResults = [];
let totalActivePassed = 0;
let totalActiveFailed = 0;
let totalActiveTimeout = 0;
const overallStart = Date.now();

console.log('--- EXECUTING ACTIVE GATES ---');
for (let i = 0; i < ACTIVE_SUITES.length; i++) {
  const suite = ACTIVE_SUITES[i];
  const suitePath = path.resolve(__dirname, suite);
  process.stdout.write(`[${String(i + 1).padStart(2, '0')}/${ACTIVE_SUITES.length}] Running ${suite.padEnd(44, ' ')} ... `);

  let status = 'FAIL';
  let duration = '0.00s';
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try { execSync('docker compose restart nginx', { stdio: 'ignore' }); } catch {}
    const start = Date.now();
    try {
      execSync(`node "${suitePath}"`, {
        encoding: 'utf8',
        env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: SUITE_TIMEOUT_MS
      });
      duration = ((Date.now() - start) / 1000).toFixed(2);
      status = 'PASS';
      break;
    } catch (err) {
      duration = ((Date.now() - start) / 1000).toFixed(2);
      lastErr = err;
      if (err.code === 'ETIMEDOUT' || err.killed) {
        status = 'TIMEOUT';
        break; // Do not retry timed-out suites
      }
      const combined = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + (err.message || '');
      if (
        combined.includes('429') ||
        combined.includes('Too Many Requests') ||
        combined.includes('RATE_LIMIT') ||
        combined.includes('SyntaxError: Unexpected token') ||
        combined.includes('<html>')
      ) {
        try { execSync('docker compose restart nginx', { stdio: 'ignore' }); } catch {}
        continue;
      }
      break;
    }
  }

  if (status === 'PASS') {
    console.log(`PASS (${duration}s)`);
    activeResults.push({ suite, status: 'PASS', duration: `${duration}s`, error: null });
    totalActivePassed++;
  } else if (status === 'TIMEOUT') {
    console.log(`TIMEOUT (${duration}s)`);
    activeResults.push({
      suite,
      status: 'TIMEOUT',
      duration: `${duration}s`,
      command: `node "${suitePath}"`,
      error: `Execution exceeded ${SUITE_TIMEOUT_MS / 1000}s timeout.`
    });
    totalActiveTimeout++;
  } else {
    console.log(`FAIL (${duration}s)`);
    const errorDetails = (lastErr?.stdout || '') + '\n' + (lastErr?.stderr || '') + '\n' + (lastErr?.message || '');
    activeResults.push({
      suite,
      status: 'FAIL',
      duration: `${duration}s`,
      command: `node "${suitePath}"`,
      error: errorDetails.trim().slice(-600)
    });
    totalActiveFailed++;
  }
}

console.log('\n--- EXECUTING LEGACY / DEPRECATED SUITES (INFORMATIONAL) ---');
const legacyResults = [];
let totalLegacyPassed = 0;
let totalLegacyExpected = 0;
let totalLegacyUnexpected = 0;

for (let i = 0; i < LEGACY_DEPRECATED_SUITES.length; i++) {
  const item = LEGACY_DEPRECATED_SUITES[i];
  const suitePath = path.resolve(__dirname, item.file);
  process.stdout.write(`[LEGACY ${i + 1}/${LEGACY_DEPRECATED_SUITES.length}] ${item.file.padEnd(40, ' ')} ... `);

  const start = Date.now();
  try {
    const stdout = execSync(`node "${suitePath}"`, {
      encoding: 'utf8',
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: SUITE_TIMEOUT_MS
    });
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`EXPECTED/DEPRECATED (${duration}s)`);
    legacyResults.push({ suite: item.file, status: 'EXPECTED_DEPRECATED', duration: `${duration}s`, reason: item.reason });
    totalLegacyPassed++;
    totalLegacyExpected++;
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`UNEXPECTED FAIL (${duration}s)`);
    legacyResults.push({ suite: item.file, status: 'UNEXPECTED_FAIL', duration: `${duration}s`, reason: item.reason, error: err.message });
    totalLegacyUnexpected++;
  }
}

const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(2);

console.log('\n================================================================');
console.log('                 REGRESSION EXECUTION SUMMARY                   ');
console.log('================================================================');
console.log('ACTIVE SUITES:');
console.log(`  Passed  : ${totalActivePassed}`);
console.log(`  Failed  : ${totalActiveFailed}`);
console.log(`  Timeout : ${totalActiveTimeout}`);
console.log('----------------------------------------------------------------');
console.log('LEGACY/DEPRECATED SUITES:');
console.log(`  Passed              : ${totalLegacyPassed}`);
console.log(`  Expected/Deprecated : ${totalLegacyExpected}`);
console.log(`  Unexpected          : ${totalLegacyUnexpected}`);
console.log('----------------------------------------------------------------');
console.log(`Total Active Suites : ${ACTIVE_SUITES.length}`);
console.log(`Total Duration      : ${totalDuration}s`);
console.log('================================================================');

if (totalActiveFailed > 0 || totalActiveTimeout > 0) {
  console.log('\nFAILED / TIMED-OUT ACTIVE GATES:');
  for (const r of activeResults.filter(r => r.status !== 'PASS')) {
    console.log(`\n--- [${r.status}] ${r.suite} (${r.duration}) ---`);
    console.log(`Command: ${r.command}`);
    console.log(r.error);
  }
  process.exit(1);
} else {
  console.log(`\n[ALL ACTIVE GATES PASSED] ${totalActivePassed}/${ACTIVE_SUITES.length} ACTIVE SUITES VERIFIED GREEN!`);
  process.exit(0);
}
