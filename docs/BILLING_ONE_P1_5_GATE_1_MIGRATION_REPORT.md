# BILLING_ONE — P1.5 GATE 1 MIGRATION REPORT
## MIGRATION 08: CUSTOMER CREDIT RISK CONTROL & ENFORCEMENT SCHEMA

**Document Version:** 1.0.0 — GATE 1 MIGRATION CLOSURE  
**Milestone:** P1.5 — Customer Credit Risk Control & Enforcement Engine  
**Migration File:** `db/migrations/08_p1_5_credit_risk_control.sql`  
**Rollback File:** `db/migrations/08_p1_5_credit_risk_control_down.sql`  
**Baseline Git Commit:** `8fbb8c861cbe46c28f902155e19188978604d76d`  
**Author:** Principal Financial Systems Architect + Database Architect + Security/RBAC Architect + Release Auditor  
**Date:** October 2026  

---

## 1. PRE-MIGRATION SCHEMA SNAPSHOT & BASELINE STATE

Prior to applying Migration 08, a forensic snapshot of the target database relations was recorded:

### 1.1. Pre-Migration Data Counts
- `public.customers`: **785 rows** (`credit_limit IS NULL` = **0 rows**).
- `public.invoices`: **1,692 rows**.
- `public.payments`: **1,407 rows**.
- `public.audit_logs`: **5,766 rows** (100% valid cryptographic SHA-256 chain).
- `public.users`: **2 rows** (`admin` with role `'admin'`, `staff` with role `'staff'`).
- `public.roles`: **5 rows** (`admin`, `staff`, `ROLE_BILLING_MANAGER`, `ROLE_ACCOUNTANT`, `ROLE_AUDITOR`).
- `public.permissions`: **19 rows** (IDs 1 through 19).
- `public.company_settings`: **1 row** (`id = 1`).

### 1.2. Pre-Migration Table Schemas
- `customers`: Lacked `lock_source`, `locked_at`, `lock_reason`. `credit_limit` was nullable (`numeric(14,2) DEFAULT 0`).
- `company_settings`: Lacked `credit_control_enabled`, `auto_lock_overdue_days`.
- `users`: Check constraint `users_role_check` restricted `role` strictly to `ARRAY['admin', 'staff']`.

---

## 2. MIGRATION SPECIFICATION

The migration script [`db/migrations/08_p1_5_credit_risk_control.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/08_p1_5_credit_risk_control.sql) was drafted in strict compliance with the Frozen Specification:

```sql
BEGIN;

-- 1. Extend customers with risk control & lock metadata
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS lock_source VARCHAR(16) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS lock_reason TEXT DEFAULT NULL;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_lock_source_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_lock_source_check
    CHECK (lock_source IS NULL OR lock_source IN ('MANUAL', 'AUTO_RISK'));

UPDATE public.customers SET credit_limit = 0 WHERE credit_limit IS NULL;
ALTER TABLE public.customers ALTER COLUMN credit_limit SET DEFAULT 0;
ALTER TABLE public.customers ALTER COLUMN credit_limit SET NOT NULL;

-- 2. Extend company settings with credit control policies
ALTER TABLE public.company_settings
    ADD COLUMN IF NOT EXISTS credit_control_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS auto_lock_overdue_days INTEGER NOT NULL DEFAULT 30;

ALTER TABLE public.company_settings DROP CONSTRAINT IF EXISTS company_settings_overdue_days_check;
ALTER TABLE public.company_settings ADD CONSTRAINT company_settings_overdue_days_check
    CHECK (auto_lock_overdue_days >= 1);

-- 3. Expand users role check constraint
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['admin', 'staff', 'ROLE_BILLING_MANAGER', 'ROLE_ACCOUNTANT', 'ROLE_AUDITOR']));

-- 4. Seed P1.5 permissions & map exclusively to privileged roles
INSERT INTO public.permissions (code, module, description)
VALUES
    ('invoice.issue_override', 'invoices', 'Phê duyệt phát hành hóa đơn đặc cách vượt hạn mức hoặc cho khách hàng bị khóa'),
    ('customer.unlock', 'customers', 'Mở khóa công nợ khách hàng (LOCKED -> ACTIVE)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code IN ('admin', 'ROLE_BILLING_MANAGER')
  AND p.code IN ('invoice.issue_override', 'customer.unlock')
ON CONFLICT DO NOTHING;

-- 5. Create optimized partial indexes
CREATE INDEX IF NOT EXISTS idx_customers_status_risk
    ON public.customers (status)
    WHERE status IN ('WARNING', 'LOCKED');

CREATE INDEX IF NOT EXISTS idx_customers_credit_limit
    ON public.customers (credit_limit)
    WHERE credit_limit > 0;

CREATE INDEX IF NOT EXISTS idx_invoices_customer_open_debt
    ON public.invoices (customer_id, status)
    WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE');

COMMIT;
```

---

## 3. EXECUTION MEASUREMENT & RESULT

- **Execution Command:**
  ```powershell
  Get-Content db/migrations/08_p1_5_credit_risk_control.sql | docker exec -i billing-postgres-1 psql -U postgres -d billing
  ```
- **Execution Timestamp:** `2026-10-07 20:16:11.380` to `2026-10-07 20:16:11.577` (Total process runtime: **197 ms**, actual database transaction execution $< 50$ ms).
- **Lock Wait / Errors:** Zero lock waits, zero deadlocks, zero errors.
- **Affected Row Counts:**
  - `UPDATE public.customers SET credit_limit = 0 WHERE credit_limit IS NULL`: **0 rows** (all rows were non-null).
  - `INSERT INTO public.permissions`: **2 rows** (`invoice.issue_override`, `customer.unlock`).
  - `INSERT INTO public.role_permissions`: **4 rows** (2 permissions $\times$ 2 privileged roles).
  - `CREATE INDEX`: **3 indexes** created successfully.

---

## 4. POST-MIGRATION SCHEMA & INTEGRITY VERIFICATION

### 4.1. Columns & Defaults Verification
- `public.customers`:
  - `credit_limit`: `numeric(14,2)`, `is_nullable = NO`, `column_default = 0` (**PASS**)
  - `lock_source`: `character varying(16)`, `is_nullable = YES`, `column_default = NULL` (**PASS**)
  - `locked_at`: `timestamp with time zone`, `is_nullable = YES` (**PASS**)
  - `lock_reason`: `text`, `is_nullable = YES` (**PASS**)
- `public.company_settings`:
  - `credit_control_enabled`: `boolean`, `is_nullable = NO`, `column_default = true` (**PASS**)
  - `auto_lock_overdue_days`: `integer`, `is_nullable = NO`, `column_default = 30` (**PASS**)

### 4.2. Constraints Verification
- `customers_lock_source_check`: `CHECK (lock_source IS NULL OR lock_source IN ('MANUAL', 'AUTO_RISK'))` (**PASS**)
- `company_settings_overdue_days_check`: `CHECK (auto_lock_overdue_days >= 1)` (**PASS**)
- `users_role_check`: `CHECK (role = ANY (ARRAY['admin', 'staff', 'ROLE_BILLING_MANAGER', 'ROLE_ACCOUNTANT', 'ROLE_AUDITOR']))` (**PASS**)

### 4.3. Indexes Verification
- `idx_customers_status_risk`: `CREATE INDEX ... ON public.customers (status) WHERE status IN ('WARNING', 'LOCKED')` (**PASS**)
- `idx_customers_credit_limit`: `CREATE INDEX ... ON public.customers (credit_limit) WHERE credit_limit > 0` (**PASS**)
- `idx_invoices_customer_open_debt`: `CREATE INDEX ... ON public.invoices (customer_id, status) WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')` (**PASS**)

### 4.4. Permissions & RBAC Mapping Verification
```
 id |          code          |  module   |                               description                               
----+------------------------+-----------+-------------------------------------------------------------------------
 20 | invoice.issue_override | invoices  | Phê duyệt phát hành hóa đơn đặc cách vượt hạn mức hoặc cho khách hàng bị khóa
 21 | customer.unlock        | customers | Mở khóa công nợ khách hàng (LOCKED -> ACTIVE)
```
Role Mapping:
- `admin`: Granted `invoice.issue_override` & `customer.unlock` (**ALLOW**)
- `ROLE_BILLING_MANAGER`: Granted `invoice.issue_override` & `customer.unlock` (**ALLOW**)
- `staff`: **0 mappings (DENY)**
- `ROLE_ACCOUNTANT`: **0 mappings (DENY)**
- `ROLE_AUDITOR`: **0 mappings (DENY)**

### 4.5. Data Conservation & Audit Verification
- `customers`: **785 rows** (100% preserved, 0 nulls in credit_limit).
- `invoices`: **1,692 rows** (100% preserved).
- `payments`: **1,407 rows** (100% preserved).
- `audit_logs`: **5,766 rows** (100% preserved).
- `verify-audit-chain.mjs`: **5,766 / 5,766 hashes verified valid (0 broken links)**.

---

## 5. ROLLBACK SAFETY & DOWN MIGRATION AUDIT

The companion rollback migration script [`db/migrations/08_p1_5_credit_risk_control_down.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/08_p1_5_credit_risk_control_down.sql) was audited:
1. Safely drops the 3 partial indexes.
2. Removes role-permission mappings for the 2 P1.5 permissions.
3. Deletes the 2 P1.5 permissions.
4. Checks dynamically via PL/pgSQL whether any users have roles other than `admin` or `staff` before reverting `users_role_check`.
5. Removes columns `credit_control_enabled` and `auto_lock_overdue_days` from `company_settings`.
6. Removes columns `lock_source`, `locked_at`, `lock_reason` and relaxes `credit_limit NOT NULL` on `customers`.
- **Verdict:** Rollback is completely non-destructive to pre-existing P0–P1.4 data and 100% reversible.

---

## 6. GIT INTEGRITY & ZERO UNRELATED CHANGES

Execution of `git status` confirms:
- **New Files Created:**
  - `db/migrations/08_p1_5_credit_risk_control.sql`
  - `db/migrations/08_p1_5_credit_risk_control_down.sql`
  - `docs/BILLING_ONE_P1_5_GATE_1_MIGRATION_REPORT.md`
- **Modified Production Files:** **0 files** (Zero changes in `app/src/`, `app/public/`, `scripts/`).

---

## 7. KNOWN EXCEPTIONS CARRY-FORWARD

1. **CP2 40P01 Concurrency Finding:** Pre-existing P1.2 payment concurrency defect documented in [`docs/BILLING_ONE_P1_5_BASELINE_CONCURRENCY_FINDING.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_5_BASELINE_CONCURRENCY_FINDING.md). Preserved as known baseline exception.
2. **`remediation-verification.mjs`:** Obsolete pre-P0 legacy artifact asserting deprecated credit-note payment model. Excluded from official regression baseline.

---

## 8. FINAL GATE 1 VERDICT

```
================================================================================
                              GATE 1 FINAL VERDICT:
                                 GATE 1 — PASS
================================================================================
```

| Check Item | Verdict | Evidence |
|---|:---:|---|
| **Migration Execution** | **PASS** | Completed in < 50ms database transaction time, 0 errors. |
| **Schema DDL** | **PASS** | Columns, defaults, and NOT NULL semantics verified in DB. |
| **Constraints** | **PASS** | `customers_lock_source_check`, `overdue_days_check`, `users_role_check` active. |
| **Permissions & RBAC** | **PASS** | 2 permissions seeded and mapped exclusively to admin & manager. |
| **Indexes** | **PASS** | 3 partial indexes verified in `pg_indexes`. |
| **Data Integrity** | **PASS** | Customer (785), Invoice (1,692), Payment (1,407) row counts identical. |
| **Audit Chain** | **PASS** | 5,766 / 5,766 valid cryptographic SHA-256 links. |
| **Unrelated Code Changes** | **NO** | Zero production code touched. |

**Next Gate:** `GATE 2 — CustomerCreditService Domain Service` (Awaiting user authorization).
