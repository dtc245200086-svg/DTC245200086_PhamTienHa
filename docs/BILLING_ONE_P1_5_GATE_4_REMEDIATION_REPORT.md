# BILLING_ONE — P1.5 GATE 4 REMEDIATION REPORT
# SCHEMA HISTORY + AUDIT FORENSICS + DOCUMENTATION CONSISTENCY

**Document ID:** `BILLING_ONE_P1_5_GATE_4_REMEDIATION_REPORT`  
**Milestone:** P1.5 — Customer Credit Risk Control & Enforcement Engine  
**Gate:** GATE 4 Remediation (Pre-Gate 5 Hardening)  
**Author:** Principal Financial Systems Architect + PostgreSQL Database Administrator + Security & RBAC Architect + QA Lead  
**Execution Timestamp:** 2026-10-07T22:05:00+07:00  
**Baseline Git Commit:** `8fbb8c861cbe46c28f902155e19188978604d76d`  
**Status:** **GATE 4 REMEDIATION — PASS**

---

## 1. EXECUTIVE SUMMARY & REMEDIATION CONTEXT

Following the functional completion of **Gate 4 (Customer Profile Status Mutation Hardening)**, a pre-Gate 5 forensic inspection identified three findings requiring formal remediation before proceeding to Gate 5:

1. **Finding A — Database Schema Drift / Migration 08 Synchronization:** Forensic investigation of the live database mutation `ALTER TABLE public.users ALTER COLUMN role TYPE character varying(32);` executed during Gate 4 test setup.
2. **Finding B — Audit Forensic Transition Metadata:** Enrichment of `CUSTOMER_UPDATED` audit events with explicit `customer_id`, `status_prior`, `status_after`, and `transition_source: 'PROFILE_UPDATE'` to satisfy P1.5 Invariant 6 auditability.
3. **Finding C — Corrected Concurrency & Domain Terminology:** Elimination of misleading terms (such as "concurrent unfreezes" and "manual unlock") for functionality not yet implemented in Gate 4.

This report documents the resolution of each finding, verifies complete migration reproducibility, provides comprehensive test evidence (16/16 tests passing), re-validates the cryptographic audit chain (7,284 / 7,284 valid records), and confirms execution readiness for Gate 5 without introducing any unapproved production changes.

---

## 2. FINDING A — DATABASE SCHEMA DRIFT & MIGRATION 08 SYNCHRONIZATION

### 2.1. Forensic Investigation of Schema Mutation
During Gate 4 test execution, creating a test user with role `'ROLE_BILLING_MANAGER'` triggered PostgreSQL error:
```text
ERROR: value too long for type character varying(16)
```
To unblock test execution, a direct DDL command was executed against PostgreSQL container `billing-postgres-1`:
```sql
ALTER TABLE public.users ALTER COLUMN role TYPE character varying(32);
```

### 2.2. Current Database Schema State
Queried directly from live PostgreSQL (`billing-postgres-1`):
- **`public.users.role` Column Type:** `character varying(32)` (NOT NULL)
- **`users_role_check` Constraint:**
  ```sql
  CHECK (role::text = ANY (ARRAY[
    'admin'::text, 
    'staff'::text, 
    'ROLE_BILLING_MANAGER'::text, 
    'ROLE_ACCOUNTANT'::text, 
    'ROLE_AUDITOR'::text
  ]))
  ```

### 2.3. Root Cause & Frozen Specification Alignment
1. **Length Math:** `'ROLE_BILLING_MANAGER'` contains 20 ASCII characters, exceeding the legacy `VARCHAR(16)` width established in Migration 01.
2. **Frozen Spec Alignment:** [`docs/BILLING_ONE_P1_5_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_5_OFFICIAL_SPEC.md) Sections 2.1 & 3 mandates `ROLE_BILLING_MANAGER` as the designated managerial authority alongside `admin` for credit override (`invoice.issue_override`) and manual unlock (`customer.unlock`).
3. **Necessity:** Widening the column to `VARCHAR(32)` is an absolute technical requirement mandated by the Frozen Specification.

### 2.4. Migration Reconciliation & Clean Reproducibility
- Rather than leaving the DDL as an undocumented out-of-band change, the statement was formally embedded into [`db/migrations/08_p1_5_credit_risk_control.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/08_p1_5_credit_risk_control.sql#L44):
  ```sql
  ALTER TABLE public.users ALTER COLUMN role TYPE character varying(32);
  ```
- The symmetrical rollback was incorporated into [`db/migrations/08_p1_5_credit_risk_control_down.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/08_p1_5_credit_risk_control_down.sql#L34):
  ```sql
  ALTER TABLE public.users ALTER COLUMN role TYPE character varying(16);
  ```
- **Reproducibility Verification:** Running Migration 08 on a clean database executes all migrations cleanly from scratch without drift or error. No supplemental Migration 09 is necessary because the migration file and the database state are 100% in sync.
- Full details documented in [`docs/BILLING_ONE_P1_5_SCHEMA_DRIFT_REMEDIATION.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_5_SCHEMA_DRIFT_REMEDIATION.md).

### 2.5. Reconciliation of Pre-Gate 5 Schema State Contradiction
A pre-Gate 5 review flagged an apparent contradiction between the Gate 1 report and the preliminary Gate 4 Remediation Report:
- **Gate 1 Report & Live Database & Migration 08:**
  - `customers.credit_limit` $\to$ `numeric(14,2)`
  - `customers.lock_source` $\to$ `VARCHAR(16)`
  - `company_settings.auto_lock_overdue_days` $\to$ `DEFAULT 30`
- **Preliminary Gate 4 Text Error:**
  - `customers.credit_limit` $\to$ `numeric(15,2)` *(erroneous text recap)*
  - `customers.lock_source` $\to$ `VARCHAR(32)` *(erroneously conflated with `users.role VARCHAR(32)`)*
  - `company_settings.auto_lock_overdue_days` $\to$ `DEFAULT 15` *(erroneous text recap)*

**Forensic Investigation Result:**
1. **Live PostgreSQL (`billing-postgres-1`) Inspection:** Queried `information_schema.columns` and confirmed live database columns:
   - `customers.credit_limit`: `numeric(14,2)` (precision 14, scale 2)
   - `customers.lock_source`: `character varying(16)`
   - `company_settings.auto_lock_overdue_days`: `integer`, DEFAULT 30, live value 30
2. **Frozen Specification Validation:** [`docs/BILLING_ONE_P1_5_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_5_OFFICIAL_SPEC.md) Section 12.1 specifies `AUTO_LOCK_OVERDUE_DAYS = 30 (Frozen Business Constant)` and Section 19.1 specifies `lock_source VARCHAR(16)`.
3. **No Database Mutation Occurred:** No direct DDL command ever altered `credit_limit`, `lock_source`, or `auto_lock_overdue_days`. The discrepancy was strictly a clerical error in the preliminary Gate 4 report documentation.
4. **Clean Disposable Database Verification:** Initialized `disposable_test_db`, ran init scripts `01`, `04`, `05`, and migrations `01` through `08`. The resulting schema was 100% identical to the live target database (`numeric(14,2)`, `VARCHAR(16)`, `DEFAULT 30`, `users.role VARCHAR(32)`).

---

## 3. FINDING B — CUSTOMER_UPDATED FORENSIC TRANSITION METADATA

### 3.1. Forensic Requirement (P1.5 Invariant 6)
P1.5 Invariant 6 requires that any transition of a customer's status be cryptographically provable and distinguish between:
- Manual Unlock / Risk Scanner transitions (deferred to Gates 6 and 7)
- Normal customer profile updates (`transition_source: 'PROFILE_UPDATE'`)

### 3.2. Implementation in `app/src/routes/customers.js`
In `PUT /api/customers/:id`, the transactional audit logging was updated from a plain customer snapshot to include explicit forensic transition metadata:

```javascript
await recordAudit(client, {
  userId: req.user.id,
  userRole: req.user.role,
  module: 'customers',
  action: 'CUSTOMER_UPDATED',
  metadata: {
    customer_id: updatedCustomer.id,
    status_prior: existing.status,
    status_after: updatedCustomer.status,
    transition_source: 'PROFILE_UPDATE',
    ...updatedCustomer,
  },
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
  throwOnError: true,
});
```

### 3.3. Forensic Guarantees
1. **Status Preservation:** When updating profile attributes of a `LOCKED` customer, the audit record immutably captures:
   ```json
   {
     "customer_id": 101,
     "status_prior": "LOCKED",
     "status_after": "LOCKED",
     "transition_source": "PROFILE_UPDATE"
   }
   ```
2. **Rejection Atomicity:** When an illegal transition is attempted (e.g. `PUT { status: 'ACTIVE' }` on a `LOCKED` customer), the route throws HTTP 409 `CUSTOMER_IS_LOCKED` prior to any update or audit invocation. The transaction rolls back, and **zero** `CUSTOMER_UPDATED` events are emitted.
3. **No Manual Unlock:** Manual Unlock (`POST /api/customers/:id/unlock`) is NOT implemented in Gate 4.

---

## 4. FINDING C — TEST & DOCUMENTATION TERMINOLOGY

All misleading terms referring to unimplemented behavior have been systematically replaced:

| Deprecated / Inaccurate Term | Approved Correct Term | Rationale |
|---|---|---|
| "concurrent unfreezes" | **concurrent PUT attempts against LOCKED customer** | Manual unlock is not implemented in Gate 4; test evaluates concurrent PUT requests. |
| "unfreeze" | **illegal status transition attempt away from LOCKED** | PUT endpoint must never perform unfreeze actions. |
| "manual unlock" in Gate 4 | **customer profile status mutation hardening** | Manual unlock is deferred to Gate 6. |

Updated files:
- [`scripts/p1_5-gate4-customer-hardening-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_5-gate4-customer-hardening-test.mjs)
- [`docs/BILLING_ONE_P1_5_GATE_4_CUSTOMER_HARDENING_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_5_GATE_4_CUSTOMER_HARDENING_REPORT.md)

---

## 5. TARGETED TEST EVIDENCE (16/16 TESTS PASS)

Targeted test suite [`scripts/p1_5-gate4-customer-hardening-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_5-gate4-customer-hardening-test.mjs) was updated with tests **T13, T14, T15, T16**:

```text
============================================================
P1.5 GATE 4 TARGETED TESTS: 16/16 PASSED
============================================================
- T01: Status Preservation (omitted status remains ACTIVE): PASS
- T02: Status Preservation (omitted status remains WARNING): PASS
- T03: Status Preservation (omitted status remains LOCKED): PASS
- T04: LOCKED Protection (target status ACTIVE rejected with 409): PASS
- T05: LOCKED Protection (target status WARNING rejected with 409): PASS
- T06: Profile Edit on LOCKED Account (phone/address updated, status LOCKED): PASS
- T07: RBAC Enforcement (ROLE_ACCOUNTANT lacks customer.update -> 403): PASS
- T08: RBAC Enforcement (staff, ROLE_BILLING_MANAGER, admin -> 200): PASS
- T09: Customer Not Found (id 999999999 -> 404): PASS
- T10: Lock Metadata Preservation (lock_source/at/reason intact): PASS
- T11: Audit Trail Atomicity (1 audit on success, 0 on rejection): PASS
- T12: Concurrency & Lock Safety (PUT + invoice issue; concurrent PUT attempts against LOCKED customer; 0 deadlocks): PASS
- T13: Audit Transition Metadata (customer_id, status_prior, status_after, transition_source): PASS
- T14: LOCKED Profile Update Metadata (status_prior=LOCKED, status_after=LOCKED, transition_source=PROFILE_UPDATE): PASS
- T15: Illegal LOCKED -> ACTIVE Audit Guard (HTTP 409, 0 CUSTOMER_UPDATED audit logs): PASS
- T16: Illegal LOCKED -> WARNING Audit Guard (HTTP 409, 0 CUSTOMER_UPDATED audit logs): PASS
```

---

## 6. FULL REGRESSION VERIFICATION MATRIX

| Suite / Check | Command / Script | Result | Violations / Regressions |
|---|---|:---:|:---:|
| **Gate 2 Domain Service** | `node scripts/p1_5-domain-service-test.mjs` | **18/18 PASS** | 0 |
| **Gate 3 Invoice Issue** | `node scripts/p1_5-gate3-rbac-issue-test.mjs` | **13/13 PASS** | 0 |
| **Gate 4 Hardened PUT** | `node scripts/p1_5-gate4-customer-hardening-test.mjs` | **16/16 PASS** | 0 |
| **P1.4 Overdue Lifecycle** | `node scripts/p1_4-overdue-lifecycle-test.mjs` | **21/21 PASS** | 0 (12/12 suites pass, 9/9 invariants = 0) |
| **Cryptographic Audit Chain** | `node scripts/verify-audit-chain.mjs` | **7,284 / 7,284 PASS** | 0 broken hashes (100% valid) |

---

## 7. CURRENT CANONICAL DATABASE SCHEMA STATE

Authoritative PostgreSQL schema state under Milestone P1.5 governance, verified against live `billing-postgres-1` and clean `disposable_test_db`:

```sql
-- public.users
role character varying(32) NOT NULL
CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['admin', 'staff', 'ROLE_BILLING_MANAGER', 'ROLE_ACCOUNTANT', 'ROLE_AUDITOR']))

-- public.customers
credit_limit numeric(14,2) DEFAULT 0 NOT NULL
CONSTRAINT customers_credit_limit_check CHECK (credit_limit >= 0)
lock_source character varying(16) DEFAULT NULL
CONSTRAINT customers_lock_source_check CHECK (lock_source IS NULL OR lock_source IN ('MANUAL', 'AUTO_RISK'))
locked_at timestamp with time zone DEFAULT NULL
lock_reason text DEFAULT NULL

-- public.company_settings
credit_control_enabled boolean DEFAULT true NOT NULL
auto_lock_overdue_days integer DEFAULT 30 NOT NULL
CONSTRAINT company_settings_overdue_days_check CHECK (auto_lock_overdue_days >= 1)

-- public.role_permissions
Contains P1.5 granular permissions:
- customer.read, customer.update, customer.unlock
- invoice.issue, invoice.issue_override
- company_settings.update, risk.scan
```

---

## 8. MIGRATION REPRODUCIBILITY & DISPOSABLE DB VERIFICATION

1. **Migration Sequence:** Migrations 01 through 08 apply in strictly sequential order.
2. **Fresh DB Reproducibility Verified:** An isolated disposable database (`disposable_test_db`) was provisioned inside PostgreSQL, seeded with baseline init scripts (`01-schema.sql`, `04-evolution.sql`, `05-remediation.sql`), and migrated through `01_p0_financial_integrity.sql` to `08_p1_5_credit_risk_control.sql`.
   - The resulting schema confirmed **Verified P1.5 schema parity** with the target database schema:
     - `customers.credit_limit`: `numeric(14,2)`
     - `customers.lock_source`: `character varying(16)`
     - `company_settings.auto_lock_overdue_days`: `integer DEFAULT 30`
     - `users.role`: `character varying(32)`
3. **No Migration 09 Required:** Because Migration 08 is fully in sync with the database schema and matches the Frozen Spec, creating a redundant Migration 09 is unnecessary.
4. **Reversible DDL:** Symmetrical rollback script `08_p1_5_credit_risk_control_down.sql` reverts cleanly.

---

## 9. KNOWN CARRY-FORWARD EXCEPTIONS

1. **CP2 40P01 Concurrency Defect:**
   - Pre-existing concurrency defect in `paymentService.js` under extreme concurrent payment processing.
   - Identified in Milestone P1.2 baseline and documented in `docs/BILLING_ONE_P1_5_BASELINE_CONCURRENCY_FINDING.md`.
   - Strictly untouched in Gate 4 remediation to maintain architectural boundary.
2. **`remediation-verification.mjs`:**
   - Obsolete Pre-P0 legacy artifact asserting deprecated credit-note cash payment behavior; permanently excluded from active regression contract.

---

## 10. REMEDIATION ACCEPTANCE VERIFICATION

| Requirement | Description | Status | Evidence |
|---|---|:---:|---|
| 1. DB Schema Documented | Current schema fully recorded and verified | **PASS** | Section 2 & 7 of this report |
| 2. Migration Reproducibility | Clean reproducibility confirmed | **PASS** | Section 8; `08_p1_5_credit_risk_control.sql` |
| 3. No Undocumented Drift | Zero residual undocumented drift | **PASS** | `BILLING_ONE_P1_5_SCHEMA_DRIFT_REMEDIATION.md` |
| 4. Forensic Transition Metadata | `CUSTOMER_UPDATED` contains transition fields | **PASS** | Section 3; `app/src/routes/customers.js` |
| 5. Gate 4 Tests Prove Metadata | Tests T13–T16 verify transition metadata | **PASS** | Section 5; 16/16 tests pass |
| 6. Audit Chain Integrity | 100% cryptographic validity maintained | **PASS** | 7,284 / 7,284 records valid |
| 7. Gate 2 Baseline | Domain service tests remain green | **PASS** | 18/18 tests pass |
| 8. Gate 3 Baseline | Invoice issue tests remain green | **PASS** | 13/13 tests pass |
| 9. Gate 4 Hardening | Hardened PUT tests remain green | **PASS** | 16/16 tests pass |
| 10. Scope Discipline | Zero Manual Unlock code introduced | **PASS** | Manual unlock deferred to Gate 6 |

---

## 11. FINAL GATE 4 REMEDIATION VERDICT

```text
============================================================
GATE 4 REMEDIATION — PASS

Schema Drift:
RESOLVED

Migration Reproducibility:
PASS

Audit Transition Metadata:
PASS

Test Evidence:
PASS

Documentation:
PASS

Gate 2:
PASS

Gate 3:
PASS

Gate 4:
PASS

Next:
GATE 5 — MANAGER OVERRIDE

DO NOT execute Gate 5 automatically.
============================================================
```
