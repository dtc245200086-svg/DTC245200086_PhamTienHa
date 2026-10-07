-- ============================================================================
-- BILLING_ONE MIGRATION 06: P1.3 RECURRING BILLING AUTOMATED PAYMENT
-- & UNAPPLIED CASH SETTLEMENT ENGINE
-- Scope:
-- 1. Add auto_settle_unapplied column to recurring_plans table (default true)
-- 2. Add FIFO-supporting composite index on payments (customer_id, paid_at ASC, id ASC)
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. ADD auto_settle_unapplied COLUMN TO recurring_plans
-- Default is TRUE: newly generated recurring invoices will automatically settle against unapplied cash
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'recurring_plans'
          AND column_name = 'auto_settle_unapplied'
    ) THEN
        ALTER TABLE public.recurring_plans
        ADD COLUMN auto_settle_unapplied BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- 2. CREATE FIFO-SUPPORTING COMPOSITE INDEX ON payments
-- Optimizes FIFO candidate lookup: customer_id, paid_at ASC, id ASC
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_customer_fifo
ON public.payments (customer_id, paid_at ASC, id ASC);

-- 3. VERIFICATION BLOCK
-- Ensure migration succeeded and is non-destructive
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_column boolean;
    v_has_index boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'recurring_plans'
          AND column_name = 'auto_settle_unapplied'
    ) INTO v_has_column;

    SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'payments'
          AND indexname = 'idx_payments_customer_fifo'
    ) INTO v_has_index;

    IF NOT v_has_column THEN
        RAISE EXCEPTION 'MIGRATION FAILED: auto_settle_unapplied column missing on recurring_plans';
    END IF;

    IF NOT v_has_index THEN
        RAISE EXCEPTION 'MIGRATION FAILED: idx_payments_customer_fifo index missing on payments';
    END IF;

    RAISE NOTICE 'MIGRATION 06 VERIFIED: recurring_plans.auto_settle_unapplied and idx_payments_customer_fifo are present.';
END $$;

COMMIT;
