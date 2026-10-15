-- ============================================================================
-- BILLING_ONE P1.5 CUSTOMER CREDIT RISK CONTROL & ENFORCEMENT MIGRATION
-- File: db/migrations/08_p1_5_credit_risk_control.sql
-- Scope: Milestone P1.5 — Customer Credit Risk Control & Enforcement Engine
-- Source: docs/BILLING_ONE_P1_5_OFFICIAL_SPEC.md (v1.0.0 Final Frozen)
-- Transaction-safe, Idempotent, Rerun-safe, Backward-compatible
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXTEND CUSTOMERS TABLE WITH RISK CONTROL & LOCK METADATA
-- ----------------------------------------------------------------------------
-- 1.1 Add lock metadata columns
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS lock_source VARCHAR(16) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS lock_reason TEXT DEFAULT NULL;

-- 1.2 Constraint for valid lock sources
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_lock_source_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_lock_source_check
    CHECK (lock_source IS NULL OR lock_source IN ('MANUAL', 'AUTO_RISK'));

-- 1.3 Ensure credit_limit is NOT NULL with default 0 (unlimited credit)
UPDATE public.customers SET credit_limit = 0 WHERE credit_limit IS NULL;
ALTER TABLE public.customers ALTER COLUMN credit_limit SET DEFAULT 0;
ALTER TABLE public.customers ALTER COLUMN credit_limit SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. EXTEND COMPANY SETTINGS WITH CREDIT CONTROL ENGINE POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.company_settings
    ADD COLUMN IF NOT EXISTS credit_control_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS auto_lock_overdue_days INTEGER NOT NULL DEFAULT 30;

ALTER TABLE public.company_settings DROP CONSTRAINT IF EXISTS company_settings_overdue_days_check;
ALTER TABLE public.company_settings ADD CONSTRAINT company_settings_overdue_days_check
    CHECK (auto_lock_overdue_days >= 1);

-- ----------------------------------------------------------------------------
-- 3. EXPAND USERS ROLE CHECK CONSTRAINT (PRESERVING EXISTING DATA & ROLES)
-- ----------------------------------------------------------------------------
ALTER TABLE public.users ALTER COLUMN role TYPE character varying(32);
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['admin', 'staff', 'ROLE_BILLING_MANAGER', 'ROLE_ACCOUNTANT', 'ROLE_AUDITOR']));

-- ----------------------------------------------------------------------------
-- 4. SEED P1.5 PERMISSIONS & MAP EXCLUSIVELY TO PRIVILEGED ROLES
-- ----------------------------------------------------------------------------
-- 4.1 Insert permissions (Idempotent)
INSERT INTO public.permissions (code, module, description)
VALUES
    ('invoice.issue_override', 'invoices', 'Phê duyệt phát hành hóa đơn đặc cách vượt hạn mức hoặc cho khách hàng bị khóa'),
    ('customer.unlock', 'customers', 'Mở khóa công nợ khách hàng (LOCKED -> ACTIVE)')
ON CONFLICT (code) DO NOTHING;

-- 4.2 Map permissions to admin and ROLE_BILLING_MANAGER
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code IN ('admin', 'ROLE_BILLING_MANAGER')
  AND p.code IN ('invoice.issue_override', 'customer.unlock')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. CREATE OPTIMIZED PARTIAL INDEXES FOR RISK SCANNER & DEBT LOOKUPS
-- ----------------------------------------------------------------------------
-- 5.1 Partial index for scanner status evaluation
CREATE INDEX IF NOT EXISTS idx_customers_status_risk
    ON public.customers (status)
    WHERE status IN ('WARNING', 'LOCKED');

-- 5.2 Partial index for credit limit enforcement query
CREATE INDEX IF NOT EXISTS idx_customers_credit_limit
    ON public.customers (credit_limit)
    WHERE credit_limit > 0;

-- 5.3 Partial index for customer open debt calculation
CREATE INDEX IF NOT EXISTS idx_invoices_customer_open_debt
    ON public.invoices (customer_id, status)
    WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE');

COMMIT;
