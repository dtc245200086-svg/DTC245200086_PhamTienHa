# BILLING_ONE — P1.4 IMPLEMENTATION PLAN & EXECUTION INVENTORY
## AUTOMATED OVERDUE INVOICE LIFECYCLE ENGINE (CANDIDATE A ONLY)

**Document Version:** 1.0.0 (GATE 0 BLUEPRINT)  
**Author:** Principal Financial Systems Architect + Database Architect + Concurrency Engineer + QA Lead  
**Approval Reference:** Product Owner Implementation Authorization for P1.4  
**Date:** October 07, 2026  
**Operational Scope:** Candidate A ONLY — Zero Scope Expansion  
**Baseline Git State:** Preserving all historical P1.3/P1.3.1 files and migrations intact  

---

## 1. EXECUTIVE SUMMARY & OBJECTIVE

This document serves as the formal **Gate 0 Execution Plan** for Milestone P1.4 in Billing_One. The business scope is 100% frozen per [BILLING_ONE_P1_4_OFFICIAL_SPEC.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_OFFICIAL_SPEC.md) v1.0.2.

The sole approved scope is:
**Candidate A — Automated Overdue Invoice Lifecycle Engine**.

### Core Business Invariants to Implement:
1. `OVERDUE` becomes a persistent invoice status: `CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'))`.
2. Eligibility for transition to `OVERDUE`:
   - `status IN ('ISSUED', 'PARTIALLY_PAID')`
   - `outstanding_amount = total - paid_total - adjusted_total > 0`
   - `due_date < CURRENT_DATE` (PostgreSQL date semantics, 0 days grace period; `current_date = due_date` is NOT overdue).
3. Payment interaction semantics:
   - `OVERDUE` + full settlement $\to$ `PAID`.
   - `OVERDUE` + partial settlement $\to$ remains `OVERDUE` (NEVER reverts to `PARTIALLY_PAID`).
   - `OVERDUE` remains fully payable across manual allocation, unapplied cash auto-settlement, and bank reconciliation.
4. Audit integrity:
   - Each actual transition generates `INVOICE_OVERDUE_FLAGGED` via SHA-256 chain in `public.audit_logs`.
   - Authoritative Actor: `{ id: null, username: "SystemScheduler", role: "SYSTEM" }`.
   - Strict idempotency: repeated scans produce 0 duplicate transitions and 0 duplicate audit events.
5. Absolute Out of Scope:
   - Zero Dunning, zero customer status auto-lock/unlock, zero external notification systems (SMTP/SMS/Webhooks), zero debt write-offs, zero collection cases, zero late interest, zero payment gateways.

---

## 2. INVENTORY OF FILES TO MODIFY & CREATE

### A. New Files to Create:
1. `db/migrations/07_p1_4_overdue_lifecycle.sql` — Migration 07 (DDL constraints and partial indexes).
2. `scripts/p1_4-overdue-lifecycle-test.mjs` — Comprehensive test suite covering T01–T21 (including T20 concurrency).
3. `docs/BILLING_ONE_P1_4_IMPLEMENTATION_PLAN.md` — This execution plan (Gate 0).
4. `docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md` — Final implementation & verification closure report (Gate 8).

### B. Existing Files to Modify:
1. `app/src/services/paymentService.js` — Whitelist `OVERDUE` in `allocatePayment` and `autoSettleInvoiceFromUnapplied`; update status transition CASE expressions.
2. `app/src/routes/adjustments.js` — Ensure credit note adjustments on `OVERDUE` invoices preserve `OVERDUE` if partial debt remains, or `PAID` if fully settled.
3. `app/src/routes/reconciliation.js` — Include `OVERDUE` in auto-match lookup and manual reconciliation payable check.
4. `app/src/scheduler.js` — Add `runOverdueScan(pool)` with `OVERDUE_SCAN_LOCK_ID = 88812346`, safe single-invoice row locking, and SHA-256 audit logging.
5. `app/src/routes/customers.js` — Update `current_debt` and `available_credit` queries to include `OVERDUE`.
6. `app/src/routes/dashboard.js` — Update outstanding and overdue count queries to include `OVERDUE`.
7. `app/src/routes/reports.js` — Update `/aging`, `/collection-metrics`, and `/vat` queries to include `OVERDUE`. Leave `/revenue` queries untouched (`status <> 'CANCELLED'`).
8. `app/src/routes/invoices.js` — Add `OVERDUE` to `STATUSES` validator set so `GET /api/invoices?status=OVERDUE` functions correctly.
9. `app/public/app.js` — Add red badge for `OVERDUE`, enable action buttons (*"+ Ghi nhận thanh toán"*, *"⚡ Cấn trừ tự động"*) for `OVERDUE`, add filter support and days overdue display.

---

## 3. DATABASE MIGRATION SPECIFICATION (GATE 1)

### Migration File: `db/migrations/07_p1_4_overdue_lifecycle.sql`
- **Transaction Safety:** Enclosed in `BEGIN ... COMMIT`.
- **Constraint 1 (Status Check):**
  ```sql
  ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check 
      CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'));
  ```
- **Constraint 2 (Invoice Number Check):**
  ```sql
  ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_issued_have_number;
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_issued_have_number
      CHECK (status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID') OR invoice_no IS NOT NULL);
  ```
- **Partial Index 1 (Overdue Scanner):**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_invoices_overdue_scan 
      ON public.invoices (due_date) 
      WHERE status IN ('ISSUED', 'PARTIALLY_PAID');
  ```
- **Partial Index 2 (Customer Overdue Filter):**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_invoices_customer_overdue 
      ON public.invoices (customer_id) 
      WHERE status = 'OVERDUE';
  ```
- **Invariants Protected:**
  - Zero modification to numeric monetary columns or constraints (`paid_total`, `adjusted_total`, `total`).
  - Zero modification to `public.payments`, `public.payment_allocations`, `public.users`, or `public.audit_logs`.

---

## 4. DOMAIN & SCHEDULER ENGINE SPECIFICATION (GATES 2 & 3)

### A. Payment & Settlement Whitelist (`paymentService.js`):
- `allocatePayment`: Whitelist check updated to `['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status)`.
- `autoSettleInvoiceFromUnapplied`: Whitelist check updated to `['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)`.
- Status transition logic:
  ```sql
  status = CASE 
    WHEN paid_total + $2::numeric + adjusted_total >= total THEN 'PAID'
    WHEN status = 'OVERDUE' THEN 'OVERDUE'
    ELSE 'PARTIALLY_PAID' 
  END
  ```

### B. Adjustments & Reconciliation:
- `adjustments.js`: Update credit note finalization CASE to keep `OVERDUE` if remaining balance $> 0$.
- `reconciliation.js`: Update auto-match query (line 99) and manual match check (line 194) to include `OVERDUE`.

### C. Overdue Scan Engine (`scheduler.js`):
- Dedicated Advisory Lock: `const OVERDUE_SCAN_LOCK_ID = 88812346;` (completely isolated from P1.3 `88812345`).
- Candidate query:
  ```sql
  SELECT id, invoice_no, due_date, total, paid_total, adjusted_total
  FROM public.invoices
  WHERE status IN ('ISSUED', 'PARTIALLY_PAID')
    AND due_date < CURRENT_DATE
    AND (total - paid_total - adjusted_total) > 0
  ORDER BY id ASC;
  ```
- Concurrency-safe processing:
  Iterate candidates. For each candidate, open a dedicated transaction:
  ```sql
  SELECT id, invoice_no, due_date, total, paid_total, adjusted_total, status
  FROM public.invoices
  WHERE id = $1
  FOR UPDATE;
  ```
  Re-verify:
  `status IN ('ISSUED', 'PARTIALLY_PAID') AND (total - paid_total - adjusted_total) > 0 AND due_date < CURRENT_DATE`
  If still eligible:
  1. `UPDATE public.invoices SET status = 'OVERDUE' WHERE id = $1`
  2. Call `recordAudit(client, auditPayload)` with:
     - `user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' }`
     - `action: 'INVOICE_OVERDUE_FLAGGED'`
     - `metadata: { invoice_id, invoice_no, due_date, days_overdue, outstanding_amount, scanned_at }`
  3. `COMMIT`.

---

## 5. REPORTING, CUSTOMER DEBT & API SPECIFICATION (GATES 4 & 5)

### A. Reporting Queries (`reports.js`):
- `/aging`: Update filters to `WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')`. Days overdue dynamically calculated as `CURRENT_DATE - due_date`.
- `/collection-metrics`: Update `receivables` and `overdue_total` to include `'OVERDUE'`.
- `/vat`: Update VAT declaration to include `'OVERDUE'`.
- `/revenue`: Unchanged (`status <> 'CANCELLED'`).

### B. Customer Profile & Dashboard (`customers.js`, `dashboard.js`):
- `current_debt`: Sums outstanding for `status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')`.
- `available_credit`: Calculates credit limit minus debt with `OVERDUE` included.
- Dashboard outstanding counts and amounts include `OVERDUE`.

### C. API Contract (`invoices.js`):
- `STATUSES` validation set: `new Set(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'])`.
- `GET /api/invoices?status=OVERDUE` returns overdue invoices.

---

## 6. FRONTEND SPECIFICATION (GATE 6)

### `app/public/app.js`:
- Badge: `status === 'OVERDUE'` renders danger badge (e.g. `badge-danger` / red border and background).
- Detail view buttons: `['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)` allows *"+ Ghi nhận thanh toán"* and *"⚡ Cấn trừ tự động"*.
- Detail view metadata: Displays `Số ngày quá hạn: X ngày` when `status === 'OVERDUE'`.
- List filter: Filter tabs and dropdowns include `OVERDUE`.

---

## 7. TEST STRATEGY & TEST SUITES (GATE 7)

### Dedicated Test Script: `scripts/p1_4-overdue-lifecycle-test.mjs`
Implements the 21 mandatory test scenarios:
- **T01:** `ISSUED` before due date remains `ISSUED`.
- **T02:** `ISSUED` on due date (`current_date = due_date`) remains `ISSUED`.
- **T03:** `ISSUED` past due date transitions to `OVERDUE`.
- **T04:** `PARTIALLY_PAID` before due date remains `PARTIALLY_PAID`.
- **T05:** `PARTIALLY_PAID` past due date transitions to `OVERDUE`.
- **T06:** `DRAFT` past due date NEVER transitions to `OVERDUE`.
- **T07:** `PAID` past due date NEVER transitions to `OVERDUE`.
- **T08:** `CANCELLED` past due date NEVER transitions to `OVERDUE`.
- **T09:** Fully paid invoice (`outstanding = 0`) NEVER transitions to `OVERDUE`.
- **T10:** `OVERDUE` + 100% full payment transitions to `PAID`.
- **T11:** `OVERDUE` + partial payment REMAINS `OVERDUE`.
- **T12:** Idempotency: repeated scan runs produce consistent results.
- **T13:** Audit deduplication: repeated scan runs produce 0 duplicate audit events.
- **T14:** Direct manual payment allocation on `OVERDUE` invoice succeeds (HTTP 200/201).
- **T15:** Auto-settlement from unapplied cash on `OVERDUE` invoice succeeds.
- **T16:** Customer `current_debt` remains mathematically accurate when invoice turns `OVERDUE`.
- **T17:** Aging report (`/api/reports/aging`) correctly reflects `OVERDUE` invoices in aging buckets.
- **T18:** Collection metrics (`/api/reports/collection-metrics`) reflect `OVERDUE` invoices accurately.
- **T19:** SHA-256 audit chain remains 100% valid with 0 broken links.
- **T20:** Concurrency safety test: simultaneous overdue scan, payment allocation, unapplied cash settlement, and reconciliation on overlapping invoices with ZERO 40P01 deadlocks.
- **T21:** Full regression assurance.

---

## 8. REGRESSION & FINANCIAL FORENSICS MATRIX (GATE 8)

### Authoritative 9 P1.3 Forensic Metrics Verification:
1. `payment_over_allocation = 0`
2. `negative_unapplied = 0`
3. `invoice_allocation_mismatch = 0`
4. `collectible_capacity_violation = 0`
5. `duplicate_scheduler_allocation = 0`
6. `dup_sched_keys = 0`
7. `p13_created_payments = 0`
8. `non_positive_payments = 0`
9. `non_positive_allocations = 0`

### Full Regression Test Suites to Run:
1. `p0-remediation-test.mjs`
2. `p1-refund-ledger-test.mjs`
3. `p1_2-payment-allocation-test.mjs`
4. `p1_2_1-idempotency-test.mjs`
5. `p1_2_2-mandatory-idempotency-test.mjs`
6. `p1_3-auto-settlement-test.mjs`
7. `p1_3_1-remediation-test.mjs`
8. `verify-audit-chain.mjs`
9. `cp2-smoke.mjs`
10. `extended-features-test.mjs`
11. `frontend-e2e-test.mjs`
12. `verify-hardening.ps1`

---

## 9. EXECUTION ORDER & SAFETY GATES

```
[GATE 0] Inventory & Safety Checkpoint (Completed: this document)
   │
   ▼
[GATE 1] Apply Database Migration 07 (Check constraints + partial indexes)
   │     Verify DB schema & existing data compatibility
   ▼
[GATE 2] Domain & Service Updates (paymentService, adjustments, reconciliation)
   │     Verify whitelist & state transition logic
   ▼
[GATE 3] Scheduler Engine (runOverdueScan with lock 88812346 & SHA-256 audit)
   │     Verify single-row transaction locking & idempotency
   ▼
[GATE 4] Reporting, Customer Profile & Dashboard Updates
   │     Verify aging, metrics, VAT, debt queries
   ▼
[GATE 5] API Routing Updates (invoices.js validator & query support)
   │     Verify GET /api/invoices?status=OVERDUE
   ▼
[GATE 6] Frontend Enhancements (app.js status badge, buttons, filters)
   │     Verify UI interactions
   ▼
[GATE 7] Execute Dedicated P1.4 Test Suite (T01–T21 including T20 concurrency)
   │     Fix any identified defects
   ▼
[GATE 8] Full Regression, Forensic Metrics (9/9), Audit Chain Verification
         Compile docs/BILLING_ONE_P1_4_IMPLEMENTATION_REPORT.md
```

---

## 10. SAFETY CONFIRMATION

- [x] Zero Git resets, zero checkouts, zero clean commands.
- [x] Historical P1.3/P1.3.1 files, scripts, and migrations preserved untouched.
- [x] Scope strictly locked to Candidate A.
- [x] Ready to proceed to **GATE 1**.
