const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { paymentsAmountVnd } = require('../metrics');
const { recordAudit } = require('../audit');
const { PaymentService } = require('../services/paymentService');

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
      return await PaymentService.createPayment(client, {
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
    });

    if (!result.is_idempotent_replay) {
      paymentsAmountVnd.inc(Number(result.payment.amount));

      writeLog('info', 'payment.recorded', {
        request_id: req.requestId,
        user: req.user.username,
        invoice_id: invoiceId,
        payment_id: result.payment.id
      });

      const targetInvoice = result.updated_invoices[0] || {};

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'payments',
        action: 'PAYMENT_RECORDED',
        targetRef: targetInvoice.invoice_no || `#${invoiceId}`,
        severity: 'INFO',
        summary: `Ghi nhận thanh toán ${result.payment.amount} ₫ cho hóa đơn ${targetInvoice.invoice_no || `#${invoiceId}`} (${result.payment.method})`,
        metadata: result.payment
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
      return await PaymentService.createPayment(client, {
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
    });

    if (!result.is_idempotent_replay) {
      paymentsAmountVnd.inc(Number(result.payment.amount));

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'payments',
        action: 'PAYMENT_CREATED',
        targetRef: result.payment.reference || `#PAY-${result.payment.id}`,
        severity: 'INFO',
        summary: `Tạo khoản thanh toán ${result.payment.amount} ₫ (${result.payment.method}) - Đã phân bổ: ${result.allocated_total} ₫, Tiền chưa phân bổ: ${result.unapplied_amount} ₫`,
        metadata: result.payment
      });
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
      return await PaymentService.allocatePayment(client, {
        paymentId,
        allocations,
        recordedBy: req.user.id,
        idempotencyKey
      });
    });

    if (!result.is_idempotent_replay) {
      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'payments',
        action: 'PAYMENT_ALLOCATED',
        targetRef: `#PAY-${paymentId}`,
        severity: 'INFO',
        summary: `Phân bổ ${result.allocations.length} hóa đơn cho khoản thanh toán #${paymentId}`,
        metadata: result
      });
    }

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
        return await PaymentService.allocatePayment(client, {
          paymentId,
          allocations,
          recordedBy: req.user.id,
          idempotencyKey
        });
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
      return await PaymentService.createPayment(client, {
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
    });

    if (!result.is_idempotent_replay) {
      paymentsAmountVnd.inc(Number(totalAmount));

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'payments',
        action: 'PAYMENT_ALLOCATED',
        targetRef: result.payment.reference || `#PAY-${result.payment.id}`,
        severity: 'INFO',
        summary: `Phân bổ thanh toán tổng ${totalAmount} ₫ cho ${result.allocations.length} hóa đơn`,
        metadata: { total_amount: totalAmount, allocations: result.allocations }
      });
    }

    res.status(result.is_idempotent_replay ? 200 : 201).json({
      ...result,
      allocatedPayments: result.allocations,
      updatedInvoices: result.updated_invoices
    });
  }));

  // GET /api/payments
  router.get('/payments', requireAuth, requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const invoiceId = req.query.invoice_id ? parseId(req.query.invoice_id, 'invoice_id') : null;
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;

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
         ORDER BY payment.paid_at DESC, payment.id DESC LIMIT $5 OFFSET $6`,
        [invoiceId, customerId, from, to, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.payments AS payment
         LEFT JOIN public.invoices AS invoice ON invoice.id = payment.invoice_id
         LEFT JOIN public.customers AS customer ON customer.id = coalesce(payment.customer_id, invoice.customer_id)
         WHERE ($1::bigint IS NULL OR payment.invoice_id = $1 OR payment.id IN (SELECT payment_id FROM public.payment_allocations WHERE invoice_id = $1))
           AND ($2::bigint IS NULL OR payment.customer_id = $2 OR customer.id = $2)
           AND ($3::date IS NULL OR payment.paid_at >= $3)
           AND ($4::date IS NULL OR payment.paid_at <= $4)`,
        [invoiceId, customerId, from, to]
      )
    ]);
    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  // GET /api/payments/:id
  router.get('/payments/:id', requireAuth, requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const paymentId = parseId(req.params.id);
    const payment = await PaymentService.getPaymentDetails(pool, paymentId);
    res.json({ payment });
  }));

  return router;
}

module.exports = { paymentsRouter, extractAndRequireIdempotencyKey };