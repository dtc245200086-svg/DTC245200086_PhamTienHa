-- ============================================================================
-- BILLING_ONE P1.4 OVERDUE LIFECYCLE MIGRATION
-- File: db/migrations/07_p1_4_overdue_lifecycle.sql
-- Scope: Candidate A Only — Automated Overdue Invoice Lifecycle Engine
-- Transaction-safe, Idempotent, Rerun-safe
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXTEND INVOICES STATUS CONSTRAINT TO INCLUDE 'OVERDUE'
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'));

-- ----------------------------------------------------------------------------
-- 2. UPDATE INVOICE NUMBER INTEGRITY CONSTRAINT TO INCLUDE 'OVERDUE'
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_issued_have_number;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_issued_have_number
    CHECK (status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID') OR invoice_no IS NOT NULL);

-- ----------------------------------------------------------------------------
-- 3. CREATE OPTIMIZED PARTIAL INDEX FOR SCHEDULER OVERDUE SCAN
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_overdue_scan
    ON public.invoices (due_date)
    WHERE status IN ('ISSUED', 'PARTIALLY_PAID');

-- ----------------------------------------------------------------------------
-- 4. CREATE OPTIMIZED PARTIAL INDEX FOR CUSTOMER OVERDUE FILTERING
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_customer_overdue
    ON public.invoices (customer_id)
    WHERE status = 'OVERDUE';

COMMIT;
