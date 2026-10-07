const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { parseId, parsePage } = require('../validation');
const { requireAuth } = require('./auth');

function refundsRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/refunds (and /api/refund-payables)
  router.get('/', asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const invoiceId = req.query.invoice_id ? parseId(req.query.invoice_id, 'invoice_id') : null;
    const status = req.query.status ? String(req.query.status) : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT r.id, r.refund_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
                r.invoice_id, i.invoice_no,
                r.adjustment_id, a.credit_note_no,
                r.amount::text, r.currency, r.status, r.reason, r.notes,
                r.created_by, u1.username AS created_by_username,
                r.approved_by, u2.username AS approved_by_username,
                r.created_at, r.approved_at, r.paid_payment_id, r.metadata
         FROM public.refund_payables r
         JOIN public.customers c ON c.id = r.customer_id
         JOIN public.invoices i ON i.id = r.invoice_id
         JOIN public.invoice_adjustments a ON a.id = r.adjustment_id
         LEFT JOIN public.users u1 ON u1.id = r.created_by
         LEFT JOIN public.users u2 ON u2.id = r.approved_by
         WHERE ($1::bigint IS NULL OR r.customer_id = $1)
           AND ($2::bigint IS NULL OR r.invoice_id = $2)
           AND ($3::text IS NULL OR r.status = $3)
         ORDER BY r.id DESC LIMIT $4 OFFSET $5`,
        [customerId, invoiceId, status, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.refund_payables r
         WHERE ($1::bigint IS NULL OR r.customer_id = $1)
           AND ($2::bigint IS NULL OR r.invoice_id = $2)
           AND ($3::text IS NULL OR r.status = $3)`,
        [customerId, invoiceId, status]
      )
    ]);

    res.json({ items: items.rows, refunds: items.rows, total: count.rows[0].total, page, limit });
  }));

  // GET /api/refunds/:id
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT r.id, r.refund_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
              r.invoice_id, i.invoice_no,
              r.adjustment_id, a.credit_note_no,
              r.amount::text, r.currency, r.status, r.reason, r.notes,
              r.created_by, u1.username AS created_by_username,
              r.approved_by, u2.username AS approved_by_username,
              r.created_at, r.approved_at, r.paid_payment_id, r.metadata
       FROM public.refund_payables r
       JOIN public.customers c ON c.id = r.customer_id
       JOIN public.invoices i ON i.id = r.invoice_id
       JOIN public.invoice_adjustments a ON a.id = r.adjustment_id
       LEFT JOIN public.users u1 ON u1.id = r.created_by
       LEFT JOIN public.users u2 ON u2.id = r.approved_by
       WHERE r.id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund payable was not found.');
    res.json({ refund: result.rows[0] });
  }));

  return router;
}

module.exports = { refundsRouter };
