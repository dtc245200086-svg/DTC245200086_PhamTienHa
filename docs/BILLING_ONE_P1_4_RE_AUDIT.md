# BILLING_ONE — P1.4 INDEPENDENT RE-AUDIT REPORT
## FINAL VERIFICATION OF FIND-P1.4-01 REMEDIATION & P1.4 CLOSURE ELIGIBILITY
### AUTOMATED OVERDUE INVOICE LIFECYCLE ENGINE

**Document ID:** `docs/BILLING_ONE_P1_4_RE_AUDIT.md`  
**Audit Date:** 2026-10-07  
**Auditor:** Principal Financial Systems Auditor + QA Auditor + Concurrency Reviewer  
**Audit Mode:** Strict Read-Only / Zero Code Modification / Independent Evidence Verification  
**Primary Focus:** Verification of `FIND-P1.4-01` Remediation & Full Milestone Closure Eligibility  

---

## 1. AUDIT SCOPE

The Independent Financial Systems Audit Authority was engaged to conduct the final post-remediation re-audit of Milestone **P1.4: Automated Overdue Invoice Lifecycle Engine** for the Billing_One system.

### Scope of Re-Audit:
1. **Verification of FIND-P1.4-01 Remediation:** Inspection of code and live execution of test scenario **T21** in [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs).
2. **Verification of T01–T20 Integrity:** Confirmation that earlier test scenarios remain unaltered in numbering, scope, and assertion rigor.
3. **Independent 12-Suite Regression Execution:** Standalone execution of all 12 regression test suites from a decoupled harness.
4. **Financial Forensics (9 Authoritative Metrics):** Direct query verification on live PostgreSQL database `billing`.
5. **Cryptographic Audit Chain Integrity:** Complete SHA-256 chain validation and duplicate overdue event checks.
6. **FSM & Concurrency Safety:** Examination of state transitions, advisory locking (`88812346`), row locking, and reporting queries.
7. **Scope & Codebase Hygiene:** Re-confirmation that no out-of-scope features (Dunning, auto-lock, external notification, debt write-offs) exist in the codebase.

---

## 2. SOURCE OF TRUTH

The audit was executed against the following frozen sources of truth:
1. [`docs/BILLING_ONE_P1_4_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_OFFICIAL_SPEC.md) (Version 1.0.2 — FINAL FROZEN)
2. [`docs/BILLING_ONE_P1_4_CLOSURE_AUDIT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_CLOSURE_AUDIT.md)
3. [`docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md)
4. [`docs/BILLING_ONE_P1_4_T21_REMEDIATION_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_T21_REMEDIATION_REPORT.md)
5. [`docs/BILLING_ONE_P1_4_IMPLEMENTATION_PREFLIGHT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_IMPLEMENTATION_PREFLIGHT.md)
6. [`docs/BILLING_ONE_P1_4_IMPLEMENTATION_PLAN.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_IMPLEMENTATION_PLAN.md)
7. [`docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md)
8. [`docs/BILLING_ONE_P1_3_1_RE_AUDIT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_1_RE_AUDIT.md)
9. [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs)
10. Historical test suites in `scripts/`

---

## 3. FIND-P1.4-01 RE-AUDIT VERIFICATION

### 3.1. Original Blocker Definition
In the initial closure audit ([`docs/BILLING_ONE_P1_4_CLOSURE_AUDIT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_CLOSURE_AUDIT.md)), `FIND-P1.4-01` was raised because `scripts/p1_4-overdue-lifecycle-test.mjs` assigned test ID **T21** solely to checking the 9 Financial Forensics metrics, whereas the frozen **Official Specification v1.0.2 Section 23** mandated:
> **T21: Kiểm tra Hồi quy Toàn diện (Regression Check) — Toàn bộ 12 test suites P0–P1.3 tiếp tục PASS 100%**

### 3.2. Evaluation of Remediation
The audit confirms that `scripts/p1_4-overdue-lifecycle-test.mjs` was remediated as follows:
1. **Part A (Full Regression Check):** Programmatically invokes and executes all 12 historical test suites from P0 through P1.3 in real subprocesses using `spawnSync`.
2. **Part B (Financial Forensics Assertion):** Retains and queries the 9 authoritative financial invariant metrics from PostgreSQL.
3. **Contractual Gate:** Scenario T21 only passes if:
   - Exactly 12/12 regression suites return exit code 0 (`assert.equal(suitesPassed, 12)`).
   - All 9 financial forensic metrics equal 0 (`assert.equal(f[i], 0)` for $i \in [0..8]$).

**Finding Status:** **`CLOSED / VERIFIED REMEDIATED`** (Verified by Code Inspection & Live Execution).

---

## 4. T21 CODE VERIFICATION

Direct inspection of [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs) lines 646–778 confirms:

```javascript
// Verification Criteria Check:
1. Exact 12 Suites Defined: Confirmed. Array regressionSuites contains all 12 authoritative scripts.
2. Formatted Enumeration: Confirmed. Console logs [T21] Regression suites: followed by 1..12 list.
3. Subprocess Execution: Confirmed. spawnSync(cmd, args, { env: subEnv, encoding: 'utf8', timeout: 180000 }).
4. Exit Code Assertions: Confirmed. if (res.status !== 0) assert.fail(...).
5. Error / Timeout Handling: Confirmed. if (res.error) throw new Error(...).
6. Output Capture: Confirmed. Captures res.stdout and res.stderr upon failure.
7. Assertion Integrity: Confirmed. Zero "|| true", zero catch blocks that swallow errors, zero hard-coded passes.
8. Integrated Invariants: Confirmed. Part B queries all 9 financial metrics with strict zero assertions.
```

**Result:** **`VERIFIED BY CODE`**.

---

## 5. T21 ACTUAL EXECUTION EVIDENCE

The audit executed [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs) in a live environment. Primary execution log excerpt:

```text
======================================================================
   BILLING_ONE P1.4 OVERDUE INVOICE LIFECYCLE TEST SUITE (T01 - T21)  
   Candidate A: Automated Overdue FSM, Concurrency & Audit Integrity   
======================================================================

[T01] Hóa đơn ISSUED trước ngày due_date -> Giữ nguyên ISSUED...
  -> PASS: T01 verified
[T02] Hóa đơn ISSUED đúng ngày due_date (current = due) -> Giữ nguyên ISSUED...
  -> PASS: T02 verified
[T03] Hóa đơn ISSUED sau ngày due_date -> Tự động chuyển sang OVERDUE...
  -> PASS: T03 verified with audit event
[T04] Hóa đơn PARTIALLY_PAID trước ngày due_date -> Giữ nguyên PARTIALLY_PAID...
  -> PASS: T04 verified
[T05] Hóa đơn PARTIALLY_PAID sau ngày due_date -> Tự động chuyển sang OVERDUE...
  -> PASS: T05 verified
[T06] Hóa đơn DRAFT có due_date trong quá khứ -> Tuyệt đối KHÔNG chuyển sang OVERDUE...
  -> PASS: T06 verified
[T07] Hóa đơn PAID có due_date trong quá khứ -> Tuyệt đối KHÔNG chuyển sang OVERDUE...
  -> PASS: T07 verified
[T08] Hóa đơn CANCELLED có due_date trong quá khứ -> Tuyệt đối KHÔNG chuyển sang OVERDUE...
  -> PASS: T08 verified
[T09] Hóa đơn đã tất toán hết (outstanding = 0) -> Tuyệt đối KHÔNG chuyển sang OVERDUE...
  -> PASS: T09 verified
[T10] Hóa đơn OVERDUE nhận thanh toán đủ 100% -> Chuyển sang PAID...
  -> PASS: T10 verified
[T11] Hóa đơn OVERDUE nhận thanh toán một phần -> GIỮ NGUYÊN OVERDUE...
  -> PASS: T11 verified
[T12] Thực thi runOverdueScan() lặp lại 5 lần liên tiếp -> Idempotent...
  -> PASS: T12 verified (5 consecutive scans idempotent)
[T13] Kiểm tra không sinh trùng lặp sự kiện kiểm toán khi quét lặp...
  -> PASS: T13 verified (Zero duplicate audit entries)
[T14] Thanh toán trực tiếp cho hóa đơn OVERDUE qua API -> Thành công HTTP 201...
  -> PASS: T14 verified
[T15] Cấn trừ tiền thừa (Unapplied Cash) cho hóa đơn OVERDUE -> Thành công...
  -> PASS: T15 verified
[T16] Kiểm tra customer.current_debt sau khi hóa đơn thành OVERDUE...
  -> PASS: T16 verified (No debt drop)
[T17] Kiểm tra Báo cáo Tuổi nợ (/api/reports/aging) bao gồm hóa đơn OVERDUE...
  -> PASS: T17 verified
[T18] Kiểm tra Chỉ số Thu hồi (/api/reports/collection-metrics)...
  -> PASS: T18 verified
[T19] Kiểm tra toàn vẹn chuỗi băm SHA-256 sau khi quét...
  -> PASS: T19 verified (4248 records verified valid)
[T20] Kiểm tra Concurrency Locking (Quét nợ, Phân bổ, Cấn trừ & Đối soát)...
  -> PASS: T20 verified (0 deadlocks, clean concurrency safety)
[T21] Kiểm tra Hồi quy Toàn diện (Regression Check P0 - P1.3) & 9 Bất biến Tài chính...
[T21] Regression suites:
  1. scripts/p0-remediation-test.mjs (P0 Financial Integrity Suite)
  2. scripts/p1-refund-ledger-test.mjs (P1.1 Refund Ledger Suite)
  3. scripts/p1_2-payment-allocation-test.mjs (P1.2 Payment Allocation V2)
  4. scripts/p1_2_1-idempotency-test.mjs (P1.2.1 Direct Payment Idempotency)
  5. scripts/p1_2_2-mandatory-idempotency-test.mjs (P1.2.2 Mandatory Idempotency)
  6. scripts/p1_3-auto-settlement-test.mjs (P1.3 Dedicated Auto-Settlement)
  7. scripts/p1_3_1-remediation-test.mjs (P1.3.1 Remediation Verification)
  8. scripts/cp2-smoke.mjs (CP2 Baseline Smoke Suite)
  9. scripts/extended-features-test.mjs (Extended Enterprise Features)
  10. scripts/frontend-e2e-test.mjs (Frontend Smoke & Asset E2E)
  11. scripts/verify-hardening.ps1 (Security Hardening H1 - H6)
  12. scripts/verify-audit-chain.mjs (Cryptographic Audit Chain)
  [T21.1/12] Executing scripts/p0-remediation-test.mjs (P0 Financial Integrity Suite)...
  -> PASS: [1/12] scripts/p0-remediation-test.mjs (exit code 0)
  [T21.2/12] Executing scripts/p1-refund-ledger-test.mjs (P1.1 Refund Ledger Suite)...
  -> PASS: [2/12] scripts/p1-refund-ledger-test.mjs (exit code 0)
  [T21.3/12] Executing scripts/p1_2-payment-allocation-test.mjs (P1.2 Payment Allocation V2)...
  -> PASS: [3/12] scripts/p1_2-payment-allocation-test.mjs (exit code 0)
  [T21.4/12] Executing scripts/p1_2_1-idempotency-test.mjs (P1.2.1 Direct Payment Idempotency)...
  -> PASS: [4/12] scripts/p1_2_1-idempotency-test.mjs (exit code 0)
  [T21.5/12] Executing scripts/p1_2_2-mandatory-idempotency-test.mjs (P1.2.2 Mandatory Idempotency)...
  -> PASS: [5/12] scripts/p1_2_2-mandatory-idempotency-test.mjs (exit code 0)
  [T21.6/12] Executing scripts/p1_3-auto-settlement-test.mjs (P1.3 Dedicated Auto-Settlement)...
  -> PASS: [6/12] scripts/p1_3-auto-settlement-test.mjs (exit code 0)
  [T21.7/12] Executing scripts/p1_3_1-remediation-test.mjs (P1.3.1 Remediation Verification)...
  -> PASS: [7/12] scripts/p1_3_1-remediation-test.mjs (exit code 0)
  [T21.8/12] Executing scripts/cp2-smoke.mjs (CP2 Baseline Smoke Suite)...
  -> PASS: [8/12] scripts/cp2-smoke.mjs (exit code 0)
  [T21.9/12] Executing scripts/extended-features-test.mjs (Extended Enterprise Features)...
  -> PASS: [9/12] scripts/extended-features-test.mjs (exit code 0)
  [T21.10/12] Executing scripts/frontend-e2e-test.mjs (Frontend Smoke & Asset E2E)...
  -> PASS: [10/12] scripts/frontend-e2e-test.mjs (exit code 0)
  [T21.11/12] Executing scripts/verify-hardening.ps1 (Security Hardening H1 - H6)...
  -> PASS: [11/12] scripts/verify-hardening.ps1 (exit code 0)
  [T21.12/12] Executing scripts/verify-audit-chain.mjs (Cryptographic Audit Chain)...
  -> PASS: [12/12] scripts/verify-audit-chain.mjs (exit code 0)
  [T21.Forensics] Kiểm tra 9 Bất biến Tài chính P1.3 / P1.4...
  -> PASS: T21 verified (12/12 regression suites passed AND all 9 authoritative financial metrics = 0)

======================================================================
   P1.4 TEST EXECUTION SUMMARY: 21/21 TESTS PASSED (100%)       
======================================================================
```

**Result:** **`VERIFIED BY LIVE EXECUTION (21/21 PASS)`**.

---

## 6. INDEPENDENT 12-SUITE REGRESSION VERIFICATION

To prevent reliance on the internal test harness alone, the audit executed an independent verification across all 12 regression test suites from a decoupled execution script:

| STT | Test Suite File | Historical Suite Name | Scope Covered | Exit Code | Result |
| :---: | :--- | :--- | :--- | :---: | :---: |
| 1 | [`scripts/p0-remediation-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p0-remediation-test.mjs) | P0 Financial Integrity Suite | Credit note semantics, bank anti-replay | `0` | **PASS (4/4)** |
| 2 | [`scripts/p1-refund-ledger-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1-refund-ledger-test.mjs) | P1.1 Refund Ledger Suite | Credit notes, refund payables ledger | `0` | **PASS (10/10)** |
| 3 | [`scripts/p1_2-payment-allocation-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2-payment-allocation-test.mjs) | P1.2 Payment Allocation V2 | 1 Pay $\to$ N Invoices, unapplied cash | `0` | **PASS (18/18)** |
| 4 | [`scripts/p1_2_1-idempotency-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2_1-idempotency-test.mjs) | P1.2.1 Direct Payment Idempotency | Anti-replay direct payment | `0` | **PASS (10/10)** |
| 5 | [`scripts/p1_2_2-mandatory-idempotency-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2_2-mandatory-idempotency-test.mjs) | P1.2.2 Mandatory Idempotency | Header validation + least privilege | `0` | **PASS (20/20)** |
| 6 | [`scripts/p1_3-auto-settlement-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_3-auto-settlement-test.mjs) | P1.3 Dedicated Auto-Settlement | Unapplied cash FIFO settlement T01–T16 | `0` | **PASS (16/16)** |
| 7 | [`scripts/p1_3_1-remediation-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_3_1-remediation-test.mjs) | P1.3.1 Remediation Verification | Hierarchical lock order, metadata fields | `0` | **PASS (7/7)** |
| 8 | [`scripts/cp2-smoke.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/cp2-smoke.mjs) | CP2 Baseline Smoke Suite | Core functional CRUD, p95 latency | `0` | **PASS (15/15)** |
| 9 | [`scripts/extended-features-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/extended-features-test.mjs) | Extended Enterprise Features | 12 extended features | `0` | **PASS (12/12)** |
| 10 | [`scripts/frontend-e2e-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/frontend-e2e-test.mjs) | Frontend Smoke Test | Static assets & 23 UI routes smoke | `0` | **PASS (23/23)** |
| 11 | [`scripts/verify-hardening.ps1`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-hardening.ps1) | Security Hardening H1 - H6 | Container isolation, least privilege | `0` | **PASS (26/26)** |
| 12 | [`scripts/verify-audit-chain.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-audit-chain.mjs) | Cryptographic Audit Chain | SHA-256 chain consistency | `0` | **PASS (100%)** |

**Result:** **`VERIFIED BY INDEPENDENT REGRESSION EXECUTION (12/12 PASS)`**.

---

## 7. T01–T20 INTEGRITY & TEST MODIFICATION AUDIT

Detailed inspection of git history and diff for [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs):
1. **T01–T20 Code Diff:** Zero code modifications were made to scenarios T01 through T20 during the T21 remediation.
2. **Prior Adjustments Review:**
   - *Setting `issue_date` to past with `due_date`:* Technically mandated by DB constraint `invoices_due_date_after_issue` (`due_date >= issue_date`). Assertions intact.
   - *Prefix `SCAN_RESULT:` parsing:* Corrected multi-line JSON parsing from logger. Assertions intact.
   - *`actor_name` / `actor_role` columns:* Aligned query to PostgreSQL schema `audit_logs`. Expected values (`SystemScheduler`, `SYSTEM`) preserved.
   - *Admin role for invoice cancel in T08:* Required by RBAC rule `invoice.cancel`. Assertions intact.
   - *Field `allocated_amount` in T14:* Corrected response field access. Expected value (`1000000.00`) preserved.
3. **Assertion Rigor:** No assertions were disabled, deleted, or converted to warnings. No expected values were modified.

**Result:** **`VERIFIED BY CODE DIFF (ZERO ASSERTION WEAKENING)`**.

---

## 8. FINANCIAL FORENSICS (9 AUTHORITATIVE METRICS)

Direct query executed on live PostgreSQL database `billing`:

```sql
SELECT 
  (SELECT count(*) FROM (
    SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
    FROM public.payments p
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
    GROUP BY p.id, p.amount
    HAVING coalesce(sum(pa.allocated_amount), 0) > p.amount + 0.001
  ) s1) AS payment_over_allocation,

  (SELECT count(*) FROM (
    SELECT p.id, (p.amount - coalesce(sum(pa.allocated_amount), 0)) AS unapplied
    FROM public.payments p
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
    GROUP BY p.id, p.amount
    HAVING (p.amount - coalesce(sum(pa.allocated_amount), 0)) < -0.001
  ) s2) AS negative_unapplied,

  (SELECT count(*) FROM (
    SELECT i.id, i.paid_total, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
    FROM public.invoices i
    LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id
    GROUP BY i.id, i.paid_total
    HAVING abs(i.paid_total - coalesce(sum(pa.allocated_amount), 0)) > 0.001
  ) s3) AS invoice_allocation_mismatch,

  (SELECT count(*) FROM public.invoices 
   WHERE paid_total + adjusted_total > total + 0.001) AS collectible_capacity_violation,

  (SELECT count(*) FROM (
    SELECT invoice_id, payment_id, notes, count(*) 
    FROM public.payment_allocations 
    WHERE notes = 'Tự động cấn trừ theo chu kỳ thuê bao định kỳ'
    GROUP BY invoice_id, payment_id, notes HAVING count(*) > 1
  ) dup_sched_allocs) AS duplicate_scheduler_allocation,

  (SELECT count(*) FROM (
    SELECT idempotency_key, count(*) 
    FROM public.payment_idempotency_keys 
    WHERE idempotency_key LIKE 'RECURRING-AUTO-ALLOC-%' 
    GROUP BY idempotency_key HAVING count(*) > 1
  ) dup_keys) AS dup_sched_keys,

  (SELECT count(*) FROM public.payments 
   WHERE reference LIKE '%AUTO-ALLOC%' OR notes LIKE '%cấn trừ%') AS p13_created_payments,

  (SELECT count(*) FROM public.payments WHERE amount <= 0) AS non_positive_payments,

  (SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0) AS non_positive_allocations;
```

### Measured Evidence:
```text
-[ RECORD 1 ]------------------+--
payment_over_allocation        | 0
negative_unapplied             | 0
invoice_allocation_mismatch    | 0
collectible_capacity_violation | 0
duplicate_scheduler_allocation | 0
dup_sched_keys                 | 0
p13_created_payments           | 0
non_positive_payments          | 0
non_positive_allocations       | 0
```

**Result:** **`VERIFIED BY DATABASE QUERY (0 VIOLATIONS ACROSS ALL 9 METRICS)`**.

---

## 9. CRYPTOGRAPHIC AUDIT CHAIN VERIFICATION

Execution of [`scripts/verify-audit-chain.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-audit-chain.mjs):
```json
{
  "verified": true,
  "valid": true,
  "verified_count": 4795,
  "total_records": 4795,
  "message": "Toàn vẹn chuỗi kiểm toán SHA-256: 100% bản ghi (4795) đã được xác thực an toàn tuyệt đối."
}
```

- **Hash Consistency:** 100.0% (4,795 / 4,795 records verified).
- **Broken Links:** 0.
- **Duplicate Overdue Transitions:**
  ```sql
  SELECT metadata->>'invoice_id', count(*)
  FROM public.audit_logs
  WHERE action = 'INVOICE_OVERDUE_FLAGGED'
  GROUP BY metadata->>'invoice_id'
  HAVING count(*) > 1;
  ```
  Result: **0 rows**.
- **Total `INVOICE_OVERDUE_FLAGGED` Events:** 120 unique records.

**Result:** **`VERIFIED BY AUDIT SCRIPT & DATABASE QUERY (100% CRYPTOGRAPHIC VALIDITY)`**.

---

## 10. DATABASE & MIGRATION 07 AUDIT

Verification of PostgreSQL `public.invoices` schema (`\d public.invoices`):
1. `invoices_status_check`: Includes `'OVERDUE'`.
2. `invoices_issued_have_number`: Includes `'OVERDUE'`.
3. `idx_invoices_overdue_scan`: Present and operational (`btree (due_date) WHERE status = ANY(ARRAY['ISSUED', 'PARTIALLY_PAID'])`).
4. `idx_invoices_customer_overdue`: Present and operational (`btree (customer_id) WHERE status = 'OVERDUE'`).

**Result:** **`VERIFIED BY DATABASE SCHEMA INSPECTION`**.

---

## 11. OVERDUE FINITE STATE MACHINE (FSM)

Audit of production services ([`paymentService.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) and [`adjustments.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js)):
1. **Transition Table:**
   - `ISSUED` + past due + outstanding $> 0 \to$ `OVERDUE`.
   - `PARTIALLY_PAID` + past due + outstanding $> 0 \to$ `OVERDUE`.
   - `OVERDUE` + full settlement $\to$ `PAID`.
   - `OVERDUE` + partial settlement $\to$ `OVERDUE`.
2. **Strict Guard:**
   - `OVERDUE` $\to$ `PARTIALLY_PAID` is mathematically impossible in SQL `CASE` logic.
   - `DRAFT`, `PAID`, `CANCELLED` invoices cannot transition to `OVERDUE`.

**Result:** **`VERIFIED BY CODE INSPECTION & TEST EVIDENCE`**.

---

## 12. SCHEDULER & CONCURRENCY ARCHITECTURE

1. **Advisory Lock ID:** `OVERDUE_SCAN_LOCK_ID = 88812346` (isolated from P1.3 `88812345`).
2. **Fine-Grained Row Locking:** Uses `SELECT ... WHERE id = $1 FOR UPDATE` per invoice inside an individual transaction.
3. **Re-check Under Lock:** Explicitly verifies eligibility before status mutation.
4. **Deadlock Safety:** 0 deadlock occurrences (`40P01`) recorded across concurrent testing.
5. **Observation on T20:** Bank reconciliation matching is not included in the T20 `Promise.all` race bundle. As bank reconciliation concurrency is independently tested and verified in P0 (Test 2.2) and P1.2 (Test 12), this remains classified as a non-blocking observation.

**Result:** **`VERIFIED COMPLIANT`**.

---

## 13. REPORTING QUERIES HARMONIZATION

Direct code inspection of SQL queries in `app/src/routes`:
- `customers.js`: `current_debt` and `available_credit` subqueries include `'OVERDUE'`.
- `reports.js` (`/aging`): includes `'OVERDUE'`.
- `reports.js` (`/collection-metrics`): `receivables` and `overdue_total` include `'OVERDUE'`.
- `reports.js` (`/vat`): includes `'OVERDUE'`.
- `reports.js` (`/revenue`): preserves `status <> 'CANCELLED'` without modification.

**Result:** **`VERIFIED BY CODE INSPECTION`**.

---

## 14. SCOPE COMPLIANCE AUDIT

Grep scan of `app/src` for prohibited out-of-scope features:
- Dunning: **0 occurrences**
- Customer Auto-Locking: **0 occurrences**
- SMTP / SMS / Notifications: **0 occurrences**
- Debt Write-Off / Bad Debt: **0 occurrences**
- Late Interest / Penalty Fees: **0 occurrences**
- Payment Gateways: **0 occurrences**

**Result:** **`VERIFIED 100% SCOPE COMPLIANT`**.

---

## 15. FILE ATTRIBUTION ANALYSIS

- [`app/src/routes/payments.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js): Only exports `extractAndRequireIdempotencyKey`. Confirmed as pre-existing P1.3 work.
- [`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js): Only includes `auto_settle_unapplied` logic. Confirmed as pre-existing P1.3 work.
- No rogue or unattributed modifications exist.

**Result:** **`VERIFIED COMPLIANT`**.

---

## 16. GIT STATE & DOCUMENTATION DISCIPLINE

1. **Git Status:**
   - 12 tracked files modified in working tree.
   - Zero commits executed during remediation or audit.
   - Working tree remains clean and uncommitted pending formal sign-off.
2. **Implementation Report Claim:**
   [`docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md) was updated to state:  
   *"The implementation report is currently present in the working tree and is pending formal closure commit."*  
   This matches the actual git working tree state.

**Result:** **`VERIFIED BY GIT STATUS`**.

---

## 17. DOCUMENTATION CONSISTENCY & NUMBERS PROGRESSION

Audit log counts across documents represent chronological snapshots:
- **T19 Execution Time:** 2,875 records.
- **Post Gate 8 Full Regression:** 3,169 records (+294 records generated by regression run).
- **Post Remediation Re-Audit:** 4,189 to 4,795 records (growth from subsequent verification suites).
All snapshots are cryptographically valid (100% hash consistency, 0 broken links).

**Result:** **`VERIFIED CHRONOLOGICALLY ACCURATE`**.

---

## 18. FINDINGS INVENTORY & STATUS

| Finding ID | Title | Severity | Classification | Status |
| :--- | :--- | :---: | :---: | :---: |
| **FIND-P1.4-01** | Test Contract Mismatch on T21 Definition | CRITICAL | BLOCKING | **CLOSED / VERIFIED** |
| **FIND-P1.4-02** | Bank Reconciliation Omitted from T20 Concurrency Race | LOW | NON-BLOCKING | **OPEN (WARNING)** |
| **FIND-P1.4-03** | Premature Claim of Committed Implementation Report | LOW | NON-BLOCKING | **CLOSED / VERIFIED** |
| **FIND-P1.4-04** | Chronological Audit Log Count Progression | INFO | NON-BLOCKING | **CLOSED / VERIFIED** |
| **FIND-P1.4-05** | Frontend Smoke Test Terminology Distinction | INFO | NON-BLOCKING | **NOTED (INFORMATIONAL)** |

---

## 19. ACCEPTANCE CRITERIA (AC-1 THROUGH AC-12)

| Criteria | Title | Evidence | Audit Evaluation |
| :--- | :--- | :--- | :---: |
| **AC-1** | Phân loại OVERDUE Đúng đắn | T03, T05, live scanner, 120 unique overdue records | **PASS** |
| **AC-2** | Bảo vệ FSM Tuyệt đối | T06 (DRAFT), T07 (PAID), T08 (CANCELLED), T09 (Adj=Tot) | **PASS** |
| **AC-3** | Thanh toán Thông suốt | T10, T11, T14, T15, FSM preservation in `paymentService.js` | **PASS** |
| **AC-4** | Báo cáo Chuẩn xác | T17, T18, aging & collection queries in `reports.js` | **PASS** |
| **AC-5** | Công nợ Khách hàng Toàn vẹn | T16 (zero debt drop), `customers.js` subqueries | **PASS** |
| **AC-6** | Kiểm toán Bất biến | `INVOICE_OVERDUE_FLAGGED` SHA-256 chain (4,795 records valid) | **PASS** |
| **AC-7** | Tính Lũy kế (Idempotency) | T12 (5 runs = 0 processed), T13 (0 dup audits), SQL dup = 0 | **PASS** |
| **AC-8** | An toàn Tương tranh | T20 (0 deadlocks), lock ID 88812346, per-row transaction | **PASS** |
| **AC-9** | Bất biến Tài chính (9 Metrics) | T21 Part B, direct DB query (all 9 metrics = 0) | **PASS** |
| **AC-10** | Không Hồi quy (12 Suites) | T21 Part A + Independent Runner (12/12 suites PASS) | **PASS** |
| **AC-11** | Không Tuyên bố Thông báo Ảo | 0 occurrences of SMTP/SMS/Webhooks in codebase | **PASS** |
| **AC-12** | Ranh giới Phạm vi Băng tuyết | 0 Dunning, 0 auto-lock, Candidate A strictly preserved | **PASS** |

**Summary:** **12 / 12 Acceptance Criteria SATISFIED (100%)**.

---

## 20. FINAL AUDIT VERDICT

```text
================================================================================
                    FINAL AUDIT VERDICT:
          P1.4 RE-AUDIT — VERIFIED WITH WARNINGS
================================================================================
```

### Statement of Closure Eligibility:
All critical blocking criteria, including **FIND-P1.4-01**, have been verified completely resolved by code inspection, dedicated live test execution, independent regression verification, database forensics, and cryptographic chain validation. Only non-blocking observations (FIND-P1.4-02 bank reconciliation race bundling and FIND-P1.4-05 test suite naming precision) remain.

**P1.4 is eligible for formal closure, subject to final PO decision and closure commit.**
