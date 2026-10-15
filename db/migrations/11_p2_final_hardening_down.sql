-- ============================================================================
-- BILLING_ONE MIGRATION 11 DOWN: ROLLBACK P2 FINAL HARDENING
-- ============================================================================

\set ON_ERROR_STOP on

DROP TRIGGER IF EXISTS trg_ensure_bank_transaction_hash ON public.bank_transactions;

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

CREATE TRIGGER trg_ensure_bank_transaction_hash
    BEFORE INSERT ON public.bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_bank_transaction_hash();

DROP FUNCTION IF EXISTS public.compute_canonical_bank_tx_hash(text, text, date, numeric, text, text);
