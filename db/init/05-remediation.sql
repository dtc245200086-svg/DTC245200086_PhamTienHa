-- ============================================================================
-- BILLING_ONE REMEDIATION MIGRATION 05: AUDIT CHAIN, PERMISSIONS & INTEGRITY
-- Idempotent, Non-destructive, Backward Compatible
-- ============================================================================

-- 1. EXTEND audit_logs FOR REAL SHA-256 HASH CHAINING
ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS prev_hash varchar(64) DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    ADD COLUMN IF NOT EXISTS hash varchar(64),
    ADD COLUMN IF NOT EXISTS entity_type varchar(64),
    ADD COLUMN IF NOT EXISTS entity_id varchar(64),
    ADD COLUMN IF NOT EXISTS canonical_data text;

-- 2. UPDATE customers_segment_check TO ALLOW EXTENDED ENTERPRISE SEGMENTS
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_segment_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_segment_check 
    CHECK (segment IN ('Enterprise', 'SME', 'FDI', 'Retail', 'VIP'));

-- 3. UPDATE payments_method_check TO CANONICAL PAYMENT METHODS (CASH, BANK_TRANSFER, CARD)
-- Note: Non-cash Credit Notes are managed via invoice_adjustments and refund_payables, not payments.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check 
    CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CARD'));

-- 4. EXTEND bank_transactions FOR UNAPPLIED CASH / OVERPAYMENT
ALTER TABLE public.bank_transactions
    ADD COLUMN IF NOT EXISTS unapplied_amount numeric(14, 2) DEFAULT 0 CHECK (unapplied_amount >= 0);
ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_status_check;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_status_check 
    CHECK (status IN ('UNMATCHED', 'MATCHED', 'PARTIALLY_MATCHED', 'DISCREPANCY'));

-- 5. POPULATE role_permissions FOR GRANULAR RBAC
-- Role 1: admin -> All 19 permissions
-- Role 2: staff -> Operational permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
    'invoice.create', 'invoice.read', 'invoice.update', 'invoice.issue',
    'customer.create', 'customer.read', 'customer.update',
    'payment.create', 'payment.read',
    'adjustment.create',
    'product.manage',
    'report.view'
)
WHERE r.code = 'staff'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Role 3: ROLE_ACCOUNTANT
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
    'invoice.read', 'customer.read', 'payment.create', 'payment.read',
    'reconciliation.manage', 'report.view'
)
WHERE r.code = 'ROLE_ACCOUNTANT'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Role 4: ROLE_BILLING_MANAGER
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
    'invoice.create', 'invoice.read', 'invoice.update', 'invoice.issue', 'invoice.cancel',
    'customer.create', 'customer.read', 'customer.update',
    'adjustment.create', 'adjustment.approve', 'recurring.manage', 'report.view'
)
WHERE r.code = 'ROLE_BILLING_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Role 5: ROLE_AUDITOR
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
    'invoice.read', 'customer.read', 'payment.read', 'report.view', 'audit.view'
)
WHERE r.code = 'ROLE_AUDITOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant permissions to billing_app role (audit_logs is append-only)
GRANT SELECT, INSERT ON public.audit_logs TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permissions TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO billing_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO billing_readonly;
REVOKE ALL ON public.users FROM billing_readonly;
