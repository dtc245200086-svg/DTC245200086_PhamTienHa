const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { paymentsAmountVnd } = require('../metrics');
const { recordAudit } = require('../audit');
const { PaymentService } = require('../services/paymentService');
const { docTienBangChu, renderPaymentReceiptHtml } = require('../services/documentService');
const { sendCsvResponse } = require('../csv');

const METHODS = new Set(['CASH', 'BANK_TRANSFER', 'CARD']);

/**
 * Extract and validate mandatory Idempotency-Key across canonical and backward-compatible sources.
 * Enforces non-empty string, length constraints, and strict conflict detection across sources.
 */
function extractAndRequireIdempotencyKey(req) {
  const canonical = req.headers['idempotency-key'];
  const legacy = req.headers['x-idempotency-key'];
  const bodyKey = (req.body && typeof req.body === 'object') ? req.body.idempotency_key : undefined;

  const sources = [];
  if (canonical !== undefined && canonical !== null) {
    sources.push({ name: 'Idempotency-Key', val: String(canonical).trim() });
  }
  if (legacy !== undefined && legacy !== null) {
    sources.push({ name: 'X-Idempotency-Key', val: String(legacy).trim() });
  }
  if (bodyKey !== undefined && bodyKey !== null) {
    sources.push({ name: 'body.idempotency_key', val: String(bodyKey).trim() });
  }

  const nonEmptySources = sources.filter(s => s.val.length > 0);

  if (nonEmptySources.length === 0) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required for payment mutations.');
  }

  // Conflict check: if multiple distinct non-empty key values are provided across sources
  const first = nonEmptySources[0];
  for (let i = 1; i < nonEmptySources.length; i++) {
    if (nonEmptySources[i].val !== first.val) {
      throw new AppError(400, 'CONFLICTING_IDEMPOTENCY_KEYS',
        `Conflicting idempotency keys provided: '${first.name}' (${first.val}) and '${nonEmptySources[i].name}' (${nonEmptySources[i].val}).`);
    }
  }

  const key = first.val;
  if (key.length > 255) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key must not exceed 255 characters.');
  }

  return key;
}

function paymentsRouter(pool) {
  const router = express.Router();

  // POST /api/invoices/:id/payments (Pay specific invoice)
  router.post('/invoices/:id/payments', requireAuth, requirePermission('payment.create'), asyncRoute(async (req, res) => {
    const idempotencyKey = extractAndRequireIdempotencyKey(req);
    const invoiceId = parseId(req.params.id);
    requireObject(req.body);
    const amount = requireDecimal(req.body.amount, 'amount');
    const method = requireText(req.body.method, 'method', 24);
    const paidAt = requireDate(req.body.paid_at, 'paid_at');
    const reference = requireText(req.body.reference, 'reference', 120, { optional: true });
    const bankName = requireText(req.body.bank_name, 'bank_name', 100, { optional: true });
    const bankAccount = requireText(req.body.bank_account, 'bank_account', 50, { optional: true });
    const notes = requireText(req.body.notes, 'notes', 1000, { optional: true });

    if (!METHODS.has(method)) throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'method must be CASH, BANK_TRANSFER, or CARD.');

    const result = await inTransaction(async (client) => {
      const payResult = await PaymentService.createPayment(client, {
        invoiceId,
        amount,
        method,
        paidAt,
        reference,
        bankName,
        bankAccount,
        notes,
        recordedBy: req.user.id,
        allocations: [{ invoiceId, amount }],
        idempotencyKey
      });

      if (!payResult.is_idempotent_replay) {
        const targetInvoice = payResult.updated_invoices[0] || {};
        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'payments',
          action: 'PAYMENT_RECORDED',
          targetRef: targetInvoice.invoice_no || `#${invoiceId}`,
          severity: 'INFO',
          summary: `Ghi nhận thanh toán ${payResult.payment.amount} ₫ cho hóa đơn ${targetInvoice.invoice_no || `#${invoiceId}`} (${payResult.payment.method})`,
          metadata: payResult.payment,
          throwOnError: true
        });
      }

      return payResult;
    });

    if (!result.is_idempotent_replay) {
      paymentsAmountVnd.inc(Number(result.payment.amount));

      writeLog('info', 'payment.recorded', {
        request_id: req.requestId,
        user: req.user.username,
        invoice_id: invoiceId,
        payment_id: result.payment.id
      });
    }

    const targetInvoice = (result.updated_invoices && result.updated_invoices[0]) || {};

    res.status(result.is_idempotent_replay ? 200 : 201).json({
      payment: result.payment,
      invoice: targetInvoice,
      allocations: result.allocations,
      allocated_total: result.allocated_total,
      unapplied_amount: result.unapplied_amount,
      is_idempotent_replay: Boolean(result.is_idempotent_replay)
    });
  }));

  // POST /api/payments (Direct payment creation with optional multi-allocation or unapplied cash)
  router.post('/payments', requireAuth, requirePermission('payment.create'), asyncRoute(async (req, res) => {
    const idempotencyKey = extractAndRequireIdempotencyKey(req);
    requireObject(req.body);
    const customerId = req.body.customer_id ? parseId(req.body.customer_id, 'customer_id') : null;
    const invoiceId = req.body.invoice_id ? parseId(req.body.invoice_id, 'invoice_id') : null;
    const amount = requireDecimal(req.body.amount || req.body.total_amount, 'amount');
    const method = requireText(req.body.method, 'method', 24);
    const paidAt = requireDate(req.body.paid_at || new Date().toISOString().slice(0, 10), 'paid_at');
    const reference = requireText(req.body.reference, 'reference', 120, { optional: true });
    const bankName = requireText(req.body.bank_name, 'bank_name', 100, { optional: true });
    const bankAccount = requireText(req.body.bank_account, 'bank_account', 50, { optional: true });
    const notes = requireText(req.body.notes, 'notes', 1000, { optional: true });
    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];

    if (!METHODS.has(method)) throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'method must be CASH, BANK_TRANSFER, or CARD.');

    const result = await inTransaction(async (client) => {
      const payResult = await PaymentService.createPayment(client, {
        customerId,
        invoiceId,
        amount,
        method,
        paidAt,
        reference,
        bankName,
        bankAccount,
        notes,
        recordedBy: req.user.id,
        allocations,
        idempotencyKey
      });

      if (!payResult.is_idempotent_replay) {
        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'payments',
          action: 'PAYMENT_CREATED',
          targetRef: payResult.payment.reference || `#PAY-${payResult.payment.id}`,
          severity: 'INFO',
          summary: `Tạo khoản thanh toán ${payResult.payment.amount} ₫ (${payResult.payment.method}) - Đã phân bổ: ${payResult.allocated_total} ₫, Tiền chưa phân bổ: ${payResult.unapplied_amount} ₫`,
          metadata: payResult.payment,
          throwOnError: true
        });
      }

      return payResult;
    });

    if (!result.is_idempotent_replay) {
      paymentsAmountVnd.inc(Number(result.payment.amount));
    }

    res.status(result.is_idempotent_replay ? 200 : 201).json(result);
  }));

  // POST /api/payments/:id/allocations (Allocate unapplied cash of existing payment)
  router.post('/payments/:id/allocations', requireAuth, requirePermission('payment.create'), asyncRoute(async (req, res) => {
    const idempotencyKey = extractAndRequireIdempotencyKey(req);
    const paymentId = parseId(req.params.id);
    requireObject(req.body);
    const allocations = req.body.allocations;
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'allocations array is required and must not be empty.');
    }

    const result = await inTransaction(async (client) => {
      const allocResult = await PaymentService.allocatePayment(client, {
        paymentId,
        allocations,
        recordedBy: req.user.id,
        idempotencyKey
      });

      if (!allocResult.is_idempotent_replay) {
        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'payments',
          action: 'PAYMENT_ALLOCATED',
          targetRef: `#PAY-${paymentId}`,
          severity: 'INFO',
          summary: `Phân bổ ${allocResult.allocations.length} hóa đơn cho khoản thanh toán #${paymentId}`,
          metadata: allocResult,
          throwOnError: true
        });
      }

      return allocResult;
    });

    res.status(result.is_idempotent_replay ? 200 : 201).json(result);
  }));

  // POST /api/payments/allocate (Multi-invoice payment allocation)
  router.post('/payments/allocate', requireAuth, requirePermission('payment.create'), asyncRoute(async (req, res) => {
    const idempotencyKey = extractAndRequireIdempotencyKey(req);
    requireObject(req.body);

    // If payment_id is provided, allocate existing payment
    if (req.body.payment_id) {
      const paymentId = parseId(req.body.payment_id, 'payment_id');
      const allocations = req.body.allocations;
      if (!Array.isArray(allocations) || allocations.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'allocations array is required.');
      }
      const result = await inTransaction(async (client) => {
        const allocResult = await PaymentService.allocatePayment(client, {
          paymentId,
          allocations,
          recordedBy: req.user.id,
          idempotencyKey
        });

        if (!allocResult.is_idempotent_replay) {
          await recordAudit(client, {
            user: req.user,
            ip: req.ip,
            module: 'payments',
            action: 'PAYMENT_ALLOCATED',
            targetRef: `#PAY-${paymentId}`,
            severity: 'INFO',
            summary: `Phân bổ ${allocResult.allocations.length} hóa đơn cho khoản thanh toán #${paymentId}`,
            metadata: allocResult,
            throwOnError: true
          });
        }

        return allocResult;
      });
      return res.status(result.is_idempotent_replay ? 200 : 201).json(result);
    }

    // Otherwise, create a new master payment and allocate across target invoices
    const customerId = parseId(req.body.customer_id, 'customer_id');
    const totalAmount = requireDecimal(req.body.total_amount || req.body.amount, 'total_amount');
    const method = requireText(req.body.method, 'method', 24);
    const paidAt = requireDate(req.body.paid_at || new Date().toISOString().slice(0, 10), 'paid_at');
    const reference = requireText(req.body.reference, 'reference', 120, { optional: true });
    const bankName = requireText(req.body.bank_name, 'bank_name', 100, { optional: true });
    const bankAccount = requireText(req.body.bank_account, 'bank_account', 50, { optional: true });
    const allocations = req.body.allocations;

    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'allocations array is required and must not be empty.');
    }
    if (!METHODS.has(method)) {
      throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'method must be CASH, BANK_TRANSFER, or CARD.');
    }

    const result = await inTransaction(async (client) => {
      const payResult = await PaymentService.createPayment(client, {
        customerId,
        amount: totalAmount,
        method,
        paidAt,
        reference,
        bankName,
        bankAccount,
        notes: `Phân bổ thanh toán đa hóa đơn cho khách hàng #${customerId}`,
        recordedBy: req.user.id,
        allocations,
        idempotencyKey
      });

      if (!payResult.is_idempotent_replay) {
        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'payments',
          action: 'PAYMENT_ALLOCATED',
          targetRef: payResult.payment.reference || `#PAY-${payResult.payment.id}`,
          severity: 'INFO',
          summary: `Phân bổ thanh toán tổng ${totalAmount} ₫ cho ${payResult.allocations.length} hóa đơn`,
          metadata: { total_amount: totalAmount, allocations: payResult.allocations },
          throwOnError: true
        });
      }

      return payResult;
    });

    if (!result.is_idempotent_replay) {
      paymentsAmountVnd.inc(Number(totalAmount));
    }

    res.status(result.is_idempotent_replay ? 200 : 201).json({
      ...result,
      allocatedPayments: result.allocations,
      updatedInvoices: result.updated_invoices
    });
  }));

  // GET /api/payments
  router.get('/payments', requireAuth, requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const { page, limit, page_size, offset } = parsePage(req.query);
    const invoiceId = req.query.invoice_id ? parseId(req.query.invoice_id, 'invoice_id') : null;
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const method = req.query.method ? req.query.method.trim() : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT payment.id, payment.customer_id, payment.invoice_id,
           coalesce(customer.name, (SELECT name FROM public.customers WHERE id = payment.customer_id)) AS customer_name,
           invoice.invoice_no,
           payment.amount::text, payment.method, payment.paid_at, payment.reference,
           payment.bank_name, payment.bank_account, payment.notes,
           payment.recorded_by, u.username AS recorded_by_username, payment.created_at,
           coalesce((SELECT sum(allocated_amount) FROM public.payment_allocations WHERE payment_id = payment.id), 0)::numeric(14, 2)::text AS allocated_amount,
           (payment.amount - coalesce((SELECT sum(allocated_amount) FROM public.payment_allocations WHERE payment_id = payment.id), 0))::numeric(14, 2)::text AS unapplied_amount,
           (SELECT count(*)::text FROM public.payment_allocations WHERE payment_id = payment.id) AS allocations_count
         FROM public.payments AS payment
         LEFT JOIN public.invoices AS invoice ON invoice.id = payment.invoice_id
         LEFT JOIN public.customers AS customer ON customer.id = coalesce(payment.customer_id, invoice.customer_id)
         LEFT JOIN public.users AS u ON u.id = payment.recorded_by
         WHERE ($1::bigint IS NULL OR payment.invoice_id = $1 OR payment.id IN (SELECT payment_id FROM public.payment_allocations WHERE invoice_id = $1))
           AND ($2::bigint IS NULL OR payment.customer_id = $2 OR customer.id = $2)
           AND ($3::date IS NULL OR payment.paid_at >= $3)
           AND ($4::date IS NULL OR payment.paid_at <= $4)
           AND ($5::text IS NULL OR payment.method = $5)
           AND ($6::text IS NULL OR invoice.invoice_no ILIKE $6 OR customer.name ILIKE $6 OR payment.reference ILIKE $6 OR payment.method ILIKE $6 OR payment.bank_name ILIKE $6 OR payment.bank_account ILIKE $6)
         ORDER BY payment.paid_at DESC, payment.id DESC LIMIT $7 OFFSET $8`,
        [invoiceId, customerId, from, to, method, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.payments AS payment
         LEFT JOIN public.invoices AS invoice ON invoice.id = payment.invoice_id
         LEFT JOIN public.customers AS customer ON customer.id = coalesce(payment.customer_id, invoice.customer_id)
         WHERE ($1::bigint IS NULL OR payment.invoice_id = $1 OR payment.id IN (SELECT payment_id FROM public.payment_allocations WHERE invoice_id = $1))
           AND ($2::bigint IS NULL OR payment.customer_id = $2 OR customer.id = $2)
           AND ($3::date IS NULL OR payment.paid_at >= $3)
           AND ($4::date IS NULL OR payment.paid_at <= $4)
           AND ($5::text IS NULL OR payment.method = $5)
           AND ($6::text IS NULL OR invoice.invoice_no ILIKE $6 OR customer.name ILIKE $6 OR payment.reference ILIKE $6 OR payment.method ILIKE $6 OR payment.bank_name ILIKE $6 OR payment.bank_account ILIKE $6)`,
        [invoiceId, customerId, from, to, method, pattern]
      )
    ]);
    res.json({ items: items.rows, total: Number(count.rows[0].total), page, limit, page_size: limit });
  }));

  // GET /api/payments/export.csv (Server-side unpaginated CSV export with exact query filter consistency)
  const paymentsExportHandler = asyncRoute(async (req, res) => {
    const invoiceId = req.query.invoice_id ? parseId(req.query.invoice_id, 'invoice_id') : null;
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const method = req.query.method ? req.query.method.trim() : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const items = await pool.query(
      `SELECT payment.id, payment.amount::text, payment.method, payment.paid_at, payment.reference,
         payment.bank_name, payment.bank_account,
         coalesce(customer.name, (SELECT name FROM public.customers WHERE id = payment.customer_id)) AS customer_name,
         u.username AS recorded_by_username,
         coalesce((SELECT sum(allocated_amount) FROM public.payment_allocations WHERE payment_id = payment.id), 0)::numeric(14, 2)::text AS allocated_amount,
         (payment.amount - coalesce((SELECT sum(allocated_amount) FROM public.payment_allocations WHERE payment_id = payment.id), 0))::numeric(14, 2)::text AS unapplied_amount
       FROM public.payments AS payment
       LEFT JOIN public.invoices AS invoice ON invoice.id = payment.invoice_id
       LEFT JOIN public.customers AS customer ON customer.id = coalesce(payment.customer_id, invoice.customer_id)
       LEFT JOIN public.users AS u ON u.id = payment.recorded_by
       WHERE ($1::bigint IS NULL OR payment.invoice_id = $1 OR payment.id IN (SELECT payment_id FROM public.payment_allocations WHERE invoice_id = $1))
         AND ($2::bigint IS NULL OR payment.customer_id = $2 OR customer.id = $2)
         AND ($3::date IS NULL OR payment.paid_at >= $3)
         AND ($4::date IS NULL OR payment.paid_at <= $4)
         AND ($5::text IS NULL OR payment.method = $5)
         AND ($6::text IS NULL OR invoice.invoice_no ILIKE $6 OR customer.name ILIKE $6 OR payment.reference ILIKE $6 OR payment.method ILIKE $6 OR payment.bank_name ILIKE $6 OR payment.bank_account ILIKE $6)
       ORDER BY payment.paid_at DESC, payment.id DESC`,
      [invoiceId, customerId, from, to, method, pattern]
    );

    const headers = ['Ngày thanh toán', 'Khách hàng', 'Phương thức', 'Mã tham chiếu', 'Ngân hàng', 'Số tài khoản', 'Tổng tiền thu (VND)', 'Đã phân bổ (VND)', 'Chưa phân bổ (VND)', 'Người ghi nhận'];
    const rows = items.rows.map(p => [
      p.paid_at ? new Date(p.paid_at).toISOString().slice(0, 10) : '',
      p.customer_name || 'Khách vãng lai',
      p.method || '',
      p.reference || '',
      p.bank_name || '',
      p.bank_account || '',
      p.amount || '0',
      p.allocated_amount || p.amount || '0',
      p.unapplied_amount || '0',
      p.recorded_by_username || ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `danh_sach_thanh_toan_${dateStr}.csv`,
      headers,
      rows
    });
  });

  router.get('/payments/export.csv', requireAuth, requirePermission('payment.read'), paymentsExportHandler);
  router.get('/export.csv', requireAuth, requirePermission('payment.read'), paymentsExportHandler);

  // GET /api/payments/:id
  router.get('/payments/:id', requireAuth, requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const paymentId = parseId(req.params.id);
    const payment = await PaymentService.getPaymentDetails(pool, paymentId);
    res.json({ payment });
  }));

  // GET /api/payments/:id/receipt (Server-side Payment Receipt Voucher HTML / JSON)
  const handlePaymentReceipt = async (req, res) => {
    const paymentId = parseId(req.params.id);
    const payment = await PaymentService.getPaymentDetails(pool, paymentId);

    let customer = {};
    if (payment.customer_id) {
      const custRes = await pool.query('SELECT * FROM public.customers WHERE id = $1', [payment.customer_id]);
      customer = custRes.rows[0] || {};
    } else {
      customer = { name: payment.customer_name, tax_code: payment.customer_tax_code };
    }

    const companyRes = await pool.query('SELECT * FROM public.company_settings WHERE id = 1');
    const company = companyRes.rows[0] || {};

    const format = req.query.format || (req.headers.accept?.includes('application/json') ? 'json' : 'html');
    if (format === 'json') {
      return res.json({
        document_type: 'PAYMENT_RECEIPT_MAU_01_TT',
        standard: 'THONG_TU_200_2014_TT_BTC',
        payment,
        customer,
        company,
        amount_in_words: docTienBangChu(payment.amount),
        generated_at: new Date().toISOString()
      });
    }

    const html = renderPaymentReceiptHtml({
      payment,
      customer,
      company,
      allocations: payment.allocations
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  };

  router.get('/payments/:id/receipt', requireAuth, requirePermission('payment.read'), asyncRoute(handlePaymentReceipt));
  router.get('/payments/:id/voucher', requireAuth, requirePermission('payment.read'), asyncRoute(handlePaymentReceipt));
  router.get('/payments/:id/print', requireAuth, requirePermission('payment.read'), asyncRoute(handlePaymentReceipt));

  return router;
}

module.exports = { paymentsRouter, extractAndRequireIdempotencyKey };