#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE RELEASE ARTIFACT BUILDER & SANITIZER
 * File: scripts/build-release-package.mjs
 * ============================================================================
 * Packages production-safe assets into release candidate ZIP artifact.
 *
 * RIGOROUS SAFETY INVARIANTS:
 * 1. Excludes all runtime .env, certificates, private keys, node_modules, and logs.
 * 2. Runs automated secret hygiene scanner on staging directory BEFORE compression.
 * 3. Inspects and audits ZIP file contents AFTER compression.
 * ============================================================================
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const VERSION = '2.0.0';
const RELEASE_DIR = path.resolve(REPO_ROOT, 'release');
const STAGING_DIR = path.resolve(RELEASE_DIR, `staging_v${VERSION}`);
const ARTIFACT_NAME = `Billing_One_Extended_RELEASE_CANDIDATE_${VERSION}.zip`;
const ARTIFACT_PATH = path.resolve(RELEASE_DIR, ARTIFACT_NAME);

// Excluded patterns during copy
const EXCLUDED_NAMES = new Set([
  '.git',
  '.gemini',
  'node_modules',
  '.env',
  '.env.local',
  'server.key',
  'server.crt',
  'production.key',
  'production.crt',
  'certs',
  'pgdata',
  'pgadmin_data',
  'prometheus_data',
  'grafana_data',
  'release',
  'backups'
]);

const EXCLUDED_EXTENSIONS = new Set([
  '.key',
  '.pem',
  '.p12',
  '.pfx',
  '.ppk',
  '.log',
  '.dump',
  '.backup',
  '.bak',
  '.tmp'
]);

function shouldExclude(sourcePath) {
  const normPath = sourcePath.replace(/\\/g, '/');
  const baseName = path.basename(sourcePath);
  if (EXCLUDED_NAMES.has(baseName)) return true;
  // Strictly exclude db/backups directory and all backup contents
  if (normPath.includes('/db/backups') || normPath.endsWith('/db/backups') || baseName === 'backups') {
    return true;
  }
  if (baseName.startsWith('.env') && baseName !== '.env.example' && baseName !== '.env.production.example') {
    return true;
  }
  // Exclude standalone database backup/dump files while preserving db/init and db/migrations
  if (baseName.toLowerCase().includes('backup') && baseName.toLowerCase().endsWith('.sql')) {
    return true;
  }
  if (baseName.toLowerCase().includes('dump') && baseName.toLowerCase().endsWith('.sql')) {
    return true;
  }
  const ext = path.extname(sourcePath).toLowerCase();
  if (EXCLUDED_EXTENSIONS.has(ext)) return true;
  return false;
}

function copyRecursive(src, dest) {
  if (shouldExclude(src)) return;

  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else if (stat.isFile()) {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

console.log('================================================================');
console.log('       BILLING_ONE PRODUCTION RELEASE CANDIDATE BUILDER         ');
console.log('================================================================');
console.log(`[TARGET] Artifact Name   : ${ARTIFACT_NAME}`);
console.log(`[TARGET] Output Path     : ${ARTIFACT_PATH}`);
console.log(`[TARGET] Staging Root    : ${STAGING_DIR}`);
console.log('----------------------------------------------------------------');

// Step 1: Initialize release and staging directories
if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

// Step 2: Copy production items into staging
const ITEMS_TO_INCLUDE = [
  'app',
  'db',
  'nginx',
  'scripts',
  'docs',
  '.env.example',
  '.env.production.example',
  '.gitignore',
  'docker-compose.yml',
  'docker-compose.production.yml'
];

for (const item of ITEMS_TO_INCLUDE) {
  const srcPath = path.resolve(REPO_ROOT, item);
  const destPath = path.resolve(STAGING_DIR, item);
  if (fs.existsSync(srcPath)) {
    console.log(`[COPY] Staging component: ${item}`);
    copyRecursive(srcPath, destPath);
  }
}

// Remove certs directory if copied inside nginx
const stagedCerts = path.resolve(STAGING_DIR, 'nginx/certs');
if (fs.existsSync(stagedCerts)) {
  fs.rmSync(stagedCerts, { recursive: true, force: true });
}
// Keep empty certs placeholder dir
fs.mkdirSync(stagedCerts, { recursive: true });
fs.writeFileSync(path.resolve(stagedCerts, '.gitkeep'), '# Production certificates mount directory (Do not commit private keys)\n');

// Step 3: Run Secret Hygiene Scan on Staging Directory BEFORE zipping
console.log('\n--- VERIFYING STAGING DIRECTORY HYGIENE ---');
try {
  execSync(`node "${path.resolve(REPO_ROOT, 'scripts/secret-hygiene-check.mjs')}" --target "${STAGING_DIR}"`, {
    stdio: 'inherit'
  });
  console.log('[PASS] Staging directory passed 100% secret hygiene scan.');
} catch (err) {
  console.error('[CRITICAL] Staging directory failed secret hygiene scan. Aborting build!');
  process.exit(1);
}

// Step 4: Compress Staging Directory to ZIP
console.log('\n--- COMPRESSING RELEASE CANDIDATE ARTIFACT ---');
if (fs.existsSync(ARTIFACT_PATH)) {
  fs.unlinkSync(ARTIFACT_PATH);
}

try {
  const psCmd = `powershell -Command "Compress-Archive -Path '${STAGING_DIR}\\*' -DestinationPath '${ARTIFACT_PATH}' -Force"`;
  execSync(psCmd, { stdio: 'inherit' });
  const stat = fs.statSync(ARTIFACT_PATH);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`[OK] Created release ZIP: ${ARTIFACT_NAME} (${sizeMb} MB)`);
} catch (err) {
  console.error(`[FAIL] Compression failed: ${err.message}`);
  process.exit(1);
}

// Step 5: Audit Generated ZIP Artifact Entries
console.log('\n--- AUDITING RELEASE ARTIFACT INTERNALS ---');
const inspectPsCmd = `powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${ARTIFACT_PATH}').Entries | Select-Object -ExpandProperty FullName"`;
const entriesOutput = execSync(inspectPsCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const zipEntries = entriesOutput.split(/\r?\n/).map(e => e.trim()).filter(Boolean);

console.log(`[INFO] Inspected ${zipEntries.length} entries inside archive.`);

const VIOLATIONS = [];
for (const entry of zipEntries) {
  const norm = entry.replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  if (lower === '.env' || lower.endsWith('/.env')) {
    VIOLATIONS.push(`Prohibited file: ${entry}`);
  }
  if (lower.endsWith('.key') || lower.endsWith('.pem') || lower.endsWith('.pfx') || lower.endsWith('.p12')) {
    VIOLATIONS.push(`Prohibited key: ${entry}`);
  }
  if (lower.includes('node_modules')) {
    VIOLATIONS.push(`Prohibited dependency: ${entry}`);
  }
  if (
    lower.includes('db/backups') ||
    lower.includes('/backups/') ||
    lower.startsWith('db/backups/') ||
    lower.endsWith('.dump') ||
    lower.endsWith('.backup') ||
    lower.endsWith('.bak') ||
    (lower.includes('backup') && lower.endsWith('.sql')) ||
    (lower.includes('dump') && lower.endsWith('.sql'))
  ) {
    VIOLATIONS.push(`[CRITICAL] Database backup/dump found in release artifact: ${entry}`);
  }
  if (lower.endsWith('.log')) {
    VIOLATIONS.push(`Prohibited data/log: ${entry}`);
  }
}

if (VIOLATIONS.length > 0) {
  console.error('[CRITICAL] Found security violations in generated release ZIP:');
  for (const v of VIOLATIONS) console.error(`  - ${v}`);
  fs.unlinkSync(ARTIFACT_PATH);
  process.exit(1);
}

console.log('[PASS] 0 prohibited files found inside release ZIP.');
console.log('       Archive verified: No .env, no private keys, no node_modules, no logs, no dumps.');

console.log('\n================================================================');
console.log('   RELEASE CANDIDATE PACKAGE SUCCESSFULLY BUILT & VERIFIED      ');
console.log(`   Artifact File: ${ARTIFACT_PATH}`);
console.log('================================================================');
