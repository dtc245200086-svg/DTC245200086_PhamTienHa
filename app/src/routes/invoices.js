const express = require('express');
const crypto = require('node:crypto');
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
const { PaymentService } = require('../services/paymentService');
const CustomerCreditService = require('../services/customerCreditService');
const PaymentTermsService = require('../services/paymentTermsService');
const { extractAndRequireIdempotencyKey } = require('./payments');
const { docTienBangChu, renderInvoiceHtml } = require('../services/documentService');
const { sendCsvResponse } = require('../csv');

const STATUSES = new Set(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED']);
const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

function extractOverrideIdempotencyKey(req) {
  const canonical = req.headers['idempotency-key'];
  const legacy = req.headers['x-idempotency-key'];
  const rawKey = canonical !== undefined ? canonical : legacy;

  if (rawKey === undefined || rawKey === null) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required for manager override.');
  }

  const strKey = String(rawKey);
  if (strKey.length > 255) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key must not exceed 255 characters.');
  }

  const key = strKey.trim();
  if (key.length === 0) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header cannot be empty.');
  }

  return key;
}

function validateOverrideReason(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'OVERRIDE_REASON_REQUIRED', 'Request body must be an object containing override_reason.');
  }
  if (typeof body.override_reason !== 'string') {
    throw new AppError(400, 'OVERRIDE_REASON_REQUIRED', 'override_reason must be a string.');
  }
  const cleanReason = body.override_reason.trim();
  if (cleanReason.length < 10) {
    throw new AppError(400, 'OVERRIDE_REASON_REQUIRED', 'override_reason must be at least 10 characters after trimming.');
  }
  return cleanReason;
}

function computeOverrideRequestFingerprint(invoiceId, overrideReason) {
  const payload = JSON.stringify({
    action: 'INVOICE_ISSUE_OVERRIDE',
    invoice_id: String(invoiceId),
    override_reason: String(overrideReason)
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function validateDraftInvoiceIntegrity(client, invoice) {
  const itemCount = await client.query(
    'SELECT count(*)::integer AS count FROM public.invoice_items WHERE invoice_id = $1',
    [invoice.id]
  );
  if (itemCount.rows[0].count < 1) {
    throw new AppError(409, 'INVOICE_REQUIRES_ITEM', 'An invoice needs at least one item before issue.');
  }

  const eligible = await client.query(
    `SELECT $1::numeric > 0 AS positive_total,
       ($2::date IS NULL OR $2::date >= current_date) AS valid_due_date`,
    [invoice.total, invoice.due_date]
  );
  if (!eligible.rows[0].positive_total) {
    throw new AppError(409, 'INVOICE_TOTAL_MUST_BE_POSITIVE', 'Invoice total must be greater than zero.');
  }
  if (!eligible.rows[0].valid_due_date) {
    throw new AppError(409, 'INVOICE_DUE_DATE_INVALID', 'due_date must not be before issue_date.');
  }
}

async function generateNextInvoiceNumber(client) {
  const number = await client.query(
    `SELECT format('INV-%s-%s', to_char(current_date, 'YYYY'),
       lpad(nextval('public.invoice_no_seq')::text, 6, '0')) AS invoice_no`
  );
  return number.rows[0].invoice_no;
}

function invoiceInput(body) {
  requireObject(body);
  const customerId = parseId(body.customer_id, 'customer_id');
  const dueDate = requireDate(body.due_date, 'due_date', { optional: true });
  const taxRate = requireDecimal(body.tax_rate === undefined ? '0' : String(body.tax_rate), 'tax_rate', TAX_RATE);
  const items = validateItems(body.items === undefined ? [] : body.items);
  if (items.length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'An invoice may contain at most 100 items.');

  const eInvoiceCode = requireText(body.e_invoice_code || body.einvoice_code, 'e_invoice_code', 64, { optional: true });
  const paymentTermId = body.payment_term_id ? parseId(body.payment_term_id, 'payment_term_id') : null;
  const notes = requireText(body.notes, 'notes', 2000, { optional: true });

  return { customerId, dueDate, taxRate, items, eInvoiceCode, paymentTermId, notes };
}

async function insertItems(client, invoiceId, items, defaultTaxRate = '0.10') {
  for (const item of items) {
    const sku = item.sku || null;
    const unit = item.unit || 'Đơn vị';
    const discount = item.discount_percent || '0';
    let vatRate = item.vat_rate !== null && item.vat_rate !== undefined ? item.vat_rate : null;

    if (vatRate === null && sku) {
      const prodRes = await client.query('SELECT vat_rate::text FROM public.products WHERE sku = $1', [sku]);
      if (prodRes.rowCount && prodRes.rows[0].vat_rate !== null) {
        vatRate = prodRes.rows[0].vat_rate;
      }
    }
    if (vatRate === null) {
      vatRate = defaultTaxRate !== null && defaultTaxRate !== undefined ? String(defaultTaxRate) : '0.10';
    }

    await client.query(
      `INSERT INTO public.invoice_items (invoice_id, sku, description, unit, quantity, unit_price, discount_percent, vat_rate, line_total, vat_amount, total_amount)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric,
               round($5::numeric * $6::numeric * (1 - $7::numeric / 100), 2),
               round(round($5::numeric * $6::numeric * (1 - $7::numeric / 100), 2) * $8::numeric, 2),
               round($5::numeric * $6::numeric * (1 - $7::numeric / 100), 2) + round(round($5::numeric * $6::numeric * (1 - $7::numeric / 100), 2) * $8::numeric, 2))`,
      [invoiceId, sku, item.description, unit, item.quantity, item.unit_price, discount, vatRate]
    );
  }
}

async function recalculateTotals(client, invoiceId) {
  const result = await client.query(
    `UPDATE public.invoices AS invoice
     SET subtotal = totals.subtotal,
         tax_amount = totals.tax_amount,
         total = totals.subtotal + totals.tax_amount,
         tax_rate = CASE
           WHEN totals.subtotal > 0 THEN round(totals.tax_amount / totals.subtotal, 4)
           ELSE 0
         END
     FROM (
       SELECT coalesce(sum(line_total), 0)::numeric(14, 2) AS subtotal,
              coalesce(sum(vat_amount), 0)::numeric(14, 2) AS tax_amount
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

async function loadInvoice(db, invoiceId) {
  const invoiceResult = await db.query(
    `SELECT invoice.id, invoice.invoice_no, invoice.e_invoice_code, invoice.e_invoice_code AS einvoice_code, invoice.customer_id, customer.name AS customer_name,
       customer.tax_code AS customer_tax_code, customer.email AS customer_email, customer.phone AS customer_phone,
       customer.address AS customer_address,
       customer.status AS customer_status,
       customer.credit_limit::text AS customer_credit_limit,
       customer.lock_source AS customer_lock_source,
       customer.lock_reason AS customer_lock_reason,
       customer.locked_at AS customer_locked_at,
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

  const items = await db.query(
    `SELECT id, sku, description, unit, quantity::text, unit_price::text, discount_percent::text,
            vat_rate::text, vat_amount::text, line_total::text, total_amount::text
     FROM public.invoice_items WHERE invoice_id = $1 ORDER BY id`,
    [invoiceId]
  );
  const payments = await db.query(
    `SELECT pa.id AS allocation_id, p.id, pa.allocated_amount::text AS amount, p.method, p.paid_at,
            p.reference, p.bank_name, p.bank_account, p.recorded_by, pa.created_at
     FROM public.payment_allocations pa
     JOIN public.payments p ON p.id = pa.payment_id
     WHERE pa.invoice_id = $1
     ORDER BY pa.id`,
    [invoiceId]
  );
  const adjustments = await db.query(
    `SELECT id, credit_note_no, adjustment_type, total_amount::text, reason, status, created_at
     FROM public.invoice_adjustments WHERE original_invoice_id = $1 ORDER BY id`,
    [invoiceId]
  );
  const refunds = await db.query(
    `SELECT id, refund_no, adjustment_id, amount::text, currency, status, reason, created_at
     FROM public.refund_payables WHERE invoice_id = $1 ORDER BY id`,
    [invoiceId]
  );

  return {
    ...invoiceResult.rows[0],
    items: items.rows,
    payments: payments.rows,
    adjustments: adjustments.rows,
    refunds: refunds.rows
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
  router.get('/', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    const { page, limit, page_size, offset } = parsePage(req.query);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    if (status && !STATUSES.has(status)) throw new AppError(400, 'INVALID_STATUS', 'status is not valid.');
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const dueFrom = req.query.due_from ? requireDate(req.query.due_from, 'due_from') : null;
    const dueTo = req.query.due_to ? requireDate(req.query.due_to, 'due_to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT invoice.id, invoice.invoice_no, invoice.e_invoice_code, invoice.e_invoice_code AS einvoice_code, invoice.customer_id,
           customer.name AS customer_name, customer.code AS customer_code, customer.tax_code AS customer_tax_code,
           customer.status AS customer_status, customer.lock_source AS customer_lock_source,
           invoice.status, invoice.currency,
           invoice.issue_date, invoice.due_date, invoice.total::text,
           invoice.paid_total::text, invoice.adjusted_total::text, (invoice.total - invoice.paid_total - invoice.adjusted_total)::numeric(14, 2)::text AS outstanding,
           invoice.created_at
         FROM public.invoices AS invoice
         JOIN public.customers AS customer ON customer.id = invoice.customer_id
         WHERE ($1::text IS NULL OR invoice.status = $1)
           AND ($2::bigint IS NULL OR invoice.customer_id = $2)
           AND ($3::date IS NULL OR invoice.issue_date >= $3)
           AND ($4::date IS NULL OR invoice.issue_date <= $4)
           AND ($5::date IS NULL OR invoice.due_date >= $5)
           AND ($6::date IS NULL OR invoice.due_date <= $6)
           AND ($7::text IS NULL OR invoice.invoice_no ILIKE $7 OR invoice.e_invoice_code ILIKE $7 OR customer.name ILIKE $7 OR customer.code ILIKE $7 OR customer.tax_code ILIKE $7 OR invoice.status ILIKE $7)
         ORDER BY invoice.created_at DESC, invoice.id DESC LIMIT $8 OFFSET $9`,
        [status, customerId, from, to, dueFrom, dueTo, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.invoices AS invoice
         JOIN public.customers AS customer ON customer.id = invoice.customer_id
         WHERE ($1::text IS NULL OR invoice.status = $1)
           AND ($2::bigint IS NULL OR invoice.customer_id = $2)
           AND ($3::date IS NULL OR invoice.issue_date >= $3)
           AND ($4::date IS NULL OR invoice.issue_date <= $4)
           AND ($5::date IS NULL OR invoice.due_date >= $5)
           AND ($6::date IS NULL OR invoice.due_date <= $6)
           AND ($7::text IS NULL OR invoice.invoice_no ILIKE $7 OR invoice.e_invoice_code ILIKE $7 OR customer.name ILIKE $7 OR customer.code ILIKE $7 OR customer.tax_code ILIKE $7 OR invoice.status ILIKE $7)`,
        [status, customerId, from, to, dueFrom, dueTo, pattern]
      )
    ]);
    res.json({ items: items.rows, total: Number(count.rows[0].total), page, limit, page_size: limit });
  }));

  // GET /api/invoices/export.csv (Server-side unpaginated CSV export with exact query filter consistency)
  router.get('/export.csv', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    if (status && !STATUSES.has(status)) throw new AppError(400, 'INVALID_STATUS', 'status is not valid.');
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const dueFrom = req.query.due_from ? requireDate(req.query.due_from, 'due_from') : null;
    const dueTo = req.query.due_to ? requireDate(req.query.due_to, 'due_to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const items = await pool.query(
      `SELECT invoice.id, invoice.invoice_no, invoice.e_invoice_code,
         customer.name AS customer_name, customer.code AS customer_code, customer.tax_code AS customer_tax_code,
         invoice.status, invoice.issue_date, invoice.due_date, invoice.total::text,
         invoice.paid_total::text, (invoice.total - invoice.paid_total - invoice.adjusted_total)::numeric(14, 2)::text AS outstanding
       FROM public.invoices AS invoice
       JOIN public.customers AS customer ON customer.id = invoice.customer_id
       WHERE ($1::text IS NULL OR invoice.status = $1)
         AND ($2::bigint IS NULL OR invoice.customer_id = $2)
         AND ($3::date IS NULL OR invoice.issue_date >= $3)
         AND ($4::date IS NULL OR invoice.issue_date <= $4)
         AND ($5::date IS NULL OR invoice.due_date >= $5)
         AND ($6::date IS NULL OR invoice.due_date <= $6)
         AND ($7::text IS NULL OR invoice.invoice_no ILIKE $7 OR invoice.e_invoice_code ILIKE $7 OR customer.name ILIKE $7 OR customer.code ILIKE $7 OR customer.tax_code ILIKE $7 OR invoice.status ILIKE $7)
       ORDER BY invoice.created_at DESC, invoice.id DESC`,
      [status, customerId, from, to, dueFrom, dueTo, pattern]
    );

    const headers = ['Số HĐ', 'Mã CQT TT78', 'Khách hàng', 'Mã KH', 'MST', 'Ngày lập', 'Hạn thanh toán', 'Tổng tiền (VND)', 'Đã thanh toán (VND)', 'Còn lại (VND)', 'Trạng thái'];
    const rows = items.rows.map(inv => [
      inv.invoice_no || `DRAFT-${inv.id}`,
      inv.e_invoice_code || '',
      inv.customer_name || '',
      inv.customer_code || '',
      inv.customer_tax_code || '',
      inv.issue_date ? new Date(inv.issue_date).toISOString().slice(0, 10) : '',
      inv.due_date ? new Date(inv.due_date).toISOString().slice(0, 10) : '',
      inv.total || '0',
      inv.paid_total || '0',
      inv.outstanding || '0',
      inv.status || ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `danh_sach_hoa_don_${dateStr}.csv`,
      headers,
      rows
    });
  }));

  // POST /api/invoices
  router.post('/', requireAuth, requirePermission('invoice.create'), asyncRoute(async (req, res) => {
    const input = invoiceInput(req.body);
    try {
      const invoice = await inTransaction(async (client) => {
        const customer = await client.query('SELECT id, name, payment_term_id FROM public.customers WHERE id = $1', [input.customerId]);
        if (!customer.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');

        const customerName = customer.rows[0].name;

        // Authoritatively resolve payment term and calculate due date
        const curDateRes = await client.query('SELECT current_date::text AS cd');
        const baseDate = curDateRes.rows[0].cd;
        const termResolution = await PaymentTermsService.calculateAuthoritativeDueDate(client, {
          paymentTermId: input.paymentTermId,
          customerId: input.customerId,
          baseDate
        });
        const resolvedTerm = termResolution.term;
        const authoritativeDueDate = input.paymentTermId
          ? termResolution.dueDate
          : (input.dueDate || termResolution.dueDate);
        const paymentTermId = input.paymentTermId
          ? (resolvedTerm?.id || null)
          : (input.dueDate ? null : (resolvedTerm?.id || null));

        const inserted = await client.query(
          `INSERT INTO public.invoices (customer_id, due_date, tax_rate, e_invoice_code, payment_term_id, notes, created_by)
           VALUES ($1, $2, $3::numeric, $4, $5, $6, $7) RETURNING id`,
          [input.customerId, authoritativeDueDate, input.taxRate, input.eInvoiceCode, paymentTermId, input.notes, req.user.id]
        );
        const id = inserted.rows[0].id;
        await insertItems(client, id, input.items, input.taxRate);
        await recalculateTotals(client, id);

        const loadedInvoice = await loadInvoice(client, id);

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'invoices',
          action: 'INVOICE_CREATED',
          targetRef: `DRAFT-${id}`,
          severity: 'INFO',
          summary: `Tạo dự thảo hóa đơn DRAFT-${id} cho khách hàng ${customerName} (Tổng: ${loadedInvoice.total} ₫)`,
          metadata: { invoice_id: id, total: loadedInvoice.total },
          throwOnError: true
        });

        return loadedInvoice;
      });

      invoicesCreated.inc();
      writeLog('info', 'invoice.created', { request_id: req.requestId, user: req.user.username, invoice_id: invoice.id });

      res.status(201).json({ invoice });
    } catch (error) {
      mapInvoiceWriteError(error);
    }
  }));

  // GET /api/invoices/:id
  router.get('/:id', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    res.json({ invoice: await loadInvoice(pool, parseId(req.params.id)) });
  }));

  // GET /api/invoices/:id/print (Server-side Official VAT Invoice HTML / JSON)
  router.get('/:id/print', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const invoice = await loadInvoice(pool, invoiceId);

    const companyRes = await pool.query('SELECT * FROM public.company_settings WHERE id = 1');
    const company = companyRes.rows[0] || {};

    const format = req.query.format || (req.headers.accept?.includes('application/json') ? 'json' : 'html');
    if (format === 'json') {
      return res.json({
        document_type: 'VAT_INVOICE',
        standard: 'NGHI_DINH_123_2020_ND_CP',
        invoice,
        company,
        amount_in_words: docTienBangChu(invoice.total),
        generated_at: new Date().toISOString()
      });
    }

    const html = renderInvoiceHtml({
      invoice,
      items: invoice.items,
      customer: {
        name: invoice.customer_name,
        tax_code: invoice.customer_tax_code,
        address: invoice.customer_address,
        phone: invoice.customer_phone,
        email: invoice.customer_email
      },
      company,
      adjustments: invoice.adjustments
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }));

  // GET /api/invoices/:id/document (Authoritative Invoice Document Metadata)
  router.get('/:id/document', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const invoice = await loadInvoice(pool, invoiceId);
    const companyRes = await pool.query('SELECT * FROM public.company_settings WHERE id = 1');
    const company = companyRes.rows[0] || {};
    res.json({
      document_type: 'VAT_INVOICE',
      standard: 'NGHI_DINH_123_2020_ND_CP',
      invoice,
      company,
      amount_in_words: docTienBangChu(invoice.total),
      generated_at: new Date().toISOString()
    });
  }));

  // PUT /api/invoices/:id
  router.put('/:id', requireAuth, requirePermission('invoice.update'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const input = invoiceInput(req.body);
    try {
      const invoice = await inTransaction(async (client) => {
        const current = await client.query('SELECT id, status, issue_date FROM public.invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
        if (!current.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
        if (current.rows[0].status !== 'DRAFT') {
          throw new AppError(409, 'INVOICE_NOT_DRAFT', 'Only DRAFT invoices can be changed.');
        }
        const customer = await client.query('SELECT id, name FROM public.customers WHERE id = $1', [input.customerId]);
        if (!customer.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');

        const curDateRes = await client.query('SELECT coalesce($1::date, current_date)::text AS cd', [current.rows[0].issue_date]);
        const baseDate = curDateRes.rows[0].cd;
        const termResolution = await PaymentTermsService.calculateAuthoritativeDueDate(client, {
          paymentTermId: input.paymentTermId,
          customerId: input.customerId,
          baseDate
        });
        const resolvedTerm = termResolution.term;
        const authoritativeDueDate = input.paymentTermId
          ? termResolution.dueDate
          : (input.dueDate || termResolution.dueDate);
        const paymentTermId = input.paymentTermId
          ? (resolvedTerm?.id || null)
          : (input.dueDate ? null : (resolvedTerm?.id || null));

        await client.query(
          `UPDATE public.invoices
           SET customer_id = $2, due_date = $3, tax_rate = $4::numeric,
               e_invoice_code = $5, payment_term_id = $6, notes = $7
           WHERE id = $1`,
          [invoiceId, input.customerId, authoritativeDueDate, input.taxRate, input.eInvoiceCode, paymentTermId, input.notes]
        );
        await client.query('DELETE FROM public.invoice_items WHERE invoice_id = $1', [invoiceId]);
        await insertItems(client, invoiceId, input.items, input.taxRate);
        await recalculateTotals(client, invoiceId);

        const loadedInvoice = await loadInvoice(client, invoiceId);

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'invoices',
          action: 'INVOICE_UPDATED',
          targetRef: `DRAFT-${invoiceId}`,
          severity: 'INFO',
          summary: `Cập nhật dự thảo hóa đơn DRAFT-${invoiceId}`,
          metadata: { invoice_id: invoiceId, total: loadedInvoice.total },
          throwOnError: true
        });

        return loadedInvoice;
      });

      res.json({ invoice });
    } catch (error) {
      mapInvoiceWriteError(error);
    }
  }));

  // POST /api/invoices/:id/issue
  router.post('/:id/issue', requireAuth, requirePermission('invoice.issue'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const issued = await inTransaction(async (client) => {
      // Step 1: Lock invoice row FOR UPDATE
      const locked = await client.query(
        'SELECT id, customer_id, status, due_date, total::text, e_invoice_code, payment_term_id FROM public.invoices WHERE id = $1 FOR UPDATE',
        [invoiceId]
      );
      if (!locked.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const invoice = locked.rows[0];
      if (invoice.status !== 'DRAFT') throw new AppError(409, 'INVOICE_NOT_DRAFT', 'Only DRAFT invoices can be issued.');

      // Step 2: Validate preconditions
      await validateDraftInvoiceIntegrity(client, invoice);

      // Step 3: Customer Credit & Risk Pre-Issuance Gate (Locks customer row FOR UPDATE)
      const creditSnapshot = await CustomerCreditService.checkInvoiceIssueEligibility(client, {
        customerId: invoice.customer_id,
        invoiceTotal: invoice.total
      });

      // Step 4: Sequence generation only AFTER all validation & eligibility checks pass
      const invoiceNo = await generateNextInvoiceNumber(client);
      const seqVal = invoiceNo.split('-')[2] || '000001';
      const eInvoiceCode = invoice.e_invoice_code || `1C25TND-${seqVal}`;

      // Calculate authoritative due_date from issue_date (current_date) + payment term
      let issueDueDate = invoice.due_date;
      if (invoice.payment_term_id) {
        const termRes = await client.query('SELECT days FROM public.payment_terms WHERE id = $1', [invoice.payment_term_id]);
        if (termRes.rowCount) {
          const days = Number(termRes.rows[0].days);
          const calcRes = await client.query("SELECT (current_date + ($1 || ' days')::interval)::date AS calc_due", [days]);
          issueDueDate = calcRes.rows[0].calc_due;
        }
      }

      // Step 5: Update invoice status to ISSUED
      const result = await client.query(
        `UPDATE public.invoices
         SET invoice_no = $2, e_invoice_code = $3, status = 'ISSUED', issue_date = current_date, due_date = $4
         WHERE id = $1
         RETURNING id, customer_id, invoice_no, e_invoice_code, status, issue_date, due_date,
           subtotal::text, tax_amount::text, total::text, paid_total::text`,
        [invoiceId, invoiceNo, eInvoiceCode, issueDueDate]
      );
      const updatedInvoice = result.rows[0];

      // Step 6: Atomic Forensic Audit Snapshot (Recorded INSIDE transaction BEFORE commit)
      const auditMetadata = {
        invoice_id: Number(updatedInvoice.id),
        invoice_no: updatedInvoice.invoice_no,
        customer_id: Number(updatedInvoice.customer_id),
        customer_status_prior: creditSnapshot.status,
        credit_limit: creditSnapshot.credit_limit,
        current_debt_prior: creditSnapshot.current_debt,
        invoice_total: creditSnapshot.invoice_total,
        projected_debt: creditSnapshot.projected_debt,
        issue_decision: 'NORMAL',
        e_invoice_code: updatedInvoice.e_invoice_code
      };

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'invoices',
        action: 'INVOICE_ISSUED',
        targetRef: updatedInvoice.invoice_no,
        severity: 'INFO',
        summary: `Phát hành hóa đơn ${updatedInvoice.invoice_no} (Mã mô phỏng nội bộ: ${updatedInvoice.e_invoice_code}) - Tổng: ${updatedInvoice.total} ₫`,
        metadata: auditMetadata,
        throwOnError: true
      });

      return updatedInvoice;
    });

    writeLog('info', 'invoice.issued', {
      request_id: req.requestId,
      user: req.user.username,
      invoice_id: invoiceId,
      invoice_no: issued.invoice_no
    });

    res.json({ invoice: await loadInvoice(pool, invoiceId) });
  }));

  // POST /api/invoices/:id/issue-override
  router.post('/:id/issue-override', requireAuth, requirePermission('invoice.issue_override'), asyncRoute(async (req, res) => {
    const invoiceId = parseId(req.params.id);
    const cleanIdempotencyKey = extractOverrideIdempotencyKey(req);
    const overrideReason = validateOverrideReason(req.body);
    const requestHash = computeOverrideRequestFingerprint(invoiceId, overrideReason);
    const namespacedKey = cleanIdempotencyKey.length <= 240
      ? `inv_override:${cleanIdempotencyKey}`
      : `inv_override:h_${crypto.createHash('sha256').update(cleanIdempotencyKey).digest('hex')}`;

    const result = await inTransaction(async (client) => {
      // Step 1: Idempotency advisory lock (Level 0)
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        ['idemp_override', namespacedKey]
      );

      // Step 2: Check existing idempotency key
      const existingKeyRes = await client.query(
        `SELECT id, request_hash, response_status, response_body
         FROM public.payment_idempotency_keys
         WHERE idempotency_key = $1`,
        [namespacedKey]
      );

      if (existingKeyRes.rowCount > 0) {
        const row = existingKeyRes.rows[0];
        if (row.request_hash !== requestHash) {
          throw new AppError(
            409,
            'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            'The provided Idempotency-Key has already been used with different request parameters.'
          );
        }
        return {
          ...row.response_body,
          is_idempotent_replay: true
        };
      }

      // Step 3: Lock target invoice row FOR UPDATE (Level 1)
      const locked = await client.query(
        `SELECT id, customer_id, invoice_no, status, due_date, total::text, paid_total::text, adjusted_total::text, e_invoice_code, payment_term_id
         FROM public.invoices
         WHERE id = $1
         FOR UPDATE`,
        [invoiceId]
      );
      if (locked.rowCount === 0) {
        throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      }
      const invoice = locked.rows[0];
      if (invoice.status !== 'DRAFT') {
        throw new AppError(409, 'INVOICE_NOT_DRAFT', 'Only DRAFT invoices can be issued.');
      }

      // Step 4: Validate basic invoice integrity (items count, total > 0, valid due_date)
      await validateDraftInvoiceIntegrity(client, invoice);

      // Step 5: Lock customer row FOR UPDATE & get credit snapshot (Level 2)
      // Bypasses CREDIT_LIMIT_EXCEEDED and CUSTOMER_IS_LOCKED enforcement while computing exact snapshot
      const creditSnapshot = await CustomerCreditService.getInvoiceCreditSnapshot(client, {
        customerId: invoice.customer_id,
        invoiceTotal: invoice.total
      });

      // Step 6: Generate invoice number only AFTER all validation & snapshot pass
      const invoiceNo = await generateNextInvoiceNumber(client);
      const seqVal = invoiceNo.split('-')[2] || '000001';
      const eInvoiceCode = invoice.e_invoice_code || `1C25TND-${seqVal}`;

      // Calculate authoritative due_date from issue_date (current_date) + payment term
      let issueDueDate = invoice.due_date;
      if (invoice.payment_term_id) {
        const termRes = await client.query('SELECT days FROM public.payment_terms WHERE id = $1', [invoice.payment_term_id]);
        if (termRes.rowCount) {
          const days = Number(termRes.rows[0].days);
          const calcRes = await client.query("SELECT (current_date + ($1 || ' days')::interval)::date AS calc_due", [days]);
          issueDueDate = calcRes.rows[0].calc_due;
        }
      }

      // Step 7: Update invoice status to ISSUED
      const updateResult = await client.query(
        `UPDATE public.invoices
         SET invoice_no = $2, e_invoice_code = $3, status = 'ISSUED', issue_date = current_date, due_date = $4
         WHERE id = $1
         RETURNING id, customer_id, invoice_no, e_invoice_code, status, issue_date, due_date,
           subtotal::text, tax_amount::text, total::text, paid_total::text`,
        [invoiceId, invoiceNo, eInvoiceCode, issueDueDate]
      );
      const updatedInvoice = updateResult.rows[0];

      // Step 8: Create audit event inside transaction BEFORE commit
      const auditMetadata = {
        invoice_id: Number(updatedInvoice.id),
        invoice_no: updatedInvoice.invoice_no,
        customer_id: Number(creditSnapshot.customer_id),
        customer_name: creditSnapshot.customer_name,
        customer_status: creditSnapshot.customer_status,
        credit_limit: creditSnapshot.credit_limit,
        current_debt: creditSnapshot.current_debt,
        invoice_total: creditSnapshot.invoice_total,
        projected_debt: creditSnapshot.projected_debt,
        amount_over_limit: creditSnapshot.amount_over_limit,
        override_reason: overrideReason,
        idempotency_key: cleanIdempotencyKey
      };

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'invoices',
        action: 'INVOICE_ISSUE_OVERRIDDEN',
        targetRef: updatedInvoice.invoice_no,
        severity: 'WARNING',
        summary: `Phát hành đặc cách hóa đơn ${updatedInvoice.invoice_no} vượt hạn mức tín dụng/khóa công nợ`,
        metadata: auditMetadata,
        throwOnError: true
      });

      // Step 9: Load full invoice details inside transaction
      const fullInvoice = await loadInvoice(client, invoiceId);

      const responsePayload = {
        invoice: fullInvoice,
        is_idempotent_replay: false
      };

      // Step 10: Persist idempotency mapping inside SAME transaction
      await client.query(
        `INSERT INTO public.payment_idempotency_keys
         (idempotency_key, request_hash, payment_id, response_status, response_body, created_by)
         VALUES ($1, $2, NULL, $3, $4, $5)`,
        [namespacedKey, requestHash, 200, JSON.stringify(responsePayload), req.user.id]
      );

      return responsePayload;
    });

    if (!result.is_idempotent_replay) {
      writeLog('info', 'invoice.issue_overridden', {
        request_id: req.requestId,
        user: req.user.username,
        invoice_id: invoiceId,
        invoice_no: result.invoice.invoice_no
      });
    }

    res.status(200).json(result);
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
      const cancelledInvoice = updated.rows[0];

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'invoices',
        action: 'INVOICE_CANCELLED',
        targetRef: cancelledInvoice.invoice_no || `DRAFT-${invoiceId}`,
        severity: 'CRITICAL',
        summary: `Hủy hóa đơn ${cancelledInvoice.invoice_no || `DRAFT-${invoiceId}`}. Lý do: ${reason}`,
        metadata: { invoice_id: invoiceId, reason },
        throwOnError: true
      });

      return cancelledInvoice;
    });

    writeLog('info', 'invoice.cancelled', { request_id: req.requestId, user: req.user.username, invoice_id: invoiceId });

    res.json({ invoice: await loadInvoice(pool, invoiceId) });
  }));

  // POST /api/invoices/:id/auto-allocate
  router.post('/:id/auto-allocate', requireAuth, requirePermission('payment.create'), asyncRoute(async (req, res) => {
    const idempotencyKey = extractAndRequireIdempotencyKey(req);
    const invoiceId = parseId(req.params.id);

    const result = await inTransaction(async (client) => {
      const allocResult = await PaymentService.autoAllocateUnappliedCash(client, {
        invoiceId,
        recordedBy: req.user.id,
        idempotencyKey,
        source: 'MANUAL'
      });

      if (!allocResult.is_idempotent_replay) {
        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'payments',
          action: 'PAYMENT_AUTO_ALLOCATED',
          targetRef: allocResult.invoice_no || `INV-${invoiceId}`,
          severity: 'INFO',
          summary: `Tự động phân bổ ${allocResult.allocated_total} ₫ từ ${allocResult.allocations_count} khoản tiền thừa cho hóa đơn ${allocResult.invoice_no || `INV-${invoiceId}`} (Nguồn: MANUAL)`,
          metadata: {
            invoice_id: allocResult.invoice_id,
            invoice_no: allocResult.invoice_no,
            allocated_total: allocResult.allocated_total,
            allocations_count: allocResult.allocations_count,
            payment_ids: allocResult.payment_ids,
            idempotency_key: idempotencyKey,
            invoice_status: allocResult.invoice_status,
            settlement_type: allocResult.settlement_type,
            allocated_from_unapplied: allocResult.allocated_from_unapplied,
            previous_paid_total: allocResult.previous_paid_total,
            new_paid_total: allocResult.new_paid_total,
            allocations: allocResult.allocations,
            remaining_unapplied_cash: allocResult.remaining_unapplied_cash
          },
          throwOnError: true
        });
      }

      return allocResult;
    });

    if (!result.is_idempotent_replay) {
      writeLog('info', 'invoice.auto_allocated', {
        request_id: req.requestId,
        user: req.user.username,
        invoice_id: invoiceId,
        allocated_total: result.allocated_total,
        allocated_from_unapplied: result.allocated_from_unapplied,
        settlement_type: result.settlement_type
      });
    }

    res.status(result.is_idempotent_replay ? 200 : 201).json(result);
  }));

  return router;
}

module.exports = { invoiceRouter };