-- ============================================================================
-- BILLING_ONE MIGRATION 09: P1 FINANCIAL CORE
-- Domain: Item-Level Mixed VAT, Payment Terms Hardening, Financial Integrity
-- ============================================================================

\set ON_ERROR_STOP on

-- 1. Ensure columns exist on invoice_items for item-level tax persistence
ALTER TABLE public.invoice_items
    ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;

-- 2. Constraints on invoice_items
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_vat_amount_check') THEN
        ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_vat_amount_check CHECK (vat_amount >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_total_amount_check') THEN
        ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_total_amount_check CHECK (total_amount >= 0);
    END IF;
END $$;

-- 3. Backfill historical invoice_items safely
UPDATE public.invoice_items
SET vat_amount = round(line_total * coalesce(vat_rate, 0.10), 2),
    total_amount = line_total + round(line_total * coalesce(vat_rate, 0.10), 2)
WHERE total_amount = 0 AND line_total > 0;

-- 4. Trigger function for deterministic invoice_items financial fields
CREATE OR REPLACE FUNCTION public.calculate_invoice_item_totals()
RETURNS trigger AS $$
BEGIN
    -- Ensure net line_total is exact
    IF NEW.line_total IS NULL OR NEW.line_total = 0 THEN
        NEW.line_total := round(NEW.quantity * NEW.unit_price * (1 - coalesce(NEW.discount_percent, 0) / 100), 2);
    END IF;
    
    -- Ensure vat_rate has valid default
    IF NEW.vat_rate IS NULL THEN
        NEW.vat_rate := 0.1000;
    END IF;

    -- Calculate line VAT amount and gross total amount
    NEW.vat_amount := round(NEW.line_total * NEW.vat_rate, 2);
    NEW.total_amount := NEW.line_total + NEW.vat_amount;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calculate_invoice_item_totals ON public.invoice_items;
CREATE TRIGGER trg_calculate_invoice_item_totals
    BEFORE INSERT OR UPDATE ON public.invoice_items
    FOR EACH ROW
    EXECUTE FUNCTION public.calculate_invoice_item_totals();

-- 5. Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO billing_app;
GRANT SELECT ON public.invoice_items TO billing_readonly;
