import { pool } from '../app/src/db.js';

async function main() {
  const t0 = Date.now();
  const res = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM invoices WHERE status = 'DRAFT') AS draft_invoices,
      (SELECT count(*)::int FROM invoices WHERE status = 'ISSUED') AS issued_invoices,
      (SELECT count(*)::int FROM invoices WHERE status = 'OVERDUE') AS overdue_invoices,
      (SELECT count(*)::int FROM (
        SELECT p.id FROM payments p
        LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
        GROUP BY p.id, p.amount
        HAVING coalesce(sum(pa.allocated_amount), 0) < p.amount
      ) sub) AS unallocated_payments,
      (SELECT count(*)::int FROM bank_transactions WHERE status = 'UNMATCHED') AS unmatched_bank_txs,
      (SELECT count(*)::int FROM invoice_adjustments WHERE status = 'DRAFT') AS pending_adjustments
  `);
  console.log(`Executed in ${Date.now() - t0}ms:`, res.rows[0]);

  // Admin query
  const adminRes = await Promise.all([
    pool.query(`
      SELECT
        CASE
          WHEN upper(role) IN ('ADMIN') THEN 'ADMIN'
          WHEN upper(role) IN ('DIRECTOR', 'ROLE_BILLING_MANAGER') THEN 'DIRECTOR'
          ELSE 'STAFF'
        END AS role,
        count(*)::int AS count
      FROM public.users
      GROUP BY 1
      ORDER BY 1
    `),
    pool.query(`
      SELECT to_char(timestamp, 'YYYY-MM-DD') AS date, count(*)::int AS count
      FROM public.audit_logs
      WHERE timestamp >= current_date - interval '14 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    pool.query(`
      SELECT to_char(date_trunc('month', coalesce(issue_date, created_at::date)), 'YYYY-MM') AS month, count(*)::int AS count
      FROM public.invoices
      WHERE created_at >= current_date - interval '12 months'
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    pool.query(`
      SELECT module, count(*)::int AS count
      FROM public.audit_logs
      GROUP BY module
      ORDER BY count DESC
      LIMIT 6
    `)
  ]);

  console.log('Admin queries successful!');
  console.log('User roles:', adminRes[0].rows);
  console.log('Audit activity days count:', adminRes[1].rows.length);
  console.log('Invoice volume months:', adminRes[2].rows.length);
  console.log('Top modules:', adminRes[3].rows);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
