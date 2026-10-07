# BILLING_ONE — P1.4 INDEPENDENT CLOSURE AUDIT REPORT
## AUTOMATED OVERDUE INVOICE LIFECYCLE ENGINE

**Document ID:** `docs/BILLING_ONE_P1_4_CLOSURE_AUDIT.md`  
**Audit Date:** 2026-10-07  
**Auditor:** Independent Principal Financial Systems Auditor + QA Auditor + Concurrency Reviewer  
**Audit Mode:** Read-Only / Zero Code Modification / Independent Evidence Verification  
**Source of Truth:**
1. `docs/BILLING_ONE_P1_4_OFFICIAL_SPEC.md` (v1.0.2 Final Frozen)
2. `docs/BILLING_ONE_P1_4_IMPLEMENTATION_PREFLIGHT.md`
3. `docs/BILLING_ONE_P1_4_IMPLEMENTATION_PLAN.md`
4. `docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md`
5. `docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md`
6. `docs/BILLING_ONE_P1_3_1_RE_AUDIT.md`

---

## 1. AUDIT EXECUTIVE SUMMARY

The Independent Financial Systems Audit has completed a comprehensive forensic evaluation of the Milestone **P1.4: Automated Overdue Invoice Lifecycle Engine** implementation.

### Key Audit Findings:
1. **Core Domain & Database Implementation:** Migration 07 was applied cleanly within a single transaction. `OVERDUE` is properly registered in `invoices_status_check`. Scheduler advisory lock `88812346` and per-invoice row locking operate with zero deadlocks.
2. **Financial Invariants:** All **9 Authoritative Financial Metrics** were independently queried directly from live PostgreSQL and confirmed at **0 violations**.
3. **Cryptographic Chain Integrity:** The SHA-256 audit chain was independently verified across all **3,169 records** with **100% validity** and **0 broken links**.
4. **CRITICAL CONTRACT DISCREPANCY (FIND-P1.4-01):**
   The frozen **Official Specification (v1.0.2)** Section 23 explicitly mandates:
   > **T21: Kiểm tra Hồi quy Toàn diện (Regression Check) — Toàn bộ 12 test suites P0–P1.3 tiếp tục PASS 100%**
   
   However, the implementation script [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs) implemented T21 as:
   > `[T21] Kiểm tra 9 Bất biến Tài chính P1.3 / P1.4...`
   
   While the 12 regression suites were executed externally during Gate 8, the dedicated test script re-assigned test ID T21 to the 9 Financial Forensics query rather than running the regression test suite bundle as specified in the frozen contract.
   
   Per the absolute instructions of the Audit Charter (*"If test numbering differs from frozen spec: CLASSIFY AS BLOCKING. Do not silently reinterpret the specification"*), this discrepancy is classified as **BLOCKING**.

---

## 2. AUDIT VERDICT

```
================================================================================
                    FINAL AUDIT VERDICT:
              P1.4 CLOSURE AUDIT — BLOCKED
================================================================================
```

**Blocking Reason:** FIND-P1.4-01 (Frozen Test Contract Mismatch on T21).  
All other financial, cryptographic, database, and functional subsystems are structurally sound and verified PASS.

---

## 3. AUDIT FINDINGS INVENTORY

### FIND-P1.4-01: Test Contract Mismatch on T21 Definition
- **Severity:** CRITICAL / BLOCKING
- **Finding:** In [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs), test scenario T21 was implemented as the 9 Financial Invariants verification query instead of executing the Full Regression Suite as mandated by the frozen Official Specification v1.0.2.
- **Evidence:**
  - **Official Spec v1.0.2 Section 23 Table:**
    ```text
    | T21 | Kiểm tra Hồi quy Toàn diện (Regression Check) | Toàn bộ 12 test suites P0–P1.3 tiếp tục PASS 100% |
    ```
  - **`scripts/p1_4-overdue-lifecycle-test.mjs` line 648:**
    ```javascript
    // --------------------------------------------------------------------------
    // T21: Full Financial Forensics & Invariants
    // --------------------------------------------------------------------------
    console.log('[T21] Kiểm tra 9 Bất biến Tài chính P1.3 / P1.4...');
    // runs forensicQuery checking 9 metrics
    ```
  - **`docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md` Section 9:**
    ```text
    | T21 | 9 Financial Invariants verification | All 9 metrics = 0 violations | PASS |
    ```
- **Impact:** Test script contract diverges from the frozen specification document. While all 12 regression test suites were successfully run externally during Gate 8, `p1_4-overdue-lifecycle-test.mjs` alone does not fulfill the self-contained definition of T21.
- **Recommendation:** 
  1. Either update `scripts/p1_4-overdue-lifecycle-test.mjs` so T21 programmatically executes or invokes the regression suites (while retaining the 9 forensics as an integrated invariant assertion); OR
  2. Issue a formal Product Owner Errata/Addendum officially approving the separation of the 9 Financial Forensics into T21 and the 12 Regression Suites into Gate 8 verification.
- **Blocking:** **YES**

---

### FIND-P1.4-02: Bank Reconciliation Omitted from T20 Concurrency Race Bundle
- **Severity:** LOW / NON-BLOCKING
- **Finding:** The concurrency race bundle in test T20 of `scripts/p1_4-overdue-lifecycle-test.mjs` does not include a concurrent bank reconciliation match request, despite the scenario title citing it.
- **Evidence:**
  - T20 title: `[T20] Kiểm tra Concurrency Locking (Quét nợ, Phân bổ, Cấn trừ & Đối soát)...`
  - In `scripts/p1_4-overdue-lifecycle-test.mjs` lines 570–622, the `Promise.all` bundle launches:
    - Op 1: `triggerOverdueScan()`
    - Op 2: Direct Payment Allocation on `inv1`
    - Op 3: Unapplied Cash Auto-Settlement on `inv2`
    - Op 4: Concurrent Overdue Scan (`triggerOverdueScan()`)
    - Op 5: Direct Payment Allocation on `inv3`
  - No call to `/api/reconciliation/manual-match` or auto-match is present in that concurrent promise bundle.
- **Impact:** Low. Bank reconciliation concurrency was independently tested and verified PASS in `scripts/p1_2-payment-allocation-test.mjs` (Test 12) and `scripts/p0-remediation-test.mjs` (Test 2.2).
- **Recommendation:** Add a concurrent `/api/reconciliation/manual-match` attempt into the T20 `Promise.all` array during future test maintenance.
- **Blocking:** **NO**

---

### FIND-P1.4-03: Implementation Report Prematurely Claims Closure Artifact was "Committed"
- **Severity:** LOW / NON-BLOCKING
- **Finding:** The Implementation Report states that the closure artifact was committed, whereas git status confirms it remains an untracked file.
- **Evidence:**
  - `docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md` Section 17 (Line 321):
    *"The official implementation closure documentation has been committed to: docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md"*
  - Real `git status` output:
    ```text
    Untracked files:
      docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md
    ```
- **Impact:** Discrepancy between documentation text and physical git repository state.
- **Recommendation:** Clarify in the documentation that the report has been drafted and saved in the working tree, pending formal closure commit.
- **Blocking:** **NO**

---

### FIND-P1.4-04: Chronological Audit Log Count Ambiguity
- **Severity:** INFORMATIONAL / NON-BLOCKING
- **Finding:** The Implementation Report cites two different valid audit log totals (2,875 in Section 9 vs 3,169 in Section 6 and 10).
- **Evidence:**
  - Section 9: `T19: SHA-256 audit chain verification -> PASS (2875 records verified valid)`
  - Section 6: `Total audit log count stands at 3,169 records with 100% hash consistency.`
- **Root Cause Analysis:** 
  T19 executed during `p1_4-overdue-lifecycle-test.mjs`, when the total records numbered 2,875. Subsequent execution of the 12 regression test suites generated 294 additional audit log entries. When final verification was run at the end of Gate 8, the record count had grown to 3,169.
- **Impact:** None on cryptographic validity (both were 100% valid at their respective times), but presents apparent inconsistency without chronological explanation.
- **Recommendation:** Annotate the numbers with timestamps or chronological phase labels.
- **Blocking:** **NO**

---

### FIND-P1.4-05: Frontend E2E Test Suite Classification
- **Severity:** INFORMATIONAL / NON-BLOCKING
- **Finding:** `scripts/frontend-e2e-test.mjs` is an HTTP integration and static asset smoke test, not a full browser-driven DOM E2E test.
- **Evidence:**
  - Uses Node.js native `fetch` to request static files (`index.html`, `styles.css`, `app.js`) and 23 API endpoints.
  - Does not spin up Chromium/Playwright/Puppeteer to test real user interactions in a browser DOM.
- **Impact:** None on system correctness.
- **Recommendation:** Accurately describe the suite as "Frontend HTTP & Asset Integration Smoke Test".
- **Blocking:** **NO**

---

## 4. INDEPENDENT VERIFICATION OF CORE DOMAINS

### 4.1 Migration 07 Verification
Direct inspection via PostgreSQL `\d public.invoices`:
- `invoices_status_check`:
  `CHECK (status::text = ANY (ARRAY['DRAFT'::character varying, 'ISSUED'::character varying, 'PARTIALLY_PAID'::character varying, 'OVERDUE'::character varying, 'PAID'::character varying, 'CANCELLED'::character varying]::text[]))`
- `invoices_issued_have_number`:
  `CHECK ((status::text <> ALL (ARRAY['ISSUED'::character varying, 'PARTIALLY_PAID'::character varying, 'OVERDUE'::character varying, 'PAID'::character varying]::text[])) OR invoice_no IS NOT NULL)`
- `idx_invoices_overdue_scan`:
  `btree (due_date) WHERE status::text = ANY (ARRAY['ISSUED'::character varying, 'PARTIALLY_PAID'::character varying]::text[])`
- `idx_invoices_customer_overdue`:
  `btree (customer_id) WHERE status::text = 'OVERDUE'::text`
- **Result:** **VERIFIED COMPLIANT**.

---

### 4.2 Overdue Finite State Machine (FSM)
Direct code inspection across domain services:
- `app/src/services/paymentService.js` (lines 404, 690):
  ```sql
  status = CASE 
    WHEN paid_total + $2::numeric + adjusted_total >= total THEN 'PAID'
    WHEN status = 'OVERDUE' THEN 'OVERDUE'
    ELSE 'PARTIALLY_PAID'
  END
  ```
- `app/src/routes/adjustments.js` (line 250):
  ```sql
  status = CASE 
    WHEN paid_total + adjusted_total + $2::numeric >= total THEN 'PAID'
    WHEN status = 'OVERDUE' THEN 'OVERDUE'
    ELSE 'PARTIALLY_PAID'
  END
  ```
- `OVERDUE` + full settlement $\to$ `PAID`.
- `OVERDUE` + partial settlement $\to$ `OVERDUE`.
- `OVERDUE` $\to$ `PARTIALLY_PAID` transition is strictly impossible.
- **Result:** **VERIFIED COMPLIANT**.

---

### 4.3 Scheduler Architecture & Deadlock Safety
- Advisory Lock ID: `88812346` (completely isolated from P1.3 `88812345`).
- Row locking: `SELECT id, invoice_no, due_date, total, paid_total, adjusted_total, status FROM public.invoices WHERE id = $1 FOR UPDATE`.
- Recheck condition: `if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status) || outstanding <= 0) continue;`
- Atomic transition and audit emission committed per invoice.
- **Result:** **VERIFIED COMPLIANT**.

---

### 4.4 File Attribution Analysis
Auditing git status and diff across the codebase:
- `app/src/routes/payments.js`:
  Only change is exporting `extractAndRequireIdempotencyKey`. This was introduced in **P1.3** to support the invoice auto-allocation endpoint. Classified as **P1.3 Pre-existing**.
- `app/src/routes/recurring.js`:
  All modifications relate to `auto_settle_unapplied` and calling `PaymentService.autoAllocateUnappliedCash`. Classified as **P1.3 Pre-existing**.
- No unauthorized or out-of-scope code exists in either file.
- **Result:** **VERIFIED COMPLIANT**.

---

### 4.5 Financial Forensics Verification
Direct execution of the 9 authoritative financial invariant queries on PostgreSQL `billing`:
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
- **Result:** **0 VIOLATIONS ACROSS ALL 9 METRICS (VERIFIED COMPLIANT)**.

---

### 4.6 Cryptographic Audit Chain Verification
Independent execution of [`scripts/verify-audit-chain.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-audit-chain.mjs):
```json
{
  "verified": true,
  "valid": true,
  "verified_count": 3169,
  "total_records": 3169,
  "message": "Toàn vẹn chuỗi kiểm toán SHA-256: 100% bản ghi (3169) đã được xác thực an toàn tuyệt đối."
}
```
- Duplicate transition check: `SELECT metadata->>'invoice_id', count(*) FROM audit_logs WHERE action = 'INVOICE_OVERDUE_FLAGGED' GROUP BY metadata->>'invoice_id' HAVING count(*) > 1` returned **0 rows**.
- Total `INVOICE_OVERDUE_FLAGGED` events: **87 records**, all with valid cryptographic linkage.
- **Result:** **100% VALID CRYPTOGRAPHIC CHAIN (VERIFIED COMPLIANT)**.

---

### 4.7 Scope Compliance Check
Direct scan for forbidden functionality in `app/src`:
- Dunning: **0 references**
- Customer Auto-Locking: **0 references**
- Notification / SMTP / Webhook: **0 references**
- Debt Write-Off / Bad Debt: **0 references**
- Late Interest: **0 references**
- Payment Gateways: **0 references**
- **Result:** **100% SCOPE COMPLIANT**.

---

## 5. TEST MODIFICATION HISTORY AUDIT

Audit of changes made during development of `scripts/p1_4-overdue-lifecycle-test.mjs`:
1. **Setting `issue_date` to past alongside `due_date`:** Required to satisfy database check constraint `invoices_due_date_after_issue` (`due_date >= issue_date`). Validated as technically necessary and does not weaken the test.
2. **`SCAN_RESULT:` Prefix Parsing:** Corrected multi-line JSON parsing caused by logger output. Validated as a formatting correction with zero assertion impact.
3. **Audit Column Names:** Corrected query from `username, user_role` to `actor_name, actor_role` in PostgreSQL `audit_logs`. Validated as schema alignment; assertion values (`SystemScheduler`, `SYSTEM`) were preserved.
4. **Admin Role for Invoice Cancellation in T08:** Invoices cancel endpoint requires permission `invoice.cancel`, which is assigned to `admin`. Validated as correct RBAC usage.
5. **Field `allocated_amount` in T14:** Corrected JSON response property check from `amount` to `allocated_amount`. Validated as response contract alignment; assertion value (`1000000.00`) was preserved.

**Auditor Conclusion:** None of the modifications made during test script development weakened assertions or invalidated test results.

---

## 6. AUDIT CONCLUSION & REMEDIATION PATHWAY

While the software engineering, financial integrity, concurrency safety, database migration, and cryptographic chain subsystems are completely functional and pass all tests, Milestone P1.4 closure cannot be stamped `VERIFIED` until the contractual discrepancy in **FIND-P1.4-01** is formally resolved.

### Required Actions to Unblock Closure:
1. **Remediation Action:**
   In [`scripts/p1_4-overdue-lifecycle-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_4-overdue-lifecycle-test.mjs), update T21 to programmatically run/invoke the regression test suites (or sub-processes them), while keeping the 9 Financial Forensics query either within T21 or as an integrated sub-step.
   Alternatively, the Product Owner must formally issue an official amendment documenting that T21 in `p1_4-overdue-lifecycle-test.mjs` verifies the 9 Financial Invariants and that the 12 Regression Suites are verified as part of the overall Gate 8 verification protocol.
2. **Report Clarification:**
   Update [`docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md) to accurately state that the document is authored and pending closure commit, and clarify the audit log count progression (2,875 at T19 $\to$ 3,169 after full regression).
