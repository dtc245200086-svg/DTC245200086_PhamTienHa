-- ============================================================================
-- BILLING_ONE P1.1 REFUND LEDGER & FINANCIAL INTEGRITY MIGRATION
-- File: db/migrations/02_p1_refund_ledger.sql
-- Transaction-safe, Idempotent, Rerun-safe, Auditable
-- Addresses: FIND-P0-AUD-01 (Refund Ledger) & P1.1 Domain Evolution
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. SEQUENCE: refund_no_seq for human-readable refund voucher numbers
-- Format: REF-YYYY-XXXX (e.g., REF-2026-0001)
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.refund_no_seq START WITH 1 INCREMENT BY 1;

-- ----------------------------------------------------------------------------
-- 2. TABLE: public.refund_payables
-- Dedicated liability ledger tracking refund obligations resulting from Credit Notes
-- on settled/partially settled invoices without fake payments or cash distortion.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_payables (
    id bigserial PRIMARY KEY,
    refund_no varchar(32) NOT NULL UNIQUE,
    customer_id bigint NOT NULL REFERENCES public.customers(id),
    invoice_id bigint NOT NULL REFERENCES public.invoices(id),
    adjustment_id bigint NOT NULL UNIQUE REFERENCES public.invoice_adjustments(id),
    amount numeric(14, 2) NOT NULL CHECK (amount > 0),
    currency varchar(3) NOT NULL DEFAULT 'VND',
    status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')),
    reason text NOT NULL,
    notes text,
    created_by bigint NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    approved_by bigint REFERENCES public.users(id),
    approved_at timestamptz,
    paid_payment_id bigint REFERENCES public.payments(id),
    metadata jsonb
);

-- ----------------------------------------------------------------------------
-- 3. INDEXES FOR PERFORMANCE AND RECONCILIATION
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS refund_payables_customer_idx ON public.refund_payables(customer_id);
CREATE INDEX IF NOT EXISTS refund_payables_invoice_idx ON public.refund_payables(invoice_id);
CREATE INDEX IF NOT EXISTS refund_payables_status_idx ON public.refund_payables(status);
CREATE INDEX IF NOT EXISTS refund_payables_created_at_idx ON public.refund_payables(created_at);

-- ----------------------------------------------------------------------------
-- 4. RBAC & PERMISSIONS FOR APPLICATION AND READONLY ROLES
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.refund_payables TO billing_app;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.refund_no_seq, public.refund_payables_id_seq TO billing_app;
GRANT SELECT ON public.refund_payables TO billing_readonly;

COMMIT;
