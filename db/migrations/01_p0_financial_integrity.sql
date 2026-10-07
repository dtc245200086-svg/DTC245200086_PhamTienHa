-- ============================================================================
-- BILLING_ONE P0 FINANCIAL INTEGRITY MIGRATION
-- File: db/migrations/01_p0_financial_integrity.sql
-- Transaction-safe, Idempotent, Rerun-safe, Auditable
-- Addresses: FIND-01, FIND-02, FIND-03, FIND-04
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. SCHEMA EVOLUTION: Add adjusted_total to public.invoices
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS adjusted_total numeric(14, 2) NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- 2. CREATE ARCHIVE TABLE FOR LEGACY CREDIT NOTE SETTLEMENTS (FIND-01)
-- Preserves complete financial and audit history without data loss.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legacy_credit_note_payments (
    id bigint PRIMARY KEY,
    invoice_id bigint NOT NULL REFERENCES public.invoices(id),
    amount numeric(14, 2) NOT NULL,
    method varchar(24) NOT NULL,
    paid_at date NOT NULL,
    reference varchar(120),
    recorded_by bigint NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL,
    bank_name varchar(100),
    bank_account varchar(50),
    notes text,
    migrated_at timestamptz NOT NULL DEFAULT now(),
    migration_reason text NOT NULL DEFAULT 'FIND-01 Remediation: Reclassified non-cash credit settlement out of payments ledger'
);

-- ----------------------------------------------------------------------------
-- 3. ARCHIVE AND RECLASSIFY 13 LEGACY CREDIT_NOTE PAYMENTS (FIND-01)
-- ----------------------------------------------------------------------------
-- 3.1. Copy all CREDIT_NOTE records into legacy_credit_note_payments
INSERT INTO public.legacy_credit_note_payments (
    id, invoice_id, amount, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account, notes
)
SELECT id, invoice_id, amount, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account, notes
FROM public.payments
WHERE method = 'CREDIT_NOTE'
ON CONFLICT (id) DO NOTHING;

-- 3.2. Deduct legacy CREDIT_NOTE amounts from invoices.paid_total (reversing false cash payments)
UPDATE public.invoices i
SET paid_total = i.paid_total - sub.credit_sum
FROM (
    SELECT invoice_id, sum(amount) AS credit_sum
    FROM public.payments
    WHERE method = 'CREDIT_NOTE'
    GROUP BY invoice_id
) sub
WHERE i.id = sub.invoice_id;

-- 3.3. Remove non-cash CREDIT_NOTE records from public.payments
DELETE FROM public.payments
WHERE method = 'CREDIT_NOTE';

-- 3.4. Restrict payments_method_check to genuine cash flows only
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check 
    CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CARD'));

-- ----------------------------------------------------------------------------
-- 4. POPULATE invoices.adjusted_total FROM PROCESSED ADJUSTMENTS (FIND-01 & FIND-02)
-- ----------------------------------------------------------------------------
UPDATE public.invoices i
SET adjusted_total = coalesce(sub.adj_sum, 0)
FROM (
    SELECT original_invoice_id, sum(total_amount) AS adj_sum
    FROM public.invoice_adjustments
    WHERE status = 'PROCESSED'
    GROUP BY original_invoice_id
) sub
WHERE i.id = sub.original_invoice_id;

-- Ensure invoice status reflects both cash payments and credit adjustments
UPDATE public.invoices
SET status = 'PAID'
WHERE status = 'PARTIALLY_PAID' AND (paid_total + adjusted_total) >= total;

-- ----------------------------------------------------------------------------
-- 5. RECONCILE 10 HISTORICAL INVOICES (FIND-03)
-- Pairs: (384, 385), (386, 387), (401, 402), (410, 411), (422, 423)
-- ----------------------------------------------------------------------------

-- Pair 1: Invoices 384 and 385 (Payment 203 of 41M: 30M for 384, 11M for 385)
DO $$
DECLARE
    v_new_pay_id bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = 203 AND amount = 41000000.00) THEN
        UPDATE public.payments
        SET amount = 30000000.00,
            notes = 'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000253)'
        WHERE id = 203;

        INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account, notes)
        SELECT 385, 11000000.00, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account,
               'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000254)'
        FROM public.payments WHERE id = 203
        RETURNING id INTO v_new_pay_id;

        UPDATE public.payment_allocations
        SET payment_id = v_new_pay_id
        WHERE id = 5;
    END IF;
END $$;

-- Pair 2: Invoices 386 and 387 (Payment 204 of 41M: 30M for 386, 11M for 387)
DO $$
DECLARE
    v_new_pay_id bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = 204 AND amount = 41000000.00) THEN
        UPDATE public.payments
        SET amount = 30000000.00,
            notes = 'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000255)'
        WHERE id = 204;

        INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account, notes)
        SELECT 387, 11000000.00, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account,
               'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000256)'
        FROM public.payments WHERE id = 204
        RETURNING id INTO v_new_pay_id;

        UPDATE public.payment_allocations
        SET payment_id = v_new_pay_id
        WHERE id = 7;
    END IF;
END $$;

-- Pair 3: Invoices 401 and 402 (Payment 212 of 41M: 30M for 401, 11M for 402)
DO $$
DECLARE
    v_new_pay_id bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = 212 AND amount = 41000000.00) THEN
        UPDATE public.payments
        SET amount = 30000000.00,
            notes = 'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000264)'
        WHERE id = 212;

        INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account, notes)
        SELECT 402, 11000000.00, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account,
               'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000265)'
        FROM public.payments WHERE id = 212
        RETURNING id INTO v_new_pay_id;

        UPDATE public.payment_allocations
        SET payment_id = v_new_pay_id
        WHERE id = 15;
    END IF;
END $$;

-- Pair 4: Invoices 410 and 411 (Payment 217 of 41M: 30M for 410, 11M for 411)
DO $$
DECLARE
    v_new_pay_id bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = 217 AND amount = 41000000.00) THEN
        UPDATE public.payments
        SET amount = 30000000.00,
            notes = 'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000270)'
        WHERE id = 217;

        INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account, notes)
        SELECT 411, 11000000.00, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account,
               'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000271)'
        FROM public.payments WHERE id = 217
        RETURNING id INTO v_new_pay_id;

        UPDATE public.payment_allocations
        SET payment_id = v_new_pay_id
        WHERE id = 20;
    END IF;
END $$;

-- Pair 5: Invoices 422 and 423 (Payment 225 of 41M: 30M for 422, 11M for 423)
DO $$
DECLARE
    v_new_pay_id bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = 225 AND amount = 41000000.00) THEN
        UPDATE public.payments
        SET amount = 30000000.00,
            notes = 'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000279)'
        WHERE id = 225;

        INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account, notes)
        SELECT 423, 11000000.00, method, paid_at, reference, recorded_by, created_at, bank_name, bank_account,
               'Phân bổ từ khoản thanh toán tổng 41000000.00 ₫ (Hóa đơn INV-2026-000280)'
        FROM public.payments WHERE id = 225
        RETURNING id INTO v_new_pay_id;

        UPDATE public.payment_allocations
        SET payment_id = v_new_pay_id
        WHERE id = 28;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. CONSTRAINTS & INTEGRITY CHECKS (FIND-01, FIND-03, FIND-04)
-- ----------------------------------------------------------------------------
-- 6.1. Enforce financial invariant: paid_total >= 0 AND adjusted_total >= 0 AND (paid_total + adjusted_total) <= total
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_check 
    CHECK (paid_total >= 0 AND adjusted_total >= 0 AND (paid_total + adjusted_total) <= total);

-- 6.2. Enforce bank reconciliation 1:1 match constraint (FIND-04)
CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_matched_payment_idx 
    ON public.bank_transactions (matched_payment_id) 
    WHERE matched_payment_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 7. PERMISSIONS FOR APPLICATION AND READONLY ROLES
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_credit_note_payments TO billing_app;
GRANT SELECT ON public.legacy_credit_note_payments TO billing_readonly;

COMMIT;
