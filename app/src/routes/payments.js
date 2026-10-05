const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth } = require('./auth');

const METHODS = new Set(['CASH', 'BANK_TRANSFER', 'CARD']);

function paymentsRouter(pool) {
  const router = express.Router();

  router.post('/invoices/:id/payments', requireAuth, asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    requireObject(req.body);
    const amount = requireDecimal(req.body.amount, 'amount');
    const method = requireText(req.body.method, 'method', 24);
    const paidAt = requireDate(req.body.paid_at, 'paid_at');
    const reference = requireText(req.body.reference, 'reference', 120, { optional: true });
    if (!METHODS.has(method)) throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'method must be CASH, BANK_TRANSFER, or CARD.');

    const result = await inTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id, status, total::text, paid_total::text
         FROM public.invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );
      if (!locked.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const invoice = locked.rows[0];
      if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) {
        throw new AppError(409, 'INVOICE_NOT_PAYABLE', 'Only ISSUED or PARTIALLY_PAID invoices can receive payments.');
      }

      const validAmount = await client.query(
        `SELECT $1::numeric > 0 AS positive,
           $1::numeric <= ($2::numeric - $3::numeric) AS within_outstanding`,
        [amount, invoice.total, invoice.paid_total]
      );
      if (!validAmount.rows[0].positive) throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Payment amount must be greater than zero.');
      if (!validAmount.rows[0].within_outstanding) {
        throw new AppError(409, 'PAYMENT_EXCEEDS_OUTSTANDING', 'Payment cannot exceed the outstanding balance.');
      }

      const payment = await client.query(
        `INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, recorded_by)
         VALUES ($1, $2::numeric, $3, $4, $5, $6)
         RETURNING id, invoice_id, amount::text, method, paid_at, reference, recorded_by, created_at`,
        [invoiceId, amount, method, paidAt, reference, req.user.id]
      );
      const updated = await client.query(
        `UPDATE public.invoices
         SET paid_total = paid_total + $2::numeric,
             status = CASE WHEN paid_total + $2::numeric = total THEN 'PAID' ELSE 'PARTIALLY_PAID' END
         WHERE id = $1
         RETURNING id, invoice_no, status, total::text, paid_total::text`,
        [invoiceId, amount]
      );
      return { payment: payment.rows[0], invoice: updated.rows[0] };
    });

    writeLog('info', 'payment.recorded', {
      request_id: req.requestId,
      user: req.user.username,
      invoice_id: invoiceId,
      payment_id: result.payment.id
    });
    res.status(201).json(result);
  }));

  router.get('/payments', requireAuth, asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const invoiceId = req.query.invoice_id ? parseId(req.query.invoice_id, 'invoice_id') : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT payment.id, payment.invoice_id, invoice.invoice_no, payment.amount::text,
           payment.method, payment.paid_at, payment.reference, payment.recorded_by, payment.created_at
         FROM public.payments AS payment
         JOIN public.invoices AS invoice ON invoice.id = payment.invoice_id
         WHERE ($1::bigint IS NULL OR payment.invoice_id = $1)
           AND ($2::date IS NULL OR payment.paid_at >= $2)
           AND ($3::date IS NULL OR payment.paid_at <= $3)
         ORDER BY payment.paid_at DESC, payment.id DESC LIMIT $4 OFFSET $5`,
        [invoiceId, from, to, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.payments AS payment
         WHERE ($1::bigint IS NULL OR payment.invoice_id = $1)
           AND ($2::date IS NULL OR payment.paid_at >= $2)
           AND ($3::date IS NULL OR payment.paid_at <= $3)`,
        [invoiceId, from, to]
      )
    ]);
    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  return router;
}

module.exports = { paymentsRouter };