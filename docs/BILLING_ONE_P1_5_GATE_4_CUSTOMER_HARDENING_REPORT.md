# BILLING_ONE — P1.5 GATE 4 EXECUTION REPORT
# CUSTOMER PROFILE STATUS MUTATION HARDENING (`PUT /api/customers/:id`)

**Document ID:** `BILLING_ONE_P1_5_GATE_4_CUSTOMER_HARDENING_REPORT`  
**Milestone:** P1.5 — Customer Credit Risk Control & Enforcement Engine  
**Gate:** GATE 4 — Customer Status Mutation Hardening  
**Author:** Principal Financial Systems Architect + PostgreSQL Concurrency Engineer + Security & RBAC Architect + QA Lead  
**Execution Timestamp:** 2026-10-07T21:48:00+07:00  
**Baseline Git Commit:** `8fbb8c861cbe46c28f902155e19188978604d76d`  
**Status:** **GATE 4 — PASS**

---

## 1. OBJECTIVE & SCOPE BOUNDARY

Gate 4 fortifies the customer profile update endpoint (`PUT /api/customers/:id`) against accidental status regressions, illegal unfreezing of `LOCKED` accounts, and unauthorized role tampering.

### Strict Scope Enforcement:
- [x] **IN SCOPE:**
  - Hardening of `PUT /api/customers/:id` within an explicit PostgreSQL transaction (`inTransaction`).
  - Exclusive row locking (`SELECT ... FOR UPDATE`) before any state validation or mutation.
  - Status preservation: Omitted `status` preserves existing database status (`targetStatus = existing.status`), eliminating accidental revert to `ACTIVE`.
  - Protection of `LOCKED` accounts: Rejection of any transition from `LOCKED` to `ACTIVE` or `WARNING` via `PUT` with HTTP 409 `CUSTOMER_IS_LOCKED`.
  - Lock metadata preservation: Updating profile fields (phone, address, tax code, credit limit) preserves `lock_source`, `locked_at`, and `lock_reason`.
  - Backend RBAC enforcement: Route protected by `requirePermission('customer.update')`.
  - Atomic in-transaction audit logging: `CUSTOMER_UPDATED` logged inside transaction with `throwOnError: true`; zero audit logs emitted on rejected mutations.
  - Concurrency & row lock safety verification: Zero PostgreSQL 40P01 deadlocks across concurrent PUT and invoice issuance flows.
  - Targeted test suite [`scripts/p1_5-gate4-customer-hardening-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_5-gate4-customer-hardening-test.mjs) (16/16 PASS).
  - Regression verification across domain service (18/18 PASS), Gate 3 issue flow (13/13 PASS), and P1.4 lifecycle engine (21/21 PASS).
- [x] **STRICTLY EXCLUDED FROM GATE 4:**
  - Manual Unlock endpoint `POST /api/customers/:id/unlock` (Deferred to Gate 6). *Gate 4 only hardens PUT; manual unlock is NOT implemented here.*
  - Manager Override endpoint `POST /api/invoices/:id/issue-override` (Deferred to Gate 5).
  - Automated Customer Risk Scanner in `scheduler.js` (Deferred to Gate 7).
  - Frontend UI modifications (Deferred to later designated UI gate).
  - Remediation of pre-existing CP2 / `paymentService.js` concurrency defects.

---

## 2. ORIGINAL VULNERABILITY VS CORRECTED BEHAVIOR

### 2.1. Root Cause Analysis (Preflight Finding A)
In the baseline implementation of `app/src/routes/customers.js`:
```javascript
// Baseline code:
function customerInput(body) {
  ...
  const status = body.status && VALID_STATUSES.has(body.status) ? body.status : 'ACTIVE';
  ...
}
```
When an operator updated profile attributes (e.g. phone, address, contact person) without providing the `status` field:
1. `customerInput` silently assigned `status = 'ACTIVE'`.
2. The subsequent SQL query `UPDATE public.customers SET ... status = $10 ... WHERE id = $1` executed with `$10 = 'ACTIVE'`.
3. If the customer was previously in `LOCKED` status by risk control policies or overdue scanners, this update inadvertently transitioned the account to `ACTIVE`.
4. The customer could then immediately resume issuing invoices, bypassing manual unlock governance and managerial oversight.
5. In addition, `PUT /api/customers/:id` did not execute inside a database transaction, lacked `SELECT ... FOR UPDATE` row locking, and did not enforce `requirePermission('customer.update')`.

### 2.2. Corrected Fortified Behavior
1. **Explicit Transaction & Lock:** `inTransaction` starts a transaction and executes:
   ```sql
   SELECT id, code, name, email, phone, address, tax_code, contact_person,
          segment, status, credit_limit::text, payment_term_id,
          lock_source, locked_at, lock_reason
   FROM public.customers
   WHERE id = $1
   FOR UPDATE
   ```
2. **Deterministic Status Preservation:**
   - If `body.status` is omitted (undefined, null, or empty string):
     $$\text{targetStatus} = \text{existing.status}$$
   - Status is NEVER defaulted to `'ACTIVE'`.
3. **Impenetrable LOCKED Account Guard:**
   - If $\text{existing.status} == \text{'LOCKED'}$ and $\text{targetStatus} \in \{\text{'ACTIVE'}, \text{'WARNING'}\}$:
     Aborts immediately with HTTP 409 `CUSTOMER_IS_LOCKED`.
   - Transaction executes `ROLLBACK`. Zero customer state is mutated, and zero audit records are emitted.
4. **Lock Metadata Immutability:**
   - `UPDATE public.customers` modifies only requested profile attributes and sets `status = $10`.
   - Columns `lock_source`, `locked_at`, and `lock_reason` are omitted from the update set and remain intact in PostgreSQL.

---

## 3. RBAC & PERMISSION RESOLUTION

`PUT /api/customers/:id` is guarded by:
```javascript
router.put('/:id', requirePermission('customer.update'), asyncRoute(async (req, res) => { ... }));
```

### Authoritative Enforcement Matrix:
| Role | Permission Resolution | Access to `PUT /api/customers/:id` | Test Evidence |
|---|---|:---:|:---:|
| `admin` | Wildcard `['*']` | **ALLOW (200)** | Verified in T08 |
| `ROLE_BILLING_MANAGER` | Has `customer.update` in `role_permissions` | **ALLOW (200)** | Verified in T08 |
| `staff` | Has `customer.update` in `DEFAULT_STAFF_PERMISSIONS` & DB | **ALLOW (200)** | Verified in T08 |
| `ROLE_ACCOUNTANT` | Lacks `customer.update` in `role_permissions` | **DENY (403 FORBIDDEN)** | Verified in T07 |
| `ROLE_AUDITOR` | Lacks `customer.update` in `role_permissions` | **DENY (403 FORBIDDEN)** | Verified by matrix |
| Unauthenticated | No session cookie | **DENY (401 UNAUTHENTICATED)** | Verified by middleware |

---

## 4. TRANSACTION MODEL & LOCK SEMANTICS

### 4.1. Execution Flow
```text
BEGIN TRANSACTION
  │
  ├─► 1. Acquire Customer Row Lock:
  │      SELECT ... FROM public.customers WHERE id = $1 FOR UPDATE
  │      * If not found: ABORT with HTTP 404 CUSTOMER_NOT_FOUND
  │
  ├─► 2. Process & Validate Input:
  │      targetStatus = body.status ? body.status : existing.status
  │      Preserve omitted profile fields from existing row
  │
  ├─► 3. LOCKED Protection Gate:
  │      IF existing.status === 'LOCKED' AND targetStatus in ('ACTIVE', 'WARNING')
  │      ──► ABORT with HTTP 409 CUSTOMER_IS_LOCKED
  │
  ├─► 4. Apply Mutation:
  │      UPDATE public.customers SET name = ..., phone = ..., status = $10 ... WHERE id = $1
  │      * lock_source, locked_at, lock_reason PRESERVED UNCHANGED
  │
  ├─► 5. Record Cryptographic Audit Log (BEFORE COMMIT):
  │      recordAudit(client, {
  │        module: 'customers',
  │        action: 'CUSTOMER_UPDATED',
  │        metadata: updatedCustomer,
  │        throwOnError: true
  │      })
  │
COMMIT TRANSACTION
```

### 4.2. Concurrency Lock DAG Compliance
The system's Directed Acyclic Graph (DAG) for lock acquisition is strictly adhered to:
$$\text{Level 1: Invoices} \quad \longrightarrow \quad \text{Level 2: Customer Row (FOR UPDATE)} \quad \longrightarrow \quad \text{Level 3: Payment Lock}$$
- `PUT /api/customers/:id` only acquires **Level 2 (Customer Row Lock)**.
- It never acquires Invoice row locks.
- Concurrency test (T12 Scenario A) verified that concurrent invoice issuance (acquiring Invoice $\to$ Customer) and customer profile update (acquiring Customer) cleanly serialize with **zero deadlocks (PostgreSQL 40P01 = 0)**.

---

## 5. AUDIT ATOMICITY & FORENSIC SNAPSHOT

- When an update succeeds:
  - Exactly **one** `CUSTOMER_UPDATED` record is written inside the database transaction before commit.
  - **Forensic Transition Metadata:** Every successful `CUSTOMER_UPDATED` audit record explicitly captures:
    - `customer_id`: Unique identifier of the mutated customer.
    - `status_prior`: Pre-mutation status (e.g. `'LOCKED'`).
    - `status_after`: Post-mutation status (e.g. `'LOCKED'`).
    - `transition_source`: Provenance of transition (`'PROFILE_UPDATE'`).
    - Full updated customer profile snapshot.
- When an update is rejected (e.g. illegal status transition attempt on `LOCKED` customer):
  - Transaction rolls back completely.
  - **Zero** audit records are emitted (`countBeforeReject === countAfterReject`), verified in Tests T11, T15, T16.
- Hash chaining across 7,284 total audit records verified with **100% cryptographic validity** (`verify-audit-chain.mjs`).

---

## 6. TARGETED TEST EXECUTION MATRIX

Executed via [`scripts/p1_5-gate4-customer-hardening-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_5-gate4-customer-hardening-test.mjs):

| Test ID | Test Scenario | Input / Conditions | Expected Behavior | Status |
|---|---|---|---|:---:|
| **T01** | Status Preservation (ACTIVE) | Status omitted in PUT body | Customer remains `ACTIVE` in DB & response | **PASS** |
| **T02** | Status Preservation (WARNING) | Status omitted in PUT body | Customer remains `WARNING` in DB (not reverted to ACTIVE) | **PASS** |
| **T03** | Status Preservation (LOCKED) | Status omitted in PUT body | Customer remains `LOCKED` in DB, lock metadata intact | **PASS** |
| **T04** | LOCKED Protection (to ACTIVE) | `status: 'ACTIVE'` on `LOCKED` customer | HTTP 409 `CUSTOMER_IS_LOCKED`, zero mutation | **PASS** |
| **T05** | LOCKED Protection (to WARNING) | `status: 'WARNING'` on `LOCKED` customer | HTTP 409 `CUSTOMER_IS_LOCKED`, zero mutation | **PASS** |
| **T06** | Profile Edit on LOCKED Account | Phone/address update on `LOCKED` customer | HTTP 200, profile updated, status remains `LOCKED` | **PASS** |
| **T07** | RBAC Enforcement (Unauthorized) | `ROLE_ACCOUNTANT` invokes PUT | HTTP 403 `FORBIDDEN` | **PASS** |
| **T08** | RBAC Enforcement (Authorized) | `staff`, `ROLE_BILLING_MANAGER`, `admin` invoke PUT | HTTP 200 for all authorized roles | **PASS** |
| **T09** | Customer Not Found | `id: 999999999` | HTTP 404 `CUSTOMER_NOT_FOUND` | **PASS** |
| **T10** | Lock Metadata Preservation | Update credit limit & profile on `LOCKED` customer | `lock_source`, `locked_at`, `lock_reason` preserved 100% | **PASS** |
| **T11** | Audit Trail Atomicity | Success vs rejected illegal status mutation | 1 audit on success; exactly 0 audit on rejected mutation | **PASS** |
| **T12** | Concurrency & Lock Safety | Concurrent PUT profile update + invoice issue; concurrent PUT attempts against LOCKED customer | Customer row lock serialization, zero 40P01 deadlocks | **PASS** |
| **T13** | Audit Transition Metadata | Successful profile update on ACTIVE customer | Audit metadata contains `customer_id`, `status_prior`, `status_after`, `transition_source = 'PROFILE_UPDATE'` | **PASS** |
| **T14** | LOCKED Profile Update Metadata | Profile update on LOCKED customer | `status_prior = 'LOCKED'`, `status_after = 'LOCKED'`, `transition_source = 'PROFILE_UPDATE'` | **PASS** |
| **T15** | Illegal LOCKED $\to$ ACTIVE Audit Guard | `PUT { status: 'ACTIVE' }` on LOCKED customer | HTTP 409, exactly 0 `CUSTOMER_UPDATED` audit logs emitted | **PASS** |
| **T16** | Illegal LOCKED $\to$ WARNING Audit Guard | `PUT { status: 'WARNING' }` on LOCKED customer | HTTP 409, exactly 0 `CUSTOMER_UPDATED` audit logs emitted | **PASS** |

**Targeted Suite Result:** **16/16 TESTS PASSED (100%)**

---

## 7. REGRESSION & INTEGRATION VERIFICATION

1. **Gate 2 Domain Service Suite (`scripts/p1_5-domain-service-test.mjs`):**
   - Result: **18/18 TESTS PASSED (100%)**.
2. **Gate 3 Issue Flow Suite (`scripts/p1_5-gate3-rbac-issue-test.mjs`):**
   - Result: **13/13 TESTS PASSED (100%)**.
3. **Milestone P1.4 Lifecycle Engine Suite (`scripts/p1_4-overdue-lifecycle-test.mjs`):**
   - Executed all 21 automated lifecycle, concurrency, and idempotent scan tests.
   - Executed all 12 regression test suites (including P0, P1.1, P1.2, P1.3, CP2 smoke, security hardening).
   - **All 9 Authoritative Financial Metrics = 0 violations.**
   - Official regression contract: **PASS (21/21 tests passed)**.
4. **Cryptographic Audit Chain Integrity (`scripts/verify-audit-chain.mjs`):**
   - Verified 100% of SHA-256 hash chains across 7,284 total audit records.
   - Result: **VALID (0 broken hashes)**.

---

## 8. KNOWN CARRY-FORWARD EXCEPTIONS

1. **CP2 40P01 Concurrency Finding:**
   - Pre-existing P1.2 payment concurrency defect documented in `docs/BILLING_ONE_P1_5_BASELINE_CONCURRENCY_FINDING.md`.
   - Carried forward without suppression; zero regression introduced in P1.5 Gate 4.
2. **`remediation-verification.mjs`:**
   - Obsolete Pre-P0 legacy artifact asserting deprecated credit-note cash payment behavior; excluded from active regression contract.

---

## 9. GIT DIFF & FILE AUDIT (NO UNRELATED MODIFICATIONS)

- **BASELINE COMMIT:** `8fbb8c861cbe46c28f902155e19188978604d76d` (P1.4 Final Closure Baseline)
- **APPROVED PRODUCTION MODIFICATIONS:**
  - `app/src/app.js` (Serialize error.details, customer_id, customer_status)
  - `app/src/audit.js` (Support throwOnError: true for transactional audit atomicity)
  - `app/src/errors.js` (Assign details, customer_id, customer_status in AppError)
  - `app/src/routes/customers.js` (Hardened PUT route with transaction, FOR UPDATE lock, status preservation, LOCKED guard)
  - `app/src/routes/invoices.js` (Gate 3 invoice issue integration)
- **GATE 4 ARTIFACTS:**
  - `scripts/p1_5-gate4-customer-hardening-test.mjs`
  - `docs/BILLING_ONE_P1_5_GATE_4_CUSTOMER_HARDENING_REPORT.md`
  - `docs/BILLING_ONE_P1_5_GATE_3_DOCUMENTATION_REMEDIATION_REPORT.md`
- **UNRELATED MODIFICATIONS:** **0**

All modified production files are within approved Gate 3 & Gate 4 scope. No unrelated production files were modified.

---

## 10. GATE 4 ACCEPTANCE CRITERIA VERIFICATION

| Acceptance Criteria | Required State | Actual State | Verdict |
|---|---|---|:---:|
| 1. Status Preservation | Omitted status preserves existing DB status | Verified in T01, T02, T03 | **PASS** |
| 2. LOCKED Guard (ACTIVE) | LOCKED cannot become ACTIVE through PUT | HTTP 409 `CUSTOMER_IS_LOCKED` verified in T04 | **PASS** |
| 3. LOCKED Guard (WARNING) | LOCKED cannot become WARNING through PUT | HTTP 409 `CUSTOMER_IS_LOCKED` verified in T05 | **PASS** |
| 4. Backend Permission | Requires `customer.update` | Verified in T07 (403 for accountant), T08 (200 for staff/admin) | **PASS** |
| 5. Profile Updates | Valid profile fields update correctly | Verified in T01, T06, T08, T10 | **PASS** |
| 6. Lock Metadata Intact | `lock_source`, `locked_at`, `lock_reason` preserved | Verified in T03, T06, T10 | **PASS** |
| 7. No Unlock via PUT | Status transition away from LOCKED blocked on PUT | Illegal LOCKED -> ACTIVE/WARNING transitions strictly rejected (HTTP 409) | **PASS** |
| 8. Audit Behavior | Correct metadata; zero audit on rejection | Verified in T11, T15, T16 | **PASS** |
| 9. Audit Transition Metadata | `customer_id`, `status_prior`, `status_after`, `transition_source` | Verified in T13, T14 | **PASS** |
| 10. Row Lock in Transaction | `SELECT ... FOR UPDATE` inside `inTransaction` | Enforced in code & runtime | **PASS** |
| 11. Concurrency Safety | Safe serialization; zero 40P01 deadlocks | Verified in T12 | **PASS** |
| 12. Zero New Deadlocks | 0 PostgreSQL 40P01 in Gate 4 scenarios | 0 deadlocks observed in T12 | **PASS** |
| 13. Schema Drift Reconciliation | `users.role VARCHAR(32)` documented and reconciled | Documented in `BILLING_ONE_P1_5_SCHEMA_DRIFT_REMEDIATION.md` | **PASS** |
| 14. Gate 2 Tests Pass | Domain service tests remain green | 18/18 PASS | **PASS** |
| 15. Gate 3 Tests Pass | Invoice issue tests remain green | 13/13 PASS | **PASS** |
| 16. Inherited Regression Pass | P0–P1.4 suites pass; 9 invariants = 0 | 21/21 PASS; 0 invariant violations | **PASS** |
| 17. Scope Discipline | Zero unrelated files modified | Verified via git status (0 unrelated files) | **PASS** |

