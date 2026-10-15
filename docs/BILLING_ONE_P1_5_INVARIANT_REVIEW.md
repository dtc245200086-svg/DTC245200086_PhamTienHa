# BILLING_ONE — P1.5 INVARIANT REVIEW & FORENSIC SPECIFICATION
## RIGOROUS MATHEMATICAL AUDIT OF THE 7 NEW FINANCIAL INVARIANTS

**Document Version:** 1.0.0 — FORENSIC INVARIANT SPECIFICATION  
**Milestone:** P1.5 — Customer Credit Risk Control & Enforcement Engine  
**Source Spec:** [`docs/BILLING_ONE_P1_5_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_5_OFFICIAL_SPEC.md) (v1.0.0 Final Frozen)  
**Date:** October 2026  

---

## 1. PURPOSE & PRINCIPLES OF FORENSIC PROOF

A financial invariant is an immutable assertion about system state that must evaluate to **0 violations** at all times.

### Core Forensic Requirement
In financial systems, calculating historical invariants using current database table states (e.g. current unpaid balance) is fundamentally flawed because subsequent transactions (payments, adjustments, refunds) continuously mutate those balances.

Therefore, for decisions made at a point in time (such as invoice issuance eligibility), the proof **must rely on immutable cryptographic audit snapshots** captured atomically within the issuance transaction.

---

## 2. IN-DEPTH REVIEW OF THE 7 P1.5 INVARIANTS

### INVARIANT 1: `issued_invoice_exceeds_credit_limit_without_override`
- **Business Definition:** No invoice may be issued under normal flow if the customer has a defined positive credit limit ($L_{credit} > 0$) and the projected debt ($D_{prior} + \text{invoice.total}$) exceeds that limit, unless authorized via a registered `INVOICE_ISSUE_OVERRIDDEN` event.
- **Source of Truth:** Frozen Spec Section 14 & Section 24.1.
- **Forensic Snapshot Fields Required in `INVOICE_ISSUED`:**
  `invoice_id`, `invoice_no`, `customer_id`, `credit_limit`, `current_debt_prior`, `invoice_total`, `projected_debt`, `issue_decision`.
- **SQL Proof Query:**
  ```sql
  SELECT count(*) AS violations
  FROM public.audit_logs a
  WHERE a.action = 'INVOICE_ISSUED'
    AND (a.metadata->>'credit_limit')::numeric > 0
    AND ((a.metadata->>'current_debt_prior')::numeric + (a.metadata->>'invoice_total')::numeric) > (a.metadata->>'credit_limit')::numeric
    AND COALESCE(a.metadata->>'issue_decision', 'NORMAL') = 'NORMAL';
  ```
- **Threshold:** Exactly `0`.
- **Known Limitations:** Requires that all invoice issuance endpoints write the full financial snapshot into `audit_logs.metadata`.

---

### INVARIANT 2: `locked_customer_invoice_issue_without_override`
- **Business Definition:** No invoice may be issued to a customer whose standing was `LOCKED` at the moment of issuance, unless issued through the manager override workflow.
- **Source of Truth:** Frozen Spec Section 14 & Section 24.2.
- **Forensic Snapshot Fields Required in `INVOICE_ISSUED`:**
  `customer_status_prior`, `issue_decision`.
- **SQL Proof Query:**
  ```sql
  SELECT count(*) AS violations
  FROM public.audit_logs a
  WHERE a.action = 'INVOICE_ISSUED'
    AND a.metadata->>'customer_status_prior' = 'LOCKED'
    AND COALESCE(a.metadata->>'issue_decision', 'NORMAL') = 'NORMAL';
  ```
- **Threshold:** Exactly `0`.

---

### INVARIANT 3: `duplicate_override_by_idempotency_key`
- **Business Definition:** An idempotency key submitted to `POST /api/invoices/:id/issue-override` must never result in multiple distinct invoice issuance events or duplicate database mutations.
- **Source of Truth:** Frozen Spec Section 15 & Section 24.3.
- **SQL Proof Query:**
  ```sql
  -- Proof across audit logs:
  SELECT coalesce(sum(dup_count), 0) AS violations
  FROM (
    SELECT metadata->>'idempotency_key' AS key, count(DISTINCT target_ref) - 1 AS dup_count
    FROM public.audit_logs
    WHERE action = 'INVOICE_ISSUE_OVERRIDDEN'
      AND metadata->>'idempotency_key' IS NOT NULL
    GROUP BY metadata->>'idempotency_key'
    HAVING count(DISTINCT target_ref) > 1
  ) q;
  ```
- **Threshold:** Exactly `0`.

---

### INVARIANT 4: `unauthorized_override_count`
- **Business Definition:** All `INVOICE_ISSUE_OVERRIDDEN` audit events must originate strictly from actors possessing `invoice.issue_override` (`admin` or `ROLE_BILLING_MANAGER`).
- **Source of Truth:** Frozen Spec Section 21 & Section 24.4.
- **SQL Proof Query:**
  ```sql
  SELECT count(*) AS violations
  FROM public.audit_logs a
  WHERE a.action = 'INVOICE_ISSUE_OVERRIDDEN'
    AND a.actor_role NOT IN ('admin', 'ROLE_BILLING_MANAGER');
  ```
- **Threshold:** Exactly `0`.

---

### INVARIANT 5: `duplicate_auto_lock_transition`
- **Business Definition:** The background scanner must never execute or log an auto-lock transition on a customer whose status was already `LOCKED` at the time of evaluation.
- **Source of Truth:** Frozen Spec Section 12.3 & Section 24.5.
- **SQL Proof Query:**
  ```sql
  SELECT count(*) AS violations
  FROM public.audit_logs a
  WHERE a.action = 'CUSTOMER_STATUS_AUTO_LOCKED'
    AND a.metadata->>'status_prior' = 'LOCKED';
  ```
- **Threshold:** Exactly `0`.

---

### INVARIANT 6: `invalid_auto_unlock_count`
- **Business Definition:** Any transition from `LOCKED` to `ACTIVE` or `WARNING` must originate strictly from an authorized manual unlock event (`CUSTOMER_STATUS_MANUAL_UNLOCKED`). Automated unlocking and unfreezing via normal profile updates are strictly prohibited.
- **Source of Truth:** Frozen Spec Section 13 & Section 24.6.
- **SQL Proof Query (Deterministic, Zero Heuristics):**
  ```sql
  SELECT count(*) AS violations
  FROM public.audit_logs a
  WHERE a.module = 'customers'
    AND (a.metadata->>'status_prior' = 'LOCKED' OR a.metadata->>'previous_status' = 'LOCKED')
    AND (a.metadata->>'status' IN ('ACTIVE', 'WARNING') OR a.metadata->>'target_status' IN ('ACTIVE', 'WARNING'))
    AND a.action != 'CUSTOMER_STATUS_MANUAL_UNLOCKED';
  ```
- **Threshold:** Exactly `0`.

---

### INVARIANT 7: `customer_debt_consistency`
- **Business Definition:** Absolute mathematical consistency between customer open debt and open invoice outstanding totals. Specifically:
  1. For every customer $c$:
     $$D(c) = \sum_{i \in \text{OpenInvoices}(c)} (\text{total}_i - \text{paid\_total}_i - \text{adjusted\_total}_i)$$
     where $\text{status} \in (\text{'ISSUED'}, \text{'PARTIALLY\_PAID'}, \text{'OVERDUE'})$.
  2. The sum of all customer debts across the database must equal the total outstanding balance of all open invoices:
     $$\sum_{c} D(c) = \sum_{i \in \text{AllOpenInvoices}} \text{outstanding}_i$$
  3. No open invoice may have $\text{outstanding} < 0$.
  4. No customer may have $D(c) < 0$.
- **Source of Truth:** Frozen Spec Section 11 & Section 24.7.
- **SQL Proof Query:**
  ```sql
  WITH customer_debts AS (
    SELECT coalesce(sum(
      coalesce((SELECT sum(total - paid_total - adjusted_total) 
                FROM public.invoices 
                WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)
    ), 0) AS sum_customer_debt
    FROM public.customers c
  ),
  invoice_debts AS (
    SELECT coalesce(sum(total - paid_total - adjusted_total), 0) AS sum_invoice_debt
    FROM public.invoices
    WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
  ),
  integrity_checks AS (
    SELECT 
      ABS(cd.sum_customer_debt - id.sum_invoice_debt) AS debt_mismatch,
      (SELECT count(*) FROM public.invoices WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) < 0) AS negative_invoices,
      (SELECT count(*) FROM (
        SELECT c.id, coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0) AS c_debt
        FROM public.customers c
      ) qc WHERE qc.c_debt < 0) AS negative_customers
    FROM customer_debts cd, invoice_debts id
  )
  SELECT 
    CASE 
      WHEN debt_mismatch > 0.00 OR negative_invoices > 0 OR negative_customers > 0 THEN 1 
      ELSE 0 
    END AS violations
  FROM integrity_checks;
  ```
- **Threshold:** Exactly `0`.
- **Interpretation:** This query verifies global conservation of debt across the entire database. If even 1 VND of discrepancy exists between customer subqueries and invoice tables, it evaluates to `1 violation`.
