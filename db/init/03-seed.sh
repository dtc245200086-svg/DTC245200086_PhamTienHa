#!/usr/bin/env bash
set -Eeuo pipefail

: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
: "${STAFF_PASSWORD:?STAFF_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=admin_password="$ADMIN_PASSWORD" \
  --set=staff_password="$STAFF_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.users (username, password_hash, role)
VALUES
    ('admin', crypt(:'admin_password', gen_salt('bf', 12)), 'admin'),
    ('staff', crypt(:'staff_password', gen_salt('bf', 12)), 'staff');

INSERT INTO public.customers (name, email, phone, address, tax_code)
VALUES
    ('Northwind Office Supplies', 'northwind@example.test', '0900000001', 'Ha Noi', '0100000001'),
    ('Lotus Trading', 'lotus@example.test', '0900000002', 'Da Nang', '0100000002'),
    ('Mekong Services', 'mekong@example.test', '0900000003', 'Can Tho', '0100000003'),
    ('Red River Retail', 'redriver@example.test', '0900000004', 'Hai Phong', '0100000004'),
    ('Central Parts', 'central@example.test', '0900000005', 'Hue', '0100000005');

WITH raw_seed AS (
    SELECT
        n,
        CASE n % 4
            WHEN 0 THEN 'PAID'
            WHEN 1 THEN 'PARTIALLY_PAID'
            WHEN 2 THEN 'ISSUED'
            ELSE 'DRAFT'
        END AS status,
        CASE WHEN n % 4 = 3 THEN NULL::date ELSE current_date - (n % 90) END AS issue_date,
        (current_date - (n % 90)) + 30 AS due_date,
        (100000 + n * 500)::numeric(14, 2) AS subtotal,
        0.10::numeric(5, 4) AS tax_rate,
        ((n % 5) + 1)::bigint AS customer_id
    FROM generate_series(1, 200) AS n
), amounts AS (
    SELECT *, round(subtotal * tax_rate, 2)::numeric(14, 2) AS tax_amount
    FROM raw_seed
), totals AS (
    SELECT *, (subtotal + tax_amount)::numeric(14, 2) AS total
    FROM amounts
), seed_rows AS (
    SELECT *,
        CASE WHEN status = 'DRAFT' THEN NULL
             ELSE format('INV-%s-%s', to_char(issue_date, 'YYYY'), lpad(nextval('public.invoice_no_seq')::text, 6, '0'))
        END AS invoice_no,
        CASE WHEN status = 'PAID' THEN total
             WHEN status = 'PARTIALLY_PAID' THEN round(total / 2, 2)::numeric(14, 2)
             ELSE 0::numeric(14, 2)
        END AS paid_total
    FROM totals
), inserted AS (
    INSERT INTO public.invoices (
        invoice_no, customer_id, status, issue_date, due_date, tax_rate,
        subtotal, tax_amount, total, paid_total, created_by,
        created_at
    )
    SELECT
        invoice_no, customer_id, status, issue_date, due_date, tax_rate,
        subtotal, tax_amount, total, paid_total,
        (SELECT id FROM public.users WHERE username = 'admin'),
        now() - (n || ' days')::interval
    FROM seed_rows
    RETURNING id, status, subtotal, paid_total, created_by
), inserted_items AS (
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
    SELECT id, 'Seed item ' || id, 1, subtotal, subtotal
    FROM inserted
    RETURNING invoice_id
)
INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, recorded_by)
SELECT i.id, i.paid_total, 'BANK_TRANSFER', current_date, 'SEED-' || i.id, i.created_by
FROM inserted AS i
JOIN inserted_items AS item ON item.invoice_id = i.id
WHERE i.paid_total > 0;
SQL