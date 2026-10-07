-- ============================================================================
-- BILLING_ONE MIGRATION 05: P1.2.2 PAYMENT IDEMPOTENCY HARDENING & LEAST PRIVILEGE
-- Target: Fix FIND-P1.2.1-02 (Excessive Grants on Idempotency Table)
-- ============================================================================

\set ON_ERROR_STOP on

-- 1. REVOKE EXCESSIVE PRIVILEGES FROM billing_app
-- payment_idempotency_keys must be append-only for the application role.
-- billing_app should never be able to UPDATE or DELETE idempotency records.
-- ----------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.payment_idempotency_keys FROM billing_app;

-- 2. ENSURE EXPLICIT LEAST PRIVILEGE GRANTS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON public.payment_idempotency_keys TO billing_app;
GRANT SELECT ON public.payment_idempotency_keys TO billing_readonly;

-- 3. VERIFICATION BLOCK
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_update boolean;
    v_has_delete boolean;
    v_has_insert boolean;
    v_has_select boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'payment_idempotency_keys'
          AND grantee = 'billing_app'
          AND privilege_type = 'UPDATE'
    ) INTO v_has_update;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'payment_idempotency_keys'
          AND grantee = 'billing_app'
          AND privilege_type = 'DELETE'
    ) INTO v_has_delete;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'payment_idempotency_keys'
          AND grantee = 'billing_app'
          AND privilege_type = 'INSERT'
    ) INTO v_has_insert;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'payment_idempotency_keys'
          AND grantee = 'billing_app'
          AND privilege_type = 'SELECT'
    ) INTO v_has_select;

    IF v_has_update OR v_has_delete THEN
        RAISE EXCEPTION 'MIGRATION 05 FAILED: billing_app still holds UPDATE or DELETE on payment_idempotency_keys';
    END IF;

    IF NOT v_has_insert OR NOT v_has_select THEN
        RAISE EXCEPTION 'MIGRATION 05 FAILED: billing_app missing SELECT or INSERT on payment_idempotency_keys';
    END IF;

    RAISE NOTICE 'MIGRATION 05 (P1.2.2 LEAST PRIVILEGE HARDENING) APPLIED SUCCESSFULLY.';
END $$;
