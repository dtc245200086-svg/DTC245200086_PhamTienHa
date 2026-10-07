const express = require('express');
const { asyncRoute } = require('../errors');
const { requireAuth } = require('./auth');

function dashboardRouter(pool) {
  const router = express.Router();
  router.get('/dashboard/summary', requireAuth, asyncRoute(async (req, res) => {
    const [totals, statuses, overdue] = await Promise.all([
      pool.query(
        `SELECT
           coalesce((SELECT sum(amount) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD')), 0)::numeric(14, 2)::text AS collected,
           coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
             WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)::numeric(14, 2)::text AS outstanding`
      ),
      pool.query('SELECT status, count(*)::text AS count FROM public.invoices GROUP BY status'),
      pool.query(
        `SELECT count(*)::text AS count FROM public.invoices
         WHERE due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0`
      )
    ]);
    const byStatus = Object.fromEntries(statuses.rows.map((row) => [row.status, row.count]));
    res.json({
      collected: totals.rows[0].collected,
      outstanding: totals.rows[0].outstanding,
      by_status: byStatus,
      overdue_count: overdue.rows[0].count
    });
  }));
  return router;
}

module.exports = { dashboardRouter };