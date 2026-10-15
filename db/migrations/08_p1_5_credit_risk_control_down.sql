-- ============================================================================
-- BILLING_ONE P1.5 CUSTOMER CREDIT RISK CONTROL ROLLBACK MIGRATION (DOWN)
-- File: db/migrations/08_p1_5_credit_risk_control_down.sql
-- Scope: Reversible Rollback for Milestone P1.5 Migration 08
-- Transaction-safe, Dependency-aware
-- ============================================================================

BEGIN;

-- 1. DROP PARTIAL INDEXES
DROP INDEX IF EXISTS public.idx_invoices_customer_open_debt;
DROP INDEX IF EXISTS public.idx_customers_credit_limit;
DROP INDEX IF EXISTS public.idx_customers_status_risk;

-- 2. REMOVE ROLE PERMISSION MAPPINGS FOR P1.5 PERMISSIONS
DELETE FROM public.role_permissions
WHERE permission_id IN (
    SELECT id FROM public.permissions WHERE code IN ('invoice.issue_override', 'customer.unlock')
);

-- 3. REMOVE SEEDED P1.5 PERMISSIONS
DELETE FROM public.permissions
WHERE code IN ('invoice.issue_override', 'customer.unlock');

-- 4. REVERT USERS ROLE CHECK CONSTRAINT & COLUMN TYPE (Warning: only if no users with new roles exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE role NOT IN ('admin', 'staff')
    ) THEN
        ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE public.users ADD CONSTRAINT users_role_check
            CHECK (role = ANY (ARRAY['admin', 'staff']));
        ALTER TABLE public.users ALTER COLUMN role TYPE character varying(16);
    END IF;
END $$;

-- 5. REVERT COMPANY SETTINGS COLUMNS
ALTER TABLE public.company_settings DROP CONSTRAINT IF EXISTS company_settings_overdue_days_check;
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS auto_lock_overdue_days;
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS credit_control_enabled;

-- 6. REVERT CUSTOMERS RISK COLUMNS & CONSTRAINTS
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_lock_source_check;
ALTER TABLE public.customers DROP COLUMN IF EXISTS lock_reason;
ALTER TABLE public.customers DROP COLUMN IF EXISTS locked_at;
ALTER TABLE public.customers DROP COLUMN IF EXISTS lock_source;
ALTER TABLE public.customers ALTER COLUMN credit_limit DROP NOT NULL;

COMMIT;
