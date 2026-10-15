-- ============================================================================
-- BILLING_ONE MIGRATION 10: P1 SETTLEMENT & OPERATIONAL AUTOMATION
-- Domains:
--   1. Finding H: Refund Lifecycle & Settlement Columns
--   2. Finding I: Recurring Billing Item-Level VAT & Payment Term Binding
--   3. Finding J: Bank Reconciliation Canonical Identity & Database Deduplication
-- ============================================================================

\set ON_ERROR_STOP on

-- 1. REFUND PAYABLES: Settlement & Payout Columns
ALTER TABLE public.refund_payables
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS settled_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payout_method CHARACTER VARYING(24),
    ADD COLUMN IF NOT EXISTS payout_reference CHARACTER VARYING(120);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_payables_payout_method_check') THEN
        ALTER TABLE public.refund_payables
            ADD CONSTRAINT refund_payables_payout_method_check
            CHECK (payout_method IS NULL OR payout_method IN ('BANK_TRANSFER', 'CASH', 'CARD'));
    END IF;
END $$;

-- 2. RECURRING PLANS: Explicit Item VAT Rate & Payment Term Binding
ALTER TABLE public.recurring_plans
    ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1000,
    ADD COLUMN IF NOT EXISTS payment_term_id BIGINT REFERENCES public.payment_terms(id) ON DELETE SET NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_plans_vat_rate_check') THEN
        ALTER TABLE public.recurring_plans
            ADD CONSTRAINT recurring_plans_vat_rate_check
            CHECK (vat_rate >= 0.00 AND vat_rate <= 0.20);
    END IF;
END $$;

-- 3. BANK TRANSACTIONS: Canonical Identity Fingerprint & Unique Deduplication
ALTER TABLE public.bank_transactions
    ADD COLUMN IF NOT EXISTS tx_hash CHARACTER VARYING(64);

-- Deterministic backfill of tx_hash for historical bank transactions
UPDATE public.bank_transactions
SET tx_hash = encode(sha256((bank_account || ':' || btrim(reference))::bytea), 'hex')
WHERE reference IS NOT NULL AND btrim(reference) <> '' AND (tx_hash IS NULL OR tx_hash = '');

UPDATE public.bank_transactions
SET tx_hash = encode(sha256((bank_account || ':' || tx_date::text || ':' || amount::text || ':' || tx_type || ':' || id::text)::bytea), 'hex')
WHERE tx_hash IS NULL OR tx_hash = '';

ALTER TABLE public.bank_transactions
    ALTER COLUMN tx_hash SET NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_tx_hash_key') THEN
        ALTER TABLE public.bank_transactions
            ADD CONSTRAINT bank_transactions_tx_hash_key UNIQUE (tx_hash);
    END IF;
END $$;

-- Database trigger to compute tx_hash deterministically upon insert if not provided
CREATE OR REPLACE FUNCTION public.ensure_bank_transaction_hash()
RETURNS trigger AS $$
BEGIN
    IF NEW.tx_hash IS NULL OR NEW.tx_hash = '' THEN
        IF NEW.reference IS NOT NULL AND btrim(NEW.reference) <> '' THEN
            NEW.tx_hash := encode(sha256((NEW.bank_account || ':' || btrim(NEW.reference))::bytea), 'hex');
        ELSE
            NEW.tx_hash := encode(sha256((NEW.bank_account || ':' || NEW.tx_date::text || ':' || NEW.amount::text || ':' || NEW.tx_type || ':' || coalesce(NEW.description, ''))::bytea), 'hex');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_bank_transaction_hash ON public.bank_transactions;
CREATE TRIGGER trg_ensure_bank_transaction_hash
    BEFORE INSERT ON public.bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_bank_transaction_hash();

-- 4. Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.refund_payables TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_plans TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_transactions TO billing_app;

GRANT SELECT ON public.refund_payables TO billing_readonly;
GRANT SELECT ON public.recurring_plans TO billing_readonly;
GRANT SELECT ON public.bank_transactions TO billing_readonly;
