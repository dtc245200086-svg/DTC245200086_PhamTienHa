-- ============================================================================
-- BILLING_ONE MIGRATION 10 DOWN: ROLLBACK P1 SETTLEMENT & OPERATIONAL AUTOMATION
-- ============================================================================

\set ON_ERROR_STOP on

-- Rollback bank_transactions
DROP TRIGGER IF EXISTS trg_ensure_bank_transaction_hash ON public.bank_transactions;
DROP FUNCTION IF EXISTS public.ensure_bank_transaction_hash();

ALTER TABLE public.bank_transactions
    DROP CONSTRAINT IF EXISTS bank_transactions_tx_hash_key;

ALTER TABLE public.bank_transactions
    DROP COLUMN IF EXISTS tx_hash;

-- Rollback recurring_plans
ALTER TABLE public.recurring_plans
    DROP CONSTRAINT IF EXISTS recurring_plans_vat_rate_check;

ALTER TABLE public.recurring_plans
    DROP COLUMN IF EXISTS vat_rate,
    DROP COLUMN IF EXISTS payment_term_id;

-- Rollback refund_payables
ALTER TABLE public.refund_payables
    DROP CONSTRAINT IF EXISTS refund_payables_payout_method_check;

ALTER TABLE public.refund_payables
    DROP COLUMN IF EXISTS settled_at,
    DROP COLUMN IF EXISTS settled_by,
    DROP COLUMN IF EXISTS payout_method,
    DROP COLUMN IF EXISTS payout_reference;
