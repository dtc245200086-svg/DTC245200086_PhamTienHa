-- ============================================================================
-- BILLING_ONE MIGRATION 11: P2 FINAL HARDENING
-- Domains:
--   1. Finding J: Canonical Reconciliation Identity Hash Function (Anti-Spoofing & Re-Backfill)
--   2. Enforce DB boundary uniqueness and prevent client hash tampering
-- ============================================================================

\set ON_ERROR_STOP on

-- 1. CANONICAL HASH FUNCTION: public.compute_canonical_bank_tx_hash
-- Deterministic, immutable business identity hashing without surrogate PKs.
CREATE OR REPLACE FUNCTION public.compute_canonical_bank_tx_hash(
    p_bank_account text,
    p_reference text,
    p_tx_date date,
    p_amount numeric,
    p_tx_type text,
    p_description text
) RETURNS character varying(64) AS $$
DECLARE
    clean_account text := btrim(coalesce(p_bank_account, ''));
    clean_ref text := btrim(coalesce(p_reference, ''));
    clean_type text := upper(btrim(coalesce(p_tx_type, 'CREDIT')));
    clean_desc text := btrim(coalesce(p_description, ''));
    clean_date text := to_char(p_tx_date, 'YYYY-MM-DD');
    clean_amount text := to_char(p_amount, 'FM99999999999990.00');
BEGIN
    IF clean_ref <> '' THEN
        RETURN encode(sha256((clean_account || ':' || clean_ref)::bytea), 'hex');
    ELSE
        RETURN encode(sha256((clean_account || ':' || clean_date || ':' || clean_amount || ':' || clean_type || ':' || clean_desc)::bytea), 'hex');
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. ANTI-SPOOFING TRIGGER: ensure_bank_transaction_hash
-- Always computes authoritative hash from business attributes, completely overriding
-- any client-supplied fake tx_hash to guarantee deduplication at DB boundary.
CREATE OR REPLACE FUNCTION public.ensure_bank_transaction_hash()
RETURNS trigger AS $$
BEGIN
    NEW.tx_hash := public.compute_canonical_bank_tx_hash(
        NEW.bank_account,
        NEW.reference,
        NEW.tx_date,
        NEW.amount,
        NEW.tx_type,
        NEW.description
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_bank_transaction_hash ON public.bank_transactions;
CREATE TRIGGER trg_ensure_bank_transaction_hash
    BEFORE INSERT OR UPDATE ON public.bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_bank_transaction_hash();

-- 3. RESOLVE ANY HISTORICAL UNREFERENCED DUPLICATE ROW BEFORE RE-BACKFILL
-- Assign deterministic reference identifier to legacy unreferenced collision rows
UPDATE public.bank_transactions
SET reference = 'LEGACY-TX-' || id::text
WHERE (reference IS NULL OR btrim(reference) = '')
  AND id IN (
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY bank_account, tx_date, amount, tx_type, btrim(description) ORDER BY id) as rn
      FROM public.bank_transactions
      WHERE reference IS NULL OR btrim(reference) = ''
    ) t WHERE t.rn > 1
  );

-- 4. RE-BACKFILL HISTORICAL TRANSACTIONS
-- Clean any past hash that contained surrogate id::text
UPDATE public.bank_transactions
SET tx_hash = public.compute_canonical_bank_tx_hash(
    bank_account,
    reference,
    tx_date,
    amount,
    tx_type,
    description
);

-- 5. PERMISSIONS & ROLE GRANTS
GRANT EXECUTE ON FUNCTION public.compute_canonical_bank_tx_hash(text, text, date, numeric, text, text) TO billing_app;
GRANT EXECUTE ON FUNCTION public.compute_canonical_bank_tx_hash(text, text, date, numeric, text, text) TO billing_readonly;
