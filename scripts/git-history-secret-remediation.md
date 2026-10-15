# SAFE GIT HISTORY SECRET REMEDIATION RUNBOOK
# File: scripts/git-history-secret-remediation.md

> **Notice:** This runbook provides a dry-run and execution procedure for repository maintainers with full administrative access to rewrite and clean historical commits.
> **DO NOT EXECUTE AUTOMATICALLY WITHOUT SCHEDULED DOWNTIME AND EXPLICIT TEAM COORDINATION.**

---

## Prerequisites
- Python 3.8+ installed.
- `git-filter-repo` tool:
  ```bash
  pip install git-filter-repo
  ```
- Local disk space sufficient for a secondary mirror clone of the repository.

---

## Phase 1: Full Repository Backup (Bare Clone)
Create an immutable safety snapshot before modifying any Git references:
```bash
# Clone a complete mirror containing all branches, tags, and commits
git clone --mirror https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git billing_one_pre_scrub_backup.git

# Verify backup size and commit integrity
cd billing_one_pre_scrub_backup.git
git fsck --full
cd ..
```

---

## Phase 2: Isolated Working Workspace
Perform the history rewrite in an isolated fresh clone, NOT your active working directory:
```bash
git clone https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git billing_one_scrub_workspace
cd billing_one_scrub_workspace
```

---

## Phase 3: Define Replacement Rules (Dry-Run Pattern Matching)
Create an expressions file `replace-secrets.txt`:
```text
regex:(?i)(ADMIN_PASSWORD=)['"]?[a-f0-9]{32,}['"]?==>\1'<FROM_ENV>'
regex:(?i)(STAFF_PASSWORD=)['"]?[a-f0-9]{32,}['"]?==>\1'<FROM_ENV>'
regex:(?i)(POSTGRES_PASSWORD=)['"]?[a-zA-Z0-9_\-]{8,}['"]?==>\1'<FROM_ENV>'
regex:(?i)(BILLING_APP_PASSWORD=)['"]?[a-zA-Z0-9_\-]{8,}['"]?==>\1'<FROM_ENV>'
regex:(?i)(SESSION_SECRET=)['"]?[a-zA-Z0-9_\-]{16,}['"]?==>\1'<FROM_ENV>'
```

---

## Phase 4: Execute Git History Rewrite
Execute `git-filter-repo` across all branches:
```bash
git-filter-repo --replace-text replace-secrets.txt --force
```

---

## Phase 5: Post-Rewrite Inspection & Verification
Verify that the sensitive patterns no longer exist in any branch or commit:
```bash
# 1. Search commit objects for historical keywords (using variable placeholders)
git log -S "<HISTORICAL_ADMIN_HASH>" --all
git log -S "<HISTORICAL_STAFF_HASH>" --all

# 2. Run secret hygiene check script
node scripts/secret-hygiene-check.mjs

# 3. Check git tree consistency
git fsck --full --unreachable
```

---

## Phase 6: Coordinated Remote Force-Push
Once verified by the security officer:
```bash
# Add back the remote origin URL (git-filter-repo removes remotes by default for safety)
git remote add origin https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git

# Force push updated branches and tags
git push origin --force --all
git push origin --force --tags
```

---

## Phase 7: Team Notification & Invalidation
1. **Instruct All Collaborators:**
   Every developer must delete their local clone and re-clone the clean repository to prevent re-introducing scrubbed commits:
   ```bash
   rm -rf local_billing_one
   git clone https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git
   ```
2. **Execute Production Credential Rotation:**
   Follow [`docs/PRODUCTION_CREDENTIAL_ROTATION.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/PRODUCTION_CREDENTIAL_ROTATION.md) immediately. Old credentials must be purged from database roles and application configurations.
