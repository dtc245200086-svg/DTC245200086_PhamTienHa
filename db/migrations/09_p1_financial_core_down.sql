-- ============================================================================
-- BILLING_ONE MIGRATION 09 (DOWN): P1 FINANCIAL CORE
-- ============================================================================

\set ON_ERROR_STOP on

DROP TRIGGER IF EXISTS trg_calculate_invoice_item_totals ON public.invoice_items;
DROP FUNCTION IF EXISTS public.calculate_invoice_item_totals();

ALTER TABLE public.invoice_items
    DROP CONSTRAINT IF EXISTS invoice_items_total_amount_check,
    DROP CONSTRAINT IF EXISTS invoice_items_vat_amount_check,
    DROP COLUMN IF EXISTS total_amount,
    DROP COLUMN IF EXISTS vat_amount;
