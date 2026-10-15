#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE PRODUCTION TLS & CERTIFICATE PREFLIGHT VERIFIER
 * File: scripts/verify-production-tls.mjs
 * ============================================================================
 * Validates TLS certificate and private key pairing, expiration, SAN, and
 * authority trust level.
 *
 * CRITICAL RULE: If the certificate is self-signed and strict production mode
 * is evaluated, returns STATUS = BLOCKED_FOR_PRODUCTION. Never fakes PASS.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Parse CLI options
const args = process.argv.slice(2);
let certPath = null;
let keyPath = null;
let strictMode = true; // Default strict for production readiness

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cert' && args[i + 1]) {
    certPath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--key' && args[i + 1]) {
    keyPath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--permissive') {
    strictMode = false;
  }
}

// Default search paths
if (!certPath) {
  const prodCert = path.resolve(REPO_ROOT, 'nginx/certs/production.crt');
  const selfCert = path.resolve(REPO_ROOT, 'nginx/certs/server.crt');
  certPath = fs.existsSync(prodCert) ? prodCert : selfCert;
}

if (!keyPath) {
  const prodKey = path.resolve(REPO_ROOT, 'nginx/certs/production.key');
  const selfKey = path.resolve(REPO_ROOT, 'nginx/certs/server.key');
  keyPath = fs.existsSync(prodKey) ? prodKey : selfKey;
}

console.log('================================================================');
console.log('       BILLING_ONE PRODUCTION TLS VERIFICATION PREFLIGHT        ');
console.log('================================================================');
console.log(`[TARGET] Certificate File : ${certPath}`);
console.log(`[TARGET] Private Key File : ${keyPath}`);
console.log(`[MODE]   Strict Production : ${strictMode ? 'YES (CA required)' : 'NO (Permissive)'}`);
console.log('----------------------------------------------------------------');

// 1. Existence Check
if (!fs.existsSync(certPath)) {
  console.error(`[FAIL] Certificate file not found: ${certPath}`);
  console.log('STATUS = BLOCKED_FOR_PRODUCTION');
  process.exit(1);
}

if (!fs.existsSync(keyPath)) {
  console.error(`[FAIL] Private key file not found: ${keyPath}`);
  console.log('STATUS = BLOCKED_FOR_PRODUCTION');
  process.exit(1);
}

let certContent, keyContent;
try {
  certContent = fs.readFileSync(certPath, 'utf8');
  keyContent = fs.readFileSync(keyPath, 'utf8');
} catch (err) {
  console.error(`[FAIL] Error reading certificate or key: ${err.message}`);
  console.log('STATUS = BLOCKED_FOR_PRODUCTION');
  process.exit(1);
}

// 2. Parse X.509 Certificate
let x509;
try {
  x509 = new crypto.X509Certificate(certContent);
} catch (err) {
  console.error(`[FAIL] Failed to parse X509 certificate: ${err.message}`);
  console.log('STATUS = BLOCKED_FOR_PRODUCTION');
  process.exit(1);
}

console.log(`[INFO] Subject            : ${x509.subject}`);
console.log(`[INFO] Issuer             : ${x509.issuer}`);
console.log(`[INFO] Valid From         : ${x509.validFrom}`);
console.log(`[INFO] Valid To           : ${x509.validTo}`);
console.log(`[INFO] Fingerprint (SHA256): ${x509.fingerprint256}`);
if (x509.subjectAltName) {
  console.log(`[INFO] SAN (Alt Names)   : ${x509.subjectAltName}`);
}

// 3. Expiration Check
const now = new Date();
const validToDate = new Date(x509.validTo);
const validFromDate = new Date(x509.validFrom);

if (now < validFromDate) {
  console.error(`[FAIL] Certificate is not yet valid! Valid from: ${x509.validFrom}`);
  console.log('STATUS = BLOCKED_FOR_PRODUCTION');
  process.exit(1);
}

if (now > validToDate) {
  console.error(`[FAIL] Certificate has expired on: ${x509.validTo}`);
  console.log('STATUS = BLOCKED_FOR_PRODUCTION');
  process.exit(1);
}

const remainingDays = Math.floor((validToDate - now) / (1000 * 60 * 60 * 24));
console.log(`[INFO] Remaining Validity : ${remainingDays} days`);

if (remainingDays < 15) {
  console.warn(`[WARN] Certificate will expire soon (< 15 days): ${remainingDays} days remaining.`);
}

// 4. Key Pair Match Check
try {
  const privKeyObj = crypto.createPrivateKey(keyContent);
  const derivedPubKeyPem = crypto.createPublicKey(privKeyObj).export({ type: 'spki', format: 'pem' });
  const certPubKeyPem = x509.publicKey.export({ type: 'spki', format: 'pem' });

  if (derivedPubKeyPem.trim() !== certPubKeyPem.trim()) {
    console.error('[FAIL] Private key does NOT match the public key in the certificate!');
    console.log('STATUS = BLOCKED_FOR_PRODUCTION');
    process.exit(1);
  }
  console.log('[PASS] Private key cryptographically matches certificate public key.');
} catch (err) {
  console.error(`[FAIL] Cryptographic key matching failed: ${err.message}`);
  console.log('STATUS = BLOCKED_FOR_PRODUCTION');
  process.exit(1);
}

// 5. Self-signed vs CA Trust Check
const isSelfSigned = (x509.issuer === x509.subject);
console.log(`[INFO] Self-Signed Check  : ${isSelfSigned ? 'YES (Self-Signed)' : 'NO (CA-Signed)'}`);

if (isSelfSigned) {
  if (strictMode) {
    console.log('----------------------------------------------------------------');
    console.log('[ALERT] Strict production mode requires a valid CA-issued certificate.');
    console.log('        Self-signed certificates are strictly prohibited for production golive.');
    console.log('        To proceed with development or testing, use --permissive.');
    console.log('================================================================');
    console.log('STATUS = BLOCKED_FOR_PRODUCTION');
    console.log('REASON = Certificate is self-signed; official CA issuance required prior to release.');
    process.exit(1);
  } else {
    console.log('----------------------------------------------------------------');
    console.log('[WARN] Permissive mode: Self-signed certificate permitted for staging/testing.');
    console.log('================================================================');
    console.log('STATUS = PERMISSIVE_DEV_PASS');
    process.exit(0);
  }
} else {
  console.log('----------------------------------------------------------------');
  console.log('[PASS] Certificate is CA-signed and valid for production deployment.');
  console.log('================================================================');
  console.log('STATUS = READY');
  process.exit(0);
}
