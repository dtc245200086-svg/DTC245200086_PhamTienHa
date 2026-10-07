-- ============================================================================
-- BILLING_ONE P1.2 PAYMENT ALLOCATION V2 MIGRATION
-- File: db/migrations/03_p1_2_payment_allocation_v2.sql
-- Transaction-safe, Idempotent, Rerun-safe, Non-destructive
-- Implements: 1 Real Payment -> N Allocations -> N Invoices & Unapplied Cash
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. UPDATE public.payments
-- Allow payments to represent real cash inflows independently of invoices.
-- Add customer_id for direct customer traceability.
-- Make invoice_id nullable (payment_allocations is the source of truth).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'customer_id'
    ) THEN
        ALTER TABLE public.payments ADD COLUMN customer_id bigint REFERENCES public.customers(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Backfill customer_id from existing invoices for historical payments
UPDATE public.payments p
SET customer_id = i.customer_id
FROM public.invoices i
WHERE i.id = p.invoice_id AND p.customer_id IS NULL;

-- Make invoice_id NULLABLE in public.payments
ALTER TABLE public.payments ALTER COLUMN invoice_id DROP NOT NULL;

-- Add index on customer_id
CREATE INDEX IF NOT EXISTS payments_customer_id_idx ON public.payments(customer_id);

-- ----------------------------------------------------------------------------
-- 2. UPDATE public.payment_allocations
-- Enhance payment_allocations table with audit columns and indexes.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'payment_allocations' AND column_name = 'created_by'
    ) THEN
        ALTER TABLE public.payment_allocations ADD COLUMN created_by bigint REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'payment_allocations' AND column_name = 'notes'
    ) THEN
        ALTER TABLE public.payment_allocations ADD COLUMN notes text;
    END IF;
END $$;

-- Backfill created_by for existing 66 allocations from payments.recorded_by
UPDATE public.payment_allocations pa
SET created_by = p.recorded_by
FROM public.payments p
WHERE p.id = pa.payment_id AND pa.created_by IS NULL;

-- ----------------------------------------------------------------------------
-- 3. LEGACY DATA MIGRATION: Backfill Missing 213 Allocations
-- Connect historical payments to payment_allocations so that
-- SUM(allocated_amount) = SUM(payments.amount) for all historical payments.
-- ----------------------------------------------------------------------------
INSERT INTO public.payment_allocations (payment_id, invoice_id, allocated_amount, created_at, created_by, notes)
SELECT p.id, p.invoice_id, p.amount, p.created_at, p.recorded_by, 'Di trú dữ liệu phân bổ lịch sử P1.2'
FROM public.payments p
LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
WHERE pa.id IS NULL AND p.invoice_id IS NOT NULL;

-- Add index on created_at for reporting
CREATE INDEX IF NOT EXISTS payment_allocations_created_at_idx ON public.payment_allocations(created_at);

-- ----------------------------------------------------------------------------
-- 4. DATABASE-LEVEL INVARIANT TRIGGER
-- Ensure PostgreSQL strictly prevents:
--   1. SUM(allocated_amount) > payment.amount (Cannot over-allocate a payment)
--   2. SUM(allocated_amount) > invoice.total - invoice.adjusted_total (Cannot exceed invoice capacity)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_payment_allocation_invariants()
RETURNS TRIGGER AS $$
DECLARE
    v_payment_amount numeric(14, 2);
    v_total_payment_allocated numeric(14, 2);
    v_invoice_total numeric(14, 2);
    v_invoice_adjusted numeric(14, 2);
    v_total_invoice_allocated numeric(14, 2);
BEGIN
    -- Check 1: Payment Capacity
    SELECT amount INTO v_payment_amount FROM public.payments WHERE id = NEW.payment_id;
    IF v_payment_amount IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Payment % does not exist', NEW.payment_id;
    END IF;

    SELECT coalesce(sum(allocated_amount), 0) INTO v_total_payment_allocated
    FROM public.payment_allocations
    WHERE payment_id = NEW.payment_id AND id <> coalesce(NEW.id, 0);

    IF (v_total_payment_allocated + NEW.allocated_amount) > v_payment_amount THEN
        RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_PAYMENT: Total allocated (% ₫ + % ₫) exceeds payment amount (% ₫)',
            v_total_payment_allocated, NEW.allocated_amount, v_payment_amount;
    END IF;

    -- Check 2: Invoice Collectible Capacity
    SELECT total, adjusted_total INTO v_invoice_total, v_invoice_adjusted
    FROM public.invoices WHERE id = NEW.invoice_id;
    IF v_invoice_total IS NULL THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND: Invoice % does not exist', NEW.invoice_id;
    END IF;

    SELECT coalesce(sum(allocated_amount), 0) INTO v_total_invoice_allocated
    FROM public.payment_allocations
    WHERE invoice_id = NEW.invoice_id AND id <> coalesce(NEW.id, 0);

    IF (v_total_invoice_allocated + NEW.allocated_amount) > (v_invoice_total - v_invoice_adjusted) THEN
        RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_INVOICE: Total allocated (% ₫ + % ₫) exceeds invoice collectible amount (% ₫)',
            v_total_invoice_allocated, NEW.allocated_amount, (v_invoice_total - v_invoice_adjusted);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_payment_allocation_invariants ON public.payment_allocations;
CREATE TRIGGER trg_check_payment_allocation_invariants
BEFORE INSERT OR UPDATE ON public.payment_allocations
FOR EACH ROW
EXECUTE FUNCTION public.check_payment_allocation_invariants();

-- ----------------------------------------------------------------------------
-- 5. RBAC & PERMISSIONS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON public.payments TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO billing_app;
GRANT SELECT ON public.payments TO billing_readonly;
GRANT SELECT ON public.payment_allocations TO billing_readonly;

COMMIT;
