#!/usr/bin/env bash
set -Eeuo pipefail

: "${BILLING_APP_PASSWORD:?BILLING_APP_PASSWORD is required}"
: "${BILLING_READONLY_PASSWORD:?BILLING_READONLY_PASSWORD is required}"
: "${EXPORTER_PASSWORD:?EXPORTER_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=billing_app_password="$BILLING_APP_PASSWORD" \
  --set=billing_readonly_password="$BILLING_READONLY_PASSWORD" \
  --set=exporter_password="$EXPORTER_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE billing_app LOGIN PASSWORD %L', :'billing_app_password') \gexec
SELECT format('CREATE ROLE billing_readonly LOGIN PASSWORD %L', :'billing_readonly_password') \gexec
SELECT format('CREATE ROLE exporter LOGIN PASSWORD %L', :'exporter_password') \gexec

REVOKE CONNECT ON DATABASE billing FROM PUBLIC;
GRANT CONNECT ON DATABASE billing TO postgres, billing_app, billing_readonly, exporter;

GRANT USAGE ON SCHEMA public TO billing_app, billing_readonly, exporter;

GRANT SELECT ON public.users TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO billing_app;
GRANT SELECT, INSERT, UPDATE ON public.invoices TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO billing_app;
GRANT SELECT, INSERT ON public.payments TO billing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sessions TO billing_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO billing_app;

GRANT SELECT ON public.customers, public.invoices,
    public.invoice_items, public.payments TO billing_readonly;

GRANT pg_monitor TO exporter;
SQL