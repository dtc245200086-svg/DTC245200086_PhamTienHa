-- 12_ux_pagination_search_indexes_down.sql
DROP INDEX IF EXISTS public.idx_customers_code;
DROP INDEX IF EXISTS public.idx_customers_tax_code;
DROP INDEX IF EXISTS public.idx_payments_paid_at;
DROP INDEX IF EXISTS public.idx_payments_reference;
DROP INDEX IF EXISTS public.idx_invoices_issue_date;
DROP INDEX IF EXISTS public.idx_bank_tx_date;
DROP INDEX IF EXISTS public.idx_bank_tx_ref;
DROP INDEX IF EXISTS public.idx_products_sku;
DROP INDEX IF EXISTS public.idx_audit_timestamp;
