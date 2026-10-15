# BILLING_ONE — P1 FINANCIAL CORE REPORT

**Phase:** P1 Financial Core (Payment Terms / Due Date + Item-Level Mixed VAT + DSO / CEI)  
**Date:** 2026-10-08  
**Status:** `P1 FINANCIAL CORE — PASS`  
**Authoritative Backend:** Billing_One (Node.js Express + PostgreSQL)  
**Financial Source of Truth:** PostgreSQL (`numeric(14,2)` Exact Arithmetic)  
**Reference Isolation:** `_reference/LedgerFlow/` — **STRICTLY UNCHANGED (0 edits, 100% isolated)**  

---

## EXECUTIVE SUMMARY

In this phase, all three core financial findings (`Finding C`, `Finding D`, and `Finding E`) were resolved in a single, controlled, production-grade delivery adhering to strict financial correctness, transaction coupling, audit-chain integrity, and regression safety:

1. **Gate C (Finding C — Payment Terms / Due Date):** Replaced manual due date requirements and hardcoded 30-day defaults with an authoritative backend engine (`PaymentTermsService`). Invoice due dates are computed deterministically as `base_date + term.days` using calendar-accurate UTC arithmetic, customer-profile term inheritance, system default fallback, and strict prevention of client due-date injection.
2. **Gate D (Finding D — Item-Level Mixed VAT):** Replaced invoice-header-only tax semantics with item-level VAT calculations. Added `vat_amount` and `total_amount` columns to `invoice_items` via migration `09_p1_financial_core.sql`, supported line-specific VAT rates ($0\%, 5\%, 8\%, 10\%$, and exemptions), enforced sum-of-lines reconciliation ($subtotal = \sum line\_total$, $tax\_amount = \sum vat\_amount$, $total = subtotal + tax\_amount$), product catalog SKU tax fallback, and server-side override of client-submitted totals.
3. **Gate E (Finding E — DSO / CEI Financial Analytics):** Completely eradicated hardcoded fallback values (`32.5` and `94.2`). Implemented canonical Credit Research Foundation (CRF) formula for CEI and authoritative 90-day DSO derived directly from PostgreSQL aggregations of receivables, sales, collections, and aging buckets. Zero-denominator situations deterministically return `null` or `0.0`.

---

## A. FINDING C — PAYMENT TERMS & DUE DATE ENGINE

### 1. Payment Terms Model
- **Source of Truth:** PostgreSQL table `public.payment_terms` (catalog containing `NET_0`, `NET_7`, `NET_15`, `NET_30`, `NET_45`, `NET_60`, `IMMEDIATE`, etc.).
- **Default Resolution Order:**
  1. Explicit valid `payment_term_id` passed in request payload (validated against active terms in database).
  2. If omitted, inherit `payment_term_id` from the customer's profile (`public.customers.payment_term_id`).
  3. If customer profile has no term, fall back to active system default term (`is_default = true`, canonically `NET_30`).
- **Validation:** If an invalid or non-existent `payment_term_id` is passed, the request is rejected with `HTTP 404 PAYMENT_TERM_NOT_FOUND` (fail closed).

### 2. Due Date Authority & Calculation Rule
- **Backend Authority:** The browser/client is never permitted to set or manipulate `due_date`. Any client-injected `due_date` field is ignored/overridden by the server's calculated date.
- **Formula:**
  $$\text{due\_date} = \text{base\_date} + \text{term.days}$$
- **Date Basis:**
  - For Draft creation (`POST /api/invoices`): `base_date = issue_date` if provided; otherwise current UTC date.
  - For Draft updates (`PUT /api/invoices/:id`): recalculated whenever `payment_term_id` is updated.
  - For Invoice issuance (`POST /api/invoices/:id/issue` & `issue-override`): synchronized authoritatively to `issue_date (current_date) + term.days`.
  - For Recurring plans (`scheduler.js`): `scheduler` resolves the customer's payment term dynamically instead of hardcoding `interval '30 days'`.
- **Date Semantics:** Uses exact calendar date arithmetic in UTC (`calculateDueDate(baseDateStr, days)` in `app/src/services/paymentTermsService.js`), correctly handling leap years (e.g. Feb 28/29), variable month lengths, and year rollovers.

### 3. Legacy Compatibility Strategy
- Existing historical invoices preserve their recorded historical `due_date`.
- New invoice drafts, updates, and issuances use the authoritative `PaymentTermsService`.
- No destructive or artificial bulk-rewriting of historical accounting transactions.

### 4. Gate C Test Evidence
- **Test Suite:** `scripts/p1-gate-c-payment-terms-test.mjs`
- **Results:** **17/17 PASSED (100%)**
  - T01: Leap year calendar date boundary handled correctly
  - T02: Month boundary and Year rollover handled correctly
  - T03: Terms catalog for NET 0, 7, 15, 30, 45, 60 present in database
  - T04: Test customer created with profile `payment_term_id = NET_30`
  - T05: NET 0 invoice creation correctly calculates and persists `due_date`
  - T06: NET 7 invoice creation correctly derives `due_date`
  - T07: NET 15 invoice creation correctly derives `due_date`
  - T08: NET 30 invoice creation correctly derives `due_date`
  - T09: NET 45 invoice creation correctly derives `due_date`
  - T10: NET 60 invoice creation correctly derives `due_date`
  - T11: When `payment_term_id` is omitted, customer profile term is inherited
  - T12: When customer has no term, system default term is authoritatively resolved
  - T13: Non-existent `payment_term_id` is rejected with 404 PAYMENT_TERM_NOT_FOUND
  - T14: Client-injected arbitrary `due_date` is thwarted in favor of server authority
  - T15: Updating draft invoice term recalculates and persists authoritative `due_date`
  - T16: Issuing invoice synchronizes `due_date` with `issue_date + term.days`
  - T17: Audit log transaction coupling and SHA-256 chain integrity verified

---

## B. FINDING D — ITEM-LEVEL MIXED VAT

### 1. Invoice Item Tax Model & Schema Evolution
- **Database Schema:** Migration `09_p1_financial_core.sql` added:
  - `invoice_items.vat_amount numeric(14, 2) NOT NULL DEFAULT 0`
  - `invoice_items.total_amount numeric(14, 2) NOT NULL DEFAULT 0`
  - Check constraints: `vat_rate >= 0.00 AND vat_rate <= 0.20`, `vat_amount >= 0`, `total_amount >= 0`.
  - Database trigger `trg_calculate_invoice_item_totals` on `invoice_items` to guarantee database-level financial integrity for direct SQL inserts.
- **Line Calculation:**
  $$\text{line\_total} = \text{round}(quantity \times unit\_price \times (1 - discount\_percent / 100), 2)$$
  $$\text{vat\_amount} = \text{round}(line\_total \times vat\_rate, 2)$$
  $$\text{total\_amount} = line\_total + vat\_amount$$

### 2. Rounding Policy & Sum-of-Lines Reconciliation
- **Rounding Rule:** Line-level half-up rounding to 2 decimal places (`numeric(14,2)`), followed by exact summation:
  $$subtotal = \sum line\_total$$
  $$tax\_amount = \sum vat\_amount$$
  $$total = subtotal + tax\_amount$$
  $$effective\_tax\_rate = \begin{cases} \text{round}(tax\_amount / subtotal, 4) & \text{if } subtotal > 0 \\ 0 & \text{otherwise} \end{cases}$$
- **Elimination of Rounding Drift:** Calculations are strictly line-first. Header VAT is the sum of lines, preventing distribution drift.
- **Client Total Override:** If a client submits conflicting `subtotal`, `tax_amount`, or `total`, the server derives and persists authoritative totals.

### 3. Mixed VAT Support
- Supports invoices containing lines with different VAT rates simultaneously:
  - E.g., Item 1 @ 8% VAT (VND 100,000 -> VAT VND 8,000)
  - Item 2 @ 10% VAT (VND 200,000 -> VAT VND 20,000)
  - Item 3 @ 0% VAT / exempt (VND 50,000 -> VAT VND 0)
  - Invoice Subtotal: VND 350,000 | Tax: VND 28,000 | Total: VND 378,000.
- When `vat_rate` is omitted for an item with an existing catalog `sku`, the product catalog tax rate is inherited automatically.

### 4. Gate D Test Evidence
- **Test Suite:** `scripts/p1-gate-d-mixed-vat-test.mjs`
- **Results:** **16/16 PASSED (100%)**
  - Setup: Test customer created
  - T01: Single-rate 10% invoice calculates net, VAT, and gross correctly
  - T02: Two mixed VAT rates (8% and 10%) calculate and reconcile accurately
  - T03: Three mixed VAT rates (0%, 5%, 10%) reconcile perfectly
  - T04: Zero VAT rate (0.00) yields 0.00 tax_amount and equal gross total
  - T05: Decimal quantity (2.5) evaluates exact decimal line math and tax
  - T06: Line-level rounding drift exposure test confirms exact sum-of-lines rule
  - T07: Client-submitted contradictory totals are overridden by server authority
  - T08: Negative `vat_rate` rejected with 400 VALIDATION_ERROR
  - T09: Excessive `vat_rate` (> 0.20) rejected with 400 VALIDATION_ERROR
  - T10: Zero/negative quantity rejected with 400 VALIDATION_ERROR
  - T11: Product catalog SKU automatically provides line `vat_rate`
  - T12: Updating draft invoice lines re-calculates all item taxes and totals
  - T13: Database `invoice_items` columns (`line_total`, `vat_rate`, `vat_amount`, `total_amount`) verified
  - T14: Issuing mixed-VAT invoice locks authoritative totals in database
  - T15: Audit log transaction coupling and SHA-256 chain integrity verified

---

## C. FINDING E — DSO / CEI FINANCIAL ANALYTICS

### 1. Purge of Hardcoded Placeholders
- **Audit Verification:** Confirmed `0` occurrences of hardcoded `32.5` and `94.2` in application source code (`app/src/routes/reports.js` and all other services).

### 2. Canonical Formula Definitions
All metrics are computed over an explicit 90-day reporting window ($T - 90\text{d}$ to current date $T$):

- **Ending Open Receivables ($E$):**
  $$E = \sum (total - paid\_total - adjusted\_total) \quad \text{for } status \in ('ISSUED', 'PARTIALLY\_PAID', 'OVERDUE')$$
- **Credit Sales in 90 Days ($S$):**
  $$S = \sum (total - adjusted\_total) \quad \text{for } issue\_date \ge current\_date - 90d \text{ and } status \ne 'CANCELLED'$$
- **Cash Collected in 90 Days ($C$):**
  $$C = \sum amount \quad \text{for } paid\_at \ge current\_date - 90d \text{ and } method \in ('CASH', 'BANK\_TRANSFER', 'CARD')$$
- **Beginning Receivables at $T - 90\text{d}$ ($B$):**
  $$B = \sum \max(0, (total - adjusted\_total) - paid\_before) \quad \text{for invoices issued before } T - 90d$$
- **Ending Current (Not Overdue) Receivables ($E_{current}$):**
  $$E_{current} = \sum (total - paid\_total - adjusted\_total) \quad \text{for } due\_date \ge current\_date$$
- **Ending Overdue Receivables ($E_{overdue}$):**
  $$E_{overdue} = \sum (total - paid\_total - adjusted\_total) \quad \text{for } due\_date < current\_date$$

### 3. Days Sales Outstanding (DSO) Formula
$$\text{DSO} = \begin{cases} \text{round}\left(\frac{E}{S} \times 90, 1\right) & \text{if } S > 0 \\ 0.0 & \text{if } S = 0 \text{ and } E = 0 \\ \text{null} & \text{if } S = 0 \text{ and } E > 0 \end{cases}$$

### 4. Collection Effectiveness Index (CEI) Canonical CRF Formula
Canonical Credit Research Foundation (CRF) formula:
$$\text{Eligible Debt} = B + S - E_{current}$$
$$\text{CEI} = \begin{cases} \text{round}\left(\min\left(100, \max\left(0, \frac{C}{\text{Eligible Debt}} \times 100\right)\right), 1\right) & \text{if } \text{Eligible Debt} > 0 \\ \text{null} & \text{if } \text{Eligible Debt} \le 0 \end{cases}$$

### 5. Mathematical Invariant & Lifecycle Integration
- **Receivables Decomposition:** $E = E_{current} + E_{overdue}$ holds exactly.
- **Invoice Issuance:** Increases $S$ by invoice total, increases $E$ and $E_{current}$ by invoice total.
- **Payments:** Reduces $E$, increases $C$, adjusts DSO and CEI deterministically.
- **Adjustments (Credit Notes):** Deducts `adjusted_total` from both $S$ and $E$.
- **Cancellations:** Excluded completely from $S$ and $E$.

### 6. Gate E Test Evidence
- **Test Suite:** `scripts/p1-gate-e-dso-cei-test.mjs`
- **Results:** **32/32 PASSED (100%)**
  - Case 1: Anonymous request rejected with 401
  - Case 2: Staff with `report.view` permission receives 200
  - Case 3: `app/src/routes/reports.js` contains no 32.5
  - Case 4: `app/src/routes/reports.js` contains no 94.2
  - Case 5-14: Live collection metrics payload schema verified (all fields present)
  - Case 15: Receivables invariant: `receivables == overdue_amount + current_receivables`
  - Case 16: Live DSO matches $(receivables / sales\_90d) \times 90$
  - Case 17: Live CEI matches $C / (B + S - E_{current}) \times 100$
  - Case 18: Issuing invoice increases sales_90d by exact total (20,000,000 VND)
  - Case 19: Issuing invoice increases open receivables by exact total (20,000,000 VND)
  - Case 20: Issuing invoice increases current receivables (not overdue)
  - Case 21: Partial payment reduces receivables by exact payment (8,000,000 VND)
  - Case 22: Partial payment increases collected_90d by exact payment (8,000,000 VND)
  - Case 23: Full payment reduces receivables back to initial baseline
  - Case 24: Cancelled invoice is not counted in sales_90d or receivables
  - Case 25: Adjusted invoice correctly deducts adjusted_total from open receivables
  - Case 26: `calcDso` with 0 sales and 0 receivables yields 0
  - Case 27: `calcDso` with 0 sales and open receivables yields null (never 32.5)
  - Case 28: `calcDso` with positive sales and receivables yields exact ratio
  - Case 29: `calcCei` with non-positive eligible debt yields null (never 94.2)
  - Case 30: `calcCei` with zero collections yields 0.0%
  - Case 31: `calcCei` with 100% collections yields 100.0%
  - Case 32: `calcCei` caps at 100% when collections exceed eligible debt

---

## D. DATABASE SCHEMA EVOLUTION

### Forward Migration: `09_p1_financial_core.sql`
- **Path:** `db/migrations/09_p1_financial_core.sql`
- **Rollback Path:** `db/migrations/09_p1_financial_core_down.sql`
- **Changes Applied:**
  1. Added column `public.invoice_items.vat_amount numeric(14,2) NOT NULL DEFAULT 0.00`.
  2. Added column `public.invoice_items.total_amount numeric(14,2) NOT NULL DEFAULT 0.00`.
  3. Added check constraints on `vat_rate`, `vat_amount`, and `total_amount`.
  4. Backfilled existing `invoice_items` data deterministically.
  5. Created trigger function and trigger `trg_calculate_invoice_item_totals` to ensure all direct SQL inserts automatically compute correct VAT and total line amounts.
- **Tracking & Checksum:**
  - Tracked in `public.schema_migrations` as version `09`.
  - SHA-256 checksum recorded in `schema_migrations`.
  - Total migrations tracked: **9/9**.
  - Historical migrations 01–08 and `db/init/` were **NOT** modified or renamed.

---

## E. REGRESSION SUITE EXECUTION RESULTS

| Test Script | Target Domain | Command | Result |
|---|---|---|---|
| `scripts/p1-gate-c-payment-terms-test.mjs` | Gate C — Payment Terms / Due Date | `node scripts/p1-gate-c-payment-terms-test.mjs` | **17/17 PASSED** |
| `scripts/p1-gate-d-mixed-vat-test.mjs` | Gate D — Item-Level Mixed VAT | `node scripts/p1-gate-d-mixed-vat-test.mjs` | **16/16 PASSED** |
| `scripts/p1-gate-e-dso-cei-test.mjs` | Gate E — DSO / CEI Analytics | `node scripts/p1-gate-e-dso-cei-test.mjs` | **32/32 PASSED** |
| `scripts/p0-security-audit-test.mjs` | P0 Security & Audit Chain Integrity | `node scripts/p0-security-audit-test.mjs` | **18/18 PASSED** |
| `scripts/p1_5-gate8-rbac-permission-test.mjs` | P1.5 RBAC & Boundary Matrix | `node scripts/p1_5-gate8-rbac-permission-test.mjs` | **38/38 PASSED** |
| `scripts/p1_5-gate5-manager-override-test.mjs` | P1.5 Manager Override | `node scripts/p1_5-gate5-manager-override-test.mjs` | **25/25 PASSED** |
| `scripts/p1_5-gate6-manual-unlock-test.mjs` | P1.5 Manual Unlock | `node scripts/p1_5-gate6-manual-unlock-test.mjs` | **25/25 PASSED** |
| `scripts/p1_5-domain-service-test.mjs` | P1.5 Credit Risk Domain Service | `node scripts/p1_5-domain-service-test.mjs` | **18/18 PASSED** |
| `scripts/verify-schema.mjs` | Schema Drift Verification | `docker compose run --rm --entrypoint node migration /app/scripts/verify-schema.mjs` | **41/41 PASSED** |
| `scripts/verify-audit-chain.mjs` | SHA-256 Cryptographic Chain Verification | `node scripts/verify-audit-chain.mjs` | **8,816/8,816 Records Verified (100% Intact)** |
| `scripts/test-fresh-deployment.mjs` | Fresh DB Clean Deployment & Migration Rerun | `node scripts/test-fresh-deployment.mjs` | **PASSED (100% Reproducible)** |

---

## F. SCOPE EXCLUSIONS CONFIRMATION

As strictly governed by the project roadmap, the following findings were **NOT implemented** during this phase:
- **Finding H:** Refund Lifecycle (`NOT IMPLEMENTED`)
- **Finding I:** Recurring Risk Enforcement (`NOT IMPLEMENTED`)
- **Finding J:** Reconciliation Deduplication (`NOT IMPLEMENTED`)
- **Finding K:** VAT Reporting Export (`NOT IMPLEMENTED`)
- **Finding L:** Print / Documents (`NOT IMPLEMENTED`)

---

## G. REFERENCE ISOLATION CONFIRMATION

- Directory `_reference/LedgerFlow/`:
  - `git status --porcelain _reference/LedgerFlow` -> **0 modifications (Clean)**
  - Strictly read-only reference; zero code, zero components, and zero mock data were transferred or modified.

---

## FINAL VERDICT

```text
========================================
BILLING_ONE P1 FINANCIAL CORE
========================================

Finding C — Payment Terms / Due Date: PASS
Finding D — Item-level Mixed VAT:       PASS
Finding E — DSO / CEI:                  PASS

Migration Integrity:                    PASS
Schema Integrity:                      PASS
Audit Integrity:                       PASS
P0 Security Regression:                 PASS
P1.5 Regression:                        PASS
Fresh Deployment:                      PASS
Reference Isolation:                   PASS
Scope Control:                          PASS

FINAL GATE:
P1 FINANCIAL CORE — PASS
========================================
```
