#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE SECRET HYGIENE SCANNER
 * File: scripts/secret-hygiene-check.mjs
 * ============================================================================
 * Scans repository files and release candidate staging directories for
 * accidental credentials, private keys, connection strings, and tokens.
 *
 * CRITICAL RULE: Never prints or leaks actual secret values to terminal/logs.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Parse CLI options
const args = process.argv.slice(2);
let targetDir = REPO_ROOT;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target' && args[i + 1]) {
    targetDir = path.resolve(args[i + 1]);
    i++;
  }
}

// Ignore directories and files
const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.gemini',
  'pgadmin_data',
  'pgdata',
  'nginx/certs'
]);

// Ignored specific files (e.g. .env is explicitly excluded from scan to not leak local secrets)
const IGNORE_FILES = new Set([
  '.env',
  '.env.local',
  'package-lock.json',
  'secret-hygiene-check.mjs'
]);

// File extensions to scan
const SCANNABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts',
  '.json',
  '.sql',
  '.sh', '.bash', '.ps1',
  '.yml', '.yaml',
  '.conf', '.inc',
  '.md', '.txt',
  '.example'
]);

const FINDINGS = [];

function isPlaceholder(value, fullLine = '') {
  if (!value) return true;
  const trimmed = value.trim().replace(/^['"`]|['"`]$/g, '').trim();
  if (!trimmed) return true;

  // 1. Documentation or regex patterns matching secret keywords
  if (fullLine.includes('pattern') || fullLine.includes('mẫu') || fullLine.includes('regex') || fullLine.includes('grep')) return true;
  if (/^`?[A-Z0-9_]+=[^`]*`?$/.test(trimmed) && (fullLine.includes('tìm') || fullLine.includes('scan') || fullLine.includes('pattern'))) return true;

  // 2. Shell variable expansions: ${VAR}, ${VAR:?...}, ${VAR:-...}, "${VAR}"
  if (/^\$?[{\(]?[A-Z0-9_]+(?::[-?].*)?[}\)]?$/i.test(trimmed)) return true;
  if (trimmed.startsWith('${') || trimmed.startsWith('"$') || trimmed.startsWith('$(')) return true;
  if (trimmed.includes('${') && trimmed.includes('}')) return true;

  // 3. Template literals or language variables: "${VAR}", ${POSTGRES_PASSWORD}
  if (/^\$\{.*\}$/.test(trimmed)) return true;
  if (/^process\.env\./i.test(trimmed)) return true;
  if (/^\$env:/i.test(trimmed)) return true;

  // 4. Standard placeholder markers
  if (trimmed.startsWith('CHANGE_ME')) return true;
  if (trimmed.includes('CHANGE_ME')) return true;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return true;
  if (trimmed.startsWith('REPLACE_') || trimmed.startsWith('YOUR_')) return true;
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null' || trimmed === 'undefined') return true;

  // 5. Example emails / safe demo domains
  if (trimmed.endsWith('@example.com')) return true;

  return false;
}

function scanFile(filePath) {
  const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const baseName = path.basename(filePath);

  if (IGNORE_FILES.has(baseName)) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return; // Binary or unreadable
  }

  const lines = content.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const line = lines[lineIdx];

    // 1. Private Key Block
    if (/BEGIN (?:[A-Z0-9_\- ]+)?PRIVATE KEY/i.test(line)) {
      FINDINGS.push({
        file: relPath,
        line: lineNum,
        patternClass: 'PRIVATE_KEY_BLOCK',
        status: 'CRITICAL_EXPOSURE'
      });
      continue;
    }

    // 2. Sensitive Variable Assignments (PASSWORD=, SECRET=, TOKEN=, API_KEY=)
    // Matches patterns like VAR_PASSWORD="literal" or VAR_PASSWORD: 'literal'
    const varAssignMatch = line.match(/(?:^|\b)(POSTGRES_PASSWORD|BILLING_APP_PASSWORD|BILLING_READONLY_PASSWORD|EXPORTER_PASSWORD|ADMIN_PASSWORD|STAFF_PASSWORD|PGADMIN_DEFAULT_PASSWORD|GRAFANA_ADMIN_PASSWORD|SESSION_SECRET|API_KEY|AUTH_TOKEN|JWT_SECRET)\s*[:=]\s*([^,\s;]+)/i);
    if (varAssignMatch) {
      const varName = varAssignMatch[1];
      const rawVal = varAssignMatch[2];
      if (!isPlaceholder(rawVal, line)) {
        // Exclude test script environment checks and parameter definitions
        if (!/process\.env\.|process\.argv|\$env:|\$db_|\$User|\$Password|\$Sql|\$\{/i.test(line)) {
          FINDINGS.push({
            file: relPath,
            line: lineNum,
            patternClass: `EXPOSED_CREDENTIAL_ASSIGNMENT (${varName})`,
            status: 'ACTION_REQUIRED'
          });
        }
      }
    }

    // 3. Database Connection URI with plain password: postgres://user:literal_pass@host
    const dbUriMatch = line.match(/postgres(?:ql)?:\/\/([a-zA-Z0-9_]+):([^@]+)@/i);
    if (dbUriMatch) {
      const rawPass = dbUriMatch[2];
      if (!isPlaceholder(rawPass, line)) {
        FINDINGS.push({
          file: relPath,
          line: lineNum,
          patternClass: 'DB_CONNECTION_STRING_WITH_PASSWORD',
          status: 'ACTION_REQUIRED'
        });
      }
    }

    // 4. Literal JWT Token (header.payload.signature)
    if (/\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/.test(line)) {
      FINDINGS.push({
        file: relPath,
        line: lineNum,
        patternClass: 'LITERAL_JWT_TOKEN',
        status: 'ACTION_REQUIRED'
      });
    }
  }
}

const isStagingScan = targetDir !== REPO_ROOT;
if (!isStagingScan) {
  IGNORE_DIRS.add('backups');
}

function walkDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (isStagingScan) {
        if (entry.name === 'node_modules') {
          FINDINGS.push({
            file: rel,
            line: 1,
            patternClass: 'PROHIBITED_DEPENDENCY_DIR (node_modules)',
            status: 'CRITICAL_EXPOSURE'
          });
          continue;
        }
        if (entry.name === 'backups' || rel.includes('db/backups')) {
          FINDINGS.push({
            file: rel,
            line: 1,
            patternClass: 'DATABASE_BACKUP_DIRECTORY (db/backups)',
            status: 'CRITICAL_EXPOSURE'
          });
          continue;
        }
      }
      if (IGNORE_DIRS.has(entry.name) || IGNORE_DIRS.has(rel)) continue;
      // Do not scan release folder when scanning root (release has separate check)
      if (entry.name === 'release' && dir === REPO_ROOT) continue;
      walkDir(fullPath);
    } else if (entry.isFile()) {
      if (isStagingScan) {
        const lower = entry.name.toLowerCase();
        if (lower === '.env' || (lower.startsWith('.env.') && lower !== '.env.example' && lower !== '.env.production.example')) {
          FINDINGS.push({
            file: rel,
            line: 1,
            patternClass: 'PROHIBITED_ENV_FILE',
            status: 'CRITICAL_EXPOSURE'
          });
        }
        if (lower.endsWith('.key') || lower.endsWith('.pem') || lower.endsWith('.pfx') || lower.endsWith('.p12')) {
          FINDINGS.push({
            file: rel,
            line: 1,
            patternClass: 'PROHIBITED_KEY_MATERIAL',
            status: 'CRITICAL_EXPOSURE'
          });
        }
        if (
          lower.endsWith('.dump') ||
          lower.endsWith('.backup') ||
          lower.endsWith('.bak') ||
          (lower.includes('backup') && lower.endsWith('.sql')) ||
          (lower.includes('dump') && lower.endsWith('.sql'))
        ) {
          FINDINGS.push({
            file: rel,
            line: 1,
            patternClass: 'DATABASE_BACKUP_OR_DUMP_FILE',
            status: 'CRITICAL_EXPOSURE'
          });
        }
        if (lower.endsWith('.log')) {
          FINDINGS.push({
            file: rel,
            line: 1,
            patternClass: 'PROHIBITED_LOG_FILE',
            status: 'CRITICAL_EXPOSURE'
          });
        }
      }
      const ext = path.extname(entry.name);
      if (SCANNABLE_EXTENSIONS.has(ext) || entry.name.startsWith('.env.')) {
        scanFile(fullPath);
      }
    }
  }
}

console.log('================================================================');
console.log('       BILLING_ONE PRODUCTION SECRET HYGIENE SCANNER            ');
console.log('================================================================');
console.log(`[SCAN] Target Directory : ${targetDir}`);
console.log(`[RULE] Non-leak policy  : Secret values are strictly suppressed`);

walkDir(targetDir);

console.log('----------------------------------------------------------------');
if (FINDINGS.length === 0) {
  console.log('[PASS] 0 secret exposures detected in tracked & scannable files.');
  console.log('       All scanned credentials match sanitized placeholders.');
  console.log('================================================================');
  process.exit(0);
} else {
  console.log(`[ALERT] Found ${FINDINGS.length} potential credential exposures:`);
  console.log('');
  console.log(
    'FILE'.padEnd(50) +
    'LINE'.padEnd(8) +
    'PATTERN CLASS'.padEnd(45) +
    'REMEDIATION STATUS'
  );
  console.log('-'.repeat(120));
  for (const f of FINDINGS) {
    console.log(
      f.file.padEnd(50) +
      String(f.line).padEnd(8) +
      f.patternClass.padEnd(45) +
      f.status
    );
  }
  console.log('================================================================');
  process.exit(1);
}
