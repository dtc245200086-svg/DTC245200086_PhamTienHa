-- 12_ux_pagination_search_indexes.sql
-- Performance indexes for server-side search, filtering, and pagination in Billing_One

CREATE INDEX IF NOT EXISTS idx_customers_code ON public.customers(code);
CREATE INDEX IF NOT EXISTS idx_customers_tax_code ON public.customers(tax_code);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON public.payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON public.payments(reference);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON public.invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON public.bank_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_bank_tx_ref ON public.bank_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON public.audit_logs(timestamp);
