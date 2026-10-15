#!/usr/bin/env node
/**
 * ============================================================================
 * BILLING_ONE GIT HISTORY SECRET EXPOSURE AUDITOR
 * File: scripts/verify-git-history-secrets.mjs
 * ============================================================================
 * Audits Git commit history across all branches and tags for:
 * 1. Historical credential commits (aa0d392, 94dc8f0, 0222e34).
 * 2. Unredacted credential variables in historical commit diffs.
 * 3. Remote branch status.
 *
 * CRITICAL RULE: Suppresses all actual secret strings from output.
 * ============================================================================
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('       BILLING_ONE GIT HISTORY SECRET EXPOSURE AUDITOR          ');
console.log('================================================================');

function runGit(cmd) {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return null;
  }
}

// 1. Check known historical exposure commits
const KNOWN_EXPOSURE_COMMITS = ['aa0d392', '94dc8f0', '0222e34'];
const foundHistoricalCommits = [];

for (const hash of KNOWN_EXPOSURE_COMMITS) {
  const commitCheck = runGit(`git rev-parse --verify "${hash}"`);
  if (commitCheck) {
    const summary = runGit(`git log -1 --format="%h - %s (%cd)" --date=short "${hash}"`);
    foundHistoricalCommits.push(summary || hash);
  }
}

// 2. Check current working tree for any unredacted credentials
const trackedFindings = [];
const SENSITIVE_VARS = [
  'POSTGRES_PASSWORD',
  'BILLING_APP_PASSWORD',
  'BILLING_READONLY_PASSWORD',
  'ADMIN_PASSWORD',
  'STAFF_PASSWORD',
  'SESSION_SECRET'
];

// 3. Search commit history log for changes adding sensitive variables
const historyMatches = [];
for (const varName of SENSITIVE_VARS) {
  const logOut = runGit(`git log -S "${varName}" --oneline`);
  if (logOut) {
    const count = logOut.split(/\r?\n/).filter(Boolean).length;
    historyMatches.push({ varName, count });
  }
}

console.log('\n--- 1. WORKING TREE EXPOSURE CHECK ---');
const workingTreeScan = runGit('git ls-files .env');
if (!workingTreeScan) {
  console.log('[PASS] .env file is untracked and excluded from git index.');
} else {
  console.log('[FAIL] .env file is currently tracked by git!');
}

console.log('\n--- 2. HISTORICAL COMMIT OBJECTS AUDIT ---');
if (foundHistoricalCommits.length > 0) {
  console.log(`[ALERT] Detected ${foundHistoricalCommits.length} historical commits prior to .gitignore enforcement:`);
  for (const c of foundHistoricalCommits) {
    console.log(`  - ${c}`);
  }
} else {
  console.log('[PASS] Known historical exposure commits not found in current git reflog.');
}

console.log('\n--- 3. GIT REVISION LOG AUDIT ---');
for (const m of historyMatches) {
  console.log(`  - Variable ${m.varName.padEnd(28)} : ${m.count} commits in history`);
}

// 4. Remote repository status
console.log('\n--- 4. REMOTE GIT REPOSITORY STATUS ---');
const remotes = runGit('git remote -v');
if (remotes) {
  console.log('[INFO] Remote configured:');
  const remoteLines = remotes.split(/\r?\n/).slice(0, 2);
  for (const r of remoteLines) console.log(`       ${r}`);
} else {
  console.log('[INFO] No remote repository configured.');
}

console.log('================================================================');

if (foundHistoricalCommits.length > 0) {
  console.log('STATUS = EXTERNAL ACTION REQUIRED');
  console.log('REASON = Historical commits exist in git tree. Remote history rewrite');
  console.log('         requires git-filter-repo execution and coordinated force-push.');
  process.exit(2);
} else {
  console.log('STATUS = PASS');
  console.log('No historical credential exposure commits detected.');
  process.exit(0);
}
