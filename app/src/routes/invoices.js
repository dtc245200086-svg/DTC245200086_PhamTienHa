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
const { requireAuth, requireRole, requirePermission } = require('./auth');
const { invoicesCreated } = require('../metrics');
const { recordAudit } = require('../audit');

const STATUSES = new Set(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']);
const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

function invoiceInput(body) {
  requireObject(body);
  const customerId = parseId(body.customer_id, 'customer_id');
  const dueDate = requireDate(body.due_date, 'due_date');
  const taxRate = requireDecimal(body.tax_rate === undefined ? '0' : String(body.tax_rate), 'tax_rate', TAX_RATE);
  const items = validateItems(body.items === undefined ? [] : body.items);
  if (items.length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'An invoice may contain at most 100 items.');

  const eInvoiceCode = requireText(body.e_invoice_code || body.einvoice_code, 'e_invoice_code', 64, { optional: true });
  const paymentTermId = body.payment_term_id ? parseId(body.payment_term_id, 'payment_term_id') : null;
  const notes = requireText(body.notes, 'notes', 2000, { optional: true });

  return { customerId, dueDate, taxRate, items, eInvoiceCode, paymentTermId, notes };
}

async function insertItems(client, invoiceId, items) {
  for (const item of items) {
    const sku = item.sku || null;
    const unit = item.unit || 'Đơn vị';
    const discount = item.discount_percent || '0';
    await client.query(
      `INSERT INTO public.invoice_items (invoice_id, sku, description, unit, quantity, unit_price, discount_percent, line_total)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, round($5::numeric * $6::numeric * (1 - $7::numeric / 100), 2))`,
      [invoiceId, sku, item.description, unit, item.quantity, item.unit_price, discount]
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
       invoice.issue_date, invoice.due_date, invoice.e_invoice_code, invoice.e_invoice_code AS einvoice_code, invoice.notes`,
    [invoiceId]
  );
  return result.rows[0];
}

async function loadInvoice(pool, invoiceId) {
  const invoiceResult = await pool.query(
    `SELECT invoice.id, invoice.invoice_no, invoice.e_invoice_code, invoice.e_invoice_code AS einvoice_code, invoice.customer_id, customer.name AS customer_name,
       customer.tax_code AS customer_tax_code, customer.email AS customer_email, customer.phone AS customer_phone,
       customer.address AS customer_address,
       invoice.status, invoice.currency, invoice.issue_date, invoice.due_date,
       invoice.tax_rate::text, invoice.subtotal::text, invoice.tax_amount::text,
       invoice.total::text, invoice.paid_total::text, invoice.adjusted_total::text,
       (invoice.total - invoice.paid_total - invoice.adjusted_total)::numeric(14, 2)::text AS outstanding,
       invoice.cancel_reason, invoice.notes, invoice.payment_term_id,
       pt.name AS payment_term_name,
       invoice.created_by, invoice.created_at
     FROM public.invoices AS invoice
     JOIN public.customers AS customer ON customer.id = invoice.customer_id
     LEFT JOIN public.payment_terms AS pt ON pt.id = invoice.payment_term_id
     WHERE invoice.id = $1`,
    [invoiceId]
  );
  if (!invoiceResult.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
  const [items, payments, adjustments] = await Promise.all([
    pool.query(
      `SELECT id, sku, description, unit, quantity::text, unit_price::text, discount_percent::text, line_total::text
       FROM public.invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [invoiceId]
    ),
    pool.query(
      `SELECT id, amount::text, method, paid_at, reference, bank_name, bank_account, recorded_by, created_at
       FROM public.payments WHERE invoice_id = $1 ORDER BY id`,
      [invoiceId]
    ),
    pool.query(
      `SELECT id, credit_note_no, adjustment_type, total_amount::text, reason, status, created_at
       FROM public.invoice_adjustments WHERE original_invoice_id = $1 ORDER BY id`,
      [invoiceId]
    )
  ]);
  return {
    ...invoiceResult.rows[0],
    items: items.rows,
    payments: payments.rows,
    adjustments: adjustments.rows
  };
}

function mapInvoiceWriteError(error) {
  if (error.code === '23503') throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
  if (error.code === '23514') throw new AppError(400, 'VALIDATION_ERROR', 'Invoice values violate a database constraint.');
  if (error.code === '23505') throw new AppError(409, 'INVOICE_NUMBER_CONFLICT', 'Invoice number already exists.');
  throw error;
}

function invoiceRouter(pool) {
  const router = express.Router();

  // GET /api/invoices
  router.get('/', requireAuth, asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    if (status && !STATUSES.has(status)) throw new AppError(400, 'INVALID_STATUS', 'status is not valid.');
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT invoice.id, invoice.invoice_no, invoice.e_invoice_code, invoice.e_invoice_code AS einvoice_code, invoice.customer_id,
           customer.name AS customer_name, invoice.status, invoice.currency,
           invoice.issue_date, invoice.due_date, invoice.total::text,
           invoice.paid_total::text, invoice.adjusted_total::text, (invoice.total - invoice.paid_total - invoice.adjusted_total)::numeric(14, 2)::text AS outstanding,
           invoice.created_at
         FROM public.invoices AS invoice
         JOIN public.customers AS customer ON customer.id = invoice.customer_id
         WHERE ($1::text IS NULL OR invoice.status = $1)
           AND ($2::bigint IS NULL OR invoice.customer_id = $2)
           AND ($3::date IS NULL OR invoice.issue_date >= $3)
           AND ($4::date IS NULL OR invoice.issue_date <= $4)
           AND ($5::text IS NULL OR invoice.invoice_no ILIKE $5 OR invoice.e_invoice_code ILIKE $5 OR customer.name ILIKE $5)
         ORDER BY invoice.created_at DESC, invoice.id DESC LIMIT $6 OFFSET $7`,
        [status, customerId, from, to, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.invoices AS invoice
         JOIN public.customers AS customer ON customer.id = invoice.customer_id
         WHERE ($1::text IS NULL OR invoice.status = $1)
           AND ($2::bigint IS NULL OR invoice.customer_id = $2)
           AND ($3::date IS NULL OR invoice.issue_date >= $3)
           AND ($4::date IS NULL OR invoice.issue_date <= $4)
           AND ($5::text IS NULL OR invoice.invoice_no ILIKE $5 OR invoice.e_invoice_code ILIKE $5 OR customer.name ILIKE $5)`,
        [status, customerId, from, to, pattern]
      )
    ]);
    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  // POST /api/invoices
  router.post('/', requireAuth, requirePermission('invoice.create'), asyncRoute(async (req, res) => {
    const input = invoiceInput(req.body);
    try {
      const invoiceId = await inTransaction(async (client) => {
        const customer = await client.query('SELECT id, payment_term_id FROM public.customers WHERE id = $1', [input.customerId]);
        if (!customer.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');

        const paymentTermId = input.paymentTermId || customer.rows[0].payment_term_id;

        const inserted = await client.query(
          `INSERT INTO public.invoices (customer_id, due_date, tax_rate, e_invoice_code, payment_term_id, notes, created_by)
           VALUES ($1, $2, $3::numeric, $4, $5, $6, $7) RETURNING id`,
          [input.customerId, input.dueDate, input.taxRate, input.eInvoiceCode, paymentTermId, input.notes, req.user.id]
        );
        const id = inserted.rows[0].id;
        await insertItems(client, id, input.items);
        await recalculateTotals(client, id);
        return id;
      });

      const invoice = await loadInvoice(pool, invoiceId);
      invoicesCreated.inc();
      writeLog('info', 'invoice.created', { request_id: req.requestId, user: req.user.username, invoice_id: invoiceId });

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'invoices',
        action: 'INVOICE_CREATED',
        targetRef: `DRAFT-${invoiceId}`,
        severity: 'INFO',
        summary: `Tạo dự thảo hóa đơn DRAFT-${invoiceId} cho khách hàng ${invoice.customer_name} (Tổng: ${invoice.total} ₫)`,
        metadata: { invoice_id: invoiceId, total: invoice.total }
      });

      res.status(201).json({ invoice });
    } catch (error) {
      mapInvoiceWriteError(error);
    }
  }));

  // GET /api/invoices/:id
  router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
    res.json({ invoice: await loadInvoice(pool, parseId(req.params.id)) });
  }));

  // PUT /api/invoices/:id
  router.put('/:id', requireAuth, requirePermission('invoice.update'), asyncRoute(async (req, res) => {
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
          `UPDATE public.invoices
           SET customer_id = $2, due_date = $3, tax_rate = $4::numeric,
               e_invoice_code = $5, payment_term_id = $6, notes = $7
           WHERE id = $1`,
          [invoiceId, input.customerId, input.dueDate, input.taxRate, input.eInvoiceCode, input.paymentTermId, input.notes]
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

  // POST /api/invoices/:id/issue
  router.post('/:id/issue', requireAuth, requirePermission('invoice.issue'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const issued = await inTransaction(async (client) => {
      const locked = await client.query(
        'SELECT id, status, due_date, total::text, e_invoice_code FROM public.invoices WHERE id = $1 FOR UPDATE',
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
      const invoiceNo = number.rows[0].invoice_no;
      const seqVal = invoiceNo.split('-')[2] || '000001';
      const eInvoiceCode = invoice.e_invoice_code || `1C25TND-${seqVal}`;

      const result = await client.query(
        `UPDATE public.invoices
         SET invoice_no = $2, e_invoice_code = $3, status = 'ISSUED', issue_date = current_date
         WHERE id = $1
         RETURNING id, invoice_no, e_invoice_code, status, issue_date, due_date,
           subtotal::text, tax_amount::text, total::text, paid_total::text`,
        [invoiceId, invoiceNo, eInvoiceCode]
      );
      return result.rows[0];
    });

    writeLog('info', 'invoice.issued', {
      request_id: req.requestId,
      user: req.user.username,
      invoice_id: invoiceId,
      invoice_no: issued.invoice_no
    });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'invoices',
      action: 'INVOICE_ISSUED',
      targetRef: issued.invoice_no,
      severity: 'INFO',
      summary: `Phát hành hóa đơn ${issued.invoice_no} (Mã mô phỏng nội bộ: ${issued.e_invoice_code}) - Tổng: ${issued.total} ₫`,
      metadata: issued
    });

    res.json({ invoice: await loadInvoice(pool, invoiceId) });
  }));

  // POST /api/invoices/:id/cancel
  router.post('/:id/cancel', requireAuth, requirePermission('invoice.cancel'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    requireObject(req.body);
    const reason = requireText(req.body.reason, 'reason', 2000);
    const cancelled = await inTransaction(async (client) => {
      const locked = await client.query(
        'SELECT id, invoice_no, status, paid_total::text, adjusted_total::text FROM public.invoices WHERE id = $1 FOR UPDATE',
        [invoiceId]
      );
      if (!locked.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const invoice = locked.rows[0];
      if (!['DRAFT', 'ISSUED'].includes(invoice.status)) {
        throw new AppError(409, 'INVOICE_CANNOT_BE_CANCELLED', 'Only DRAFT or unpaid ISSUED invoices can be cancelled.');
      }
      const unsettled = await client.query('SELECT ($1::numeric = 0 AND $2::numeric = 0) AS is_unsettled', [invoice.paid_total, invoice.adjusted_total || '0']);
      if (!unsettled.rows[0].is_unsettled) throw new AppError(409, 'INVOICE_HAS_PAYMENTS', 'An invoice with payments or adjustments cannot be cancelled.');
      const updated = await client.query(
        `UPDATE public.invoices SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1 RETURNING id, invoice_no, cancel_reason`,
        [invoiceId, reason]
      );
      return updated.rows[0];
    });

    writeLog('info', 'invoice.cancelled', { request_id: req.requestId, user: req.user.username, invoice_id: invoiceId });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'invoices',
      action: 'INVOICE_CANCELLED',
      targetRef: cancelled.invoice_no || `DRAFT-${invoiceId}`,
      severity: 'CRITICAL',
      summary: `Hủy hóa đơn ${cancelled.invoice_no || `DRAFT-${invoiceId}`}. Lý do: ${reason}`,
      metadata: { invoice_id: invoiceId, reason }
    });

    res.json({ invoice: await loadInvoice(pool, invoiceId) });
  }));

  return router;
}

module.exports = { invoiceRouter };