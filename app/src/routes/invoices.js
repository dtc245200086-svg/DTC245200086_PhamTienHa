const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');
const { inTransaction } = require('../db');
const {
  parseId,
  parsePage,
  requireDate,
  requireDecimal,
  requireObject,
  requireText,
  validateItems
} = require('../validation');
const { requireAuth, requireRole } = require('./auth');

const STATUSES = new Set(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']);
const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

function invoiceInput(body) {
  requireObject(body);
  const customerId = parseId(body.customer_id, 'customer_id');
  const dueDate = requireDate(body.due_date, 'due_date');
  const taxRate = requireDecimal(body.tax_rate === undefined ? '0' : body.tax_rate, 'tax_rate', TAX_RATE);
  const items = validateItems(body.items === undefined ? [] : body.items);
  if (items.length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'An invoice may contain at most 100 items.');
  return { customerId, dueDate, taxRate, items };
}

async function insertItems(client, invoiceId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
       VALUES ($1, $2, $3::numeric, $4::numeric, round($3::numeric * $4::numeric, 2))`,
      [invoiceId, item.description, item.quantity, item.unit_price]
    );
  }
}

async function recalculateTotals(client, invoiceId) {
  const result = await client.query(
    `UPDATE public.invoices AS invoice
     SET subtotal = totals.subtotal,
         tax_amount = round(totals.subtotal * invoice.tax_rate, 2),
         total = totals.subtotal + round(totals.subtotal * invoice.tax_rate, 2)
     FROM (
       SELECT coalesce(sum(line_total), 0)::numeric(14, 2) AS subtotal
       FROM public.invoice_items WHERE invoice_id = $1
     ) AS totals
     WHERE invoice.id = $1
     RETURNING invoice.id, invoice.invoice_no, invoice.status,
       invoice.subtotal::text, invoice.tax_amount::text, invoice.total::text,
       invoice.paid_total::text, invoice.tax_rate::text, invoice.currency,
       invoice.issue_date, invoice.due_date`,
    [invoiceId]
  );
  return result.rows[0];
}

async function loadInvoice(pool, invoiceId) {
  const invoiceResult = await pool.query(
    `SELECT invoice.id, invoice.invoice_no, invoice.customer_id, customer.name AS customer_name,
       invoice.status, invoice.currency, invoice.issue_date, invoice.due_date,
       invoice.tax_rate::text, invoice.subtotal::text, invoice.tax_amount::text,
      invoice.total::text, invoice.paid_total::text,
      (invoice.total - invoice.paid_total)::numeric(14, 2)::text AS outstanding,
      invoice.cancel_reason,
       invoice.created_by, invoice.created_at
     FROM public.invoices AS invoice
     JOIN public.customers AS customer ON customer.id = invoice.customer_id
     WHERE invoice.id = $1`,
    [invoiceId]
  );
  if (!invoiceResult.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
  const [items, payments] = await Promise.all([
    pool.query(
      `SELECT id, description, quantity::text, unit_price::text, line_total::text
       FROM public.invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [invoiceId]
    ),
    pool.query(
      `SELECT id, amount::text, method, paid_at, reference, recorded_by, created_at
       FROM public.payments WHERE invoice_id = $1 ORDER BY id`,
      [invoiceId]
    )
  ]);
  return { ...invoiceResult.rows[0], items: items.rows, payments: payments.rows };
}

function mapInvoiceWriteError(error) {
  if (error.code === '23503') throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
  if (error.code === '23514') throw new AppError(400, 'VALIDATION_ERROR', 'Invoice values violate a database constraint.');
  if (error.code === '23505') throw new AppError(409, 'INVOICE_NUMBER_CONFLICT', 'Invoice number already exists.');
  throw error;
}

function invoiceRouter(pool) {
  const router = express.Router();

  router.get('/', requireAuth, asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    if (status && !STATUSES.has(status)) throw new AppError(400, 'INVALID_STATUS', 'status is not valid.');
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT invoice.id, invoice.invoice_no, invoice.customer_id,
           customer.name AS customer_name, invoice.status, invoice.currency,
           invoice.issue_date, invoice.due_date, invoice.total::text,
           invoice.paid_total::text, invoice.created_at
         FROM public.invoices AS invoice
         JOIN public.customers AS customer ON customer.id = invoice.customer_id
         WHERE ($1::text IS NULL OR invoice.status = $1)
           AND ($2::bigint IS NULL OR invoice.customer_id = $2)
           AND ($3::date IS NULL OR invoice.issue_date >= $3)
           AND ($4::date IS NULL OR invoice.issue_date <= $4)
         ORDER BY invoice.created_at DESC, invoice.id DESC LIMIT $5 OFFSET $6`,
        [status, customerId, from, to, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.invoices AS invoice
         WHERE ($1::text IS NULL OR invoice.status = $1)
           AND ($2::bigint IS NULL OR invoice.customer_id = $2)
           AND ($3::date IS NULL OR invoice.issue_date >= $3)
           AND ($4::date IS NULL OR invoice.issue_date <= $4)`,
        [status, customerId, from, to]
      )
    ]);
    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  router.post('/', requireAuth, asyncRoute(async (req, res) => {
    const input = invoiceInput(req.body);
    try {
      const invoiceId = await inTransaction(async (client) => {
        const customer = await client.query('SELECT id FROM public.customers WHERE id = $1', [input.customerId]);
        if (!customer.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
        const inserted = await client.query(
          `INSERT INTO public.invoices (customer_id, due_date, tax_rate, created_by)
           VALUES ($1, $2, $3::numeric, $4) RETURNING id`,
          [input.customerId, input.dueDate, input.taxRate, req.user.id]
        );
        const id = inserted.rows[0].id;
        await insertItems(client, id, input.items);
        await recalculateTotals(client, id);
        return id;
      });
      const invoice = await loadInvoice(pool, invoiceId);
      writeLog('info', 'invoice.created', { request_id: req.requestId, user: req.user.username, invoice_id: invoiceId });
      res.status(201).json({ invoice });
    } catch (error) {
      mapInvoiceWriteError(error);
    }
  }));

  router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
    res.json({ invoice: await loadInvoice(pool, parseId(req.params.id)) });
  }));

  router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const input = invoiceInput(req.body);
    try {
      await inTransaction(async (client) => {
        const current = await client.query('SELECT id, status FROM public.invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
        if (!current.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
        if (current.rows[0].status !== 'DRAFT') {
          throw new AppError(409, 'INVOICE_NOT_DRAFT', 'Only DRAFT invoices can be changed.');
        }
        const customer = await client.query('SELECT id FROM public.customers WHERE id = $1', [input.customerId]);
        if (!customer.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
        await client.query(
          'UPDATE public.invoices SET customer_id = $2, due_date = $3, tax_rate = $4::numeric WHERE id = $1',
          [invoiceId, input.customerId, input.dueDate, input.taxRate]
        );
        await client.query('DELETE FROM public.invoice_items WHERE invoice_id = $1', [invoiceId]);
        await insertItems(client, invoiceId, input.items);
        await recalculateTotals(client, invoiceId);
      });
      res.json({ invoice: await loadInvoice(pool, invoiceId) });
    } catch (error) {
      mapInvoiceWriteError(error);
    }
  }));

  router.post('/:id/issue', requireAuth, asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const issued = await inTransaction(async (client) => {
      const locked = await client.query(
        'SELECT id, status, due_date, total::text FROM public.invoices WHERE id = $1 FOR UPDATE',
        [invoiceId]
      );
      if (!locked.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const invoice = locked.rows[0];
      if (invoice.status !== 'DRAFT') throw new AppError(409, 'INVOICE_NOT_DRAFT', 'Only DRAFT invoices can be issued.');

      const itemCount = await client.query(
        'SELECT count(*)::integer AS count FROM public.invoice_items WHERE invoice_id = $1',
        [invoiceId]
      );
      if (itemCount.rows[0].count < 1) throw new AppError(409, 'INVOICE_REQUIRES_ITEM', 'An invoice needs at least one item before issue.');

      const eligible = await client.query(
        `SELECT $1::numeric > 0 AS positive_total,
           ($2::date IS NULL OR $2::date >= current_date) AS valid_due_date`,
        [invoice.total, invoice.due_date]
      );
      if (!eligible.rows[0].positive_total) throw new AppError(409, 'INVOICE_TOTAL_MUST_BE_POSITIVE', 'Invoice total must be greater than zero.');
      if (!eligible.rows[0].valid_due_date) throw new AppError(409, 'INVOICE_DUE_DATE_INVALID', 'due_date must not be before issue_date.');

      const number = await client.query(
        `SELECT format('INV-%s-%s', to_char(current_date, 'YYYY'),
           lpad(nextval('public.invoice_no_seq')::text, 6, '0')) AS invoice_no`
      );
      const result = await client.query(
        `UPDATE public.invoices
         SET invoice_no = $2, status = 'ISSUED', issue_date = current_date
         WHERE id = $1
         RETURNING id, invoice_no, status, issue_date, due_date,
           subtotal::text, tax_amount::text, total::text, paid_total::text`,
        [invoiceId, number.rows[0].invoice_no]
      );
      return result.rows[0];
    });
    writeLog('info', 'invoice.issued', {
      request_id: req.requestId,
      user: req.user.username,
      invoice_id: invoiceId,
      invoice_no: issued.invoice_no
    });
    res.json({ invoice: await loadInvoice(pool, invoiceId) });
  }));

  router.post('/:id/cancel', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    requireObject(req.body);
    const reason = requireText(req.body.reason, 'reason', 2000);
    await inTransaction(async (client) => {
      const locked = await client.query(
        'SELECT id, status, paid_total::text FROM public.invoices WHERE id = $1 FOR UPDATE',
        [invoiceId]
      );
      if (!locked.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const invoice = locked.rows[0];
      if (!['DRAFT', 'ISSUED'].includes(invoice.status)) {
        throw new AppError(409, 'INVOICE_CANNOT_BE_CANCELLED', 'Only DRAFT or unpaid ISSUED invoices can be cancelled.');
      }
      const unpaid = await client.query('SELECT $1::numeric = 0 AS is_unpaid', [invoice.paid_total]);
      if (!unpaid.rows[0].is_unpaid) throw new AppError(409, 'INVOICE_HAS_PAYMENTS', 'An invoice with payments cannot be cancelled.');
      await client.query(
        `UPDATE public.invoices SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1`,
        [invoiceId, reason]
      );
    });
    writeLog('info', 'invoice.cancelled', { request_id: req.requestId, user: req.user.username, invoice_id: invoiceId });
    res.json({ invoice: await loadInvoice(pool, invoiceId) });
  }));

  return router;
}

module.exports = { invoiceRouter };