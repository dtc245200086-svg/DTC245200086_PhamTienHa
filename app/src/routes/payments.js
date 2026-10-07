const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { paymentsAmountVnd } = require('../metrics');
const { recordAudit } = require('../audit');

const METHODS = new Set(['CASH', 'BANK_TRANSFER', 'CARD']);

function paymentsRouter(pool) {
  const router = express.Router();

  // POST /api/invoices/:id/payments
  router.post('/invoices/:id/payments', requireAuth, requirePermission('payment.create'), asyncRoute(async (req, res) => {
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
      const locked = await client.query(
        `SELECT id, invoice_no, status, total::text, paid_total::text, adjusted_total::text
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
           $1::numeric <= ($2::numeric - $3::numeric - $4::numeric) AS within_outstanding`,
        [amount, invoice.total, invoice.paid_total, invoice.adjusted_total || '0']
      );
      if (!validAmount.rows[0].positive) throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Payment amount must be greater than zero.');
      if (!validAmount.rows[0].within_outstanding) {
        throw new AppError(409, 'PAYMENT_EXCEEDS_OUTSTANDING', 'Payment cannot exceed the outstanding balance.');
      }

      const payment = await client.query(
        `INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, bank_name, bank_account, notes, recorded_by)
         VALUES ($1, $2::numeric, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, invoice_id, amount::text, method, paid_at, reference, bank_name, bank_account, notes, recorded_by, created_at`,
        [invoiceId, amount, method, paidAt, reference, bankName, bankAccount, notes, req.user.id]
      );
      const paymentRow = payment.rows[0];

      // Insert matching record into payment_allocations
      await client.query(
        `INSERT INTO public.payment_allocations (payment_id, invoice_id, allocated_amount)
         VALUES ($1, $2, $3::numeric)`,
        [paymentRow.id, invoiceId, amount]
      );

      const updated = await client.query(
        `UPDATE public.invoices
         SET paid_total = paid_total + $2::numeric,
             status = CASE WHEN paid_total + $2::numeric + adjusted_total >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END
         WHERE id = $1
         RETURNING id, invoice_no, status, total::text, paid_total::text, adjusted_total::text`,
        [invoiceId, amount]
      );
      return { payment: paymentRow, invoice: updated.rows[0] };
    });

    paymentsAmountVnd.inc(Number(result.payment.amount));

    writeLog('info', 'payment.recorded', {
      request_id: req.requestId,
      user: req.user.username,
      invoice_id: invoiceId,
      payment_id: result.payment.id
    });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'payments',
      action: 'PAYMENT_RECORDED',
      targetRef: result.invoice.invoice_no || `#${invoiceId}`,
      severity: 'INFO',
      summary: `Ghi nhận thanh toán ${result.payment.amount} ₫ cho hóa đơn ${result.invoice.invoice_no} (${result.payment.method})`,
      metadata: result.payment
    });

    res.status(201).json(result);
  }));

  // GET /api/payments
  router.get('/payments', requireAuth, requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const invoiceId = req.query.invoice_id ? parseId(req.query.invoice_id, 'invoice_id') : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT payment.id, payment.invoice_id, invoice.invoice_no, customer.name AS customer_name,
           payment.amount::text, payment.method, payment.paid_at, payment.reference,
           payment.bank_name, payment.bank_account, payment.notes,
           payment.recorded_by, u.username AS recorded_by_username, payment.created_at
         FROM public.payments AS payment
         JOIN public.invoices AS invoice ON invoice.id = payment.invoice_id
         JOIN public.customers AS customer ON customer.id = invoice.customer_id
         LEFT JOIN public.users AS u ON u.id = payment.recorded_by
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

  // POST /api/payments/allocate (Multi-invoice payment allocation with exact invoice history)
  router.post('/payments/allocate', requireAuth, requirePermission('payment.create'), asyncRoute(async (req, res) => {
    requireObject(req.body);
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
      let sumAllocated = 0;
      const validatedAllocations = [];

      for (const alloc of allocations) {
        const invId = parseId(alloc.invoice_id, 'allocations.invoice_id');
        const allocAmt = requireDecimal(alloc.amount, 'allocations.amount');
        const numAmt = Number(allocAmt);
        if (numAmt <= 0) throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Allocated amount must be positive.');
        sumAllocated += numAmt;
        validatedAllocations.push({ invoiceId: invId, amount: allocAmt, numAmt });
      }

      if (Math.abs(sumAllocated - Number(totalAmount)) > 0.01) {
        throw new AppError(400, 'ALLOCATION_SUM_MISMATCH', 'The sum of allocated amounts must match total_amount exactly.');
      }

      const allocatedPayments = [];
      const updatedInvoices = [];

      // Process each invoice allocation individually so payment history is exact per invoice
      for (const item of validatedAllocations) {
        const locked = await client.query(
          `SELECT id, invoice_no, customer_id, status, total::text, paid_total::text, adjusted_total::text
           FROM public.invoices WHERE id = $1 FOR UPDATE`,
          [item.invoiceId]
        );
        if (!locked.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', `Invoice ${item.invoiceId} was not found.`);
        const inv = locked.rows[0];
        if (Number(inv.customer_id) !== customerId) {
          throw new AppError(400, 'CUSTOMER_MISMATCH', `Invoice ${inv.invoice_no} does not belong to customer ${customerId}.`);
        }
        if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) {
          throw new AppError(409, 'INVOICE_NOT_PAYABLE', `Invoice ${inv.invoice_no} is not in payable state.`);
        }

        const validAmt = await client.query(
          `SELECT $1::numeric <= ($2::numeric - $3::numeric - $4::numeric) AS within_outstanding`,
          [item.amount, inv.total, inv.paid_total, inv.adjusted_total || '0']
        );
        if (!validAmt.rows[0].within_outstanding) {
          throw new AppError(409, 'PAYMENT_EXCEEDS_OUTSTANDING', `Allocated amount for invoice ${inv.invoice_no} exceeds outstanding balance.`);
        }

        // Insert separate payment row for this invoice with exact allocated amount
        const payRes = await client.query(
          `INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, bank_name, bank_account, notes, recorded_by)
           VALUES ($1, $2::numeric, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, invoice_id, amount::text, method, paid_at, reference, bank_name, bank_account, recorded_by, created_at`,
          [
            item.invoiceId,
            item.amount,
            method,
            paidAt,
            reference || `ALLOC-${item.invoiceId}`,
            bankName,
            bankAccount,
            `Phân bổ từ khoản thanh toán tổng ${totalAmount} ₫ (GD: ${reference || 'N/A'})`,
            req.user.id
          ]
        );
        const paymentRow = payRes.rows[0];
        allocatedPayments.push(paymentRow);

        // Record allocation
        await client.query(
          `INSERT INTO public.payment_allocations (payment_id, invoice_id, allocated_amount)
           VALUES ($1, $2, $3::numeric)`,
          [paymentRow.id, item.invoiceId, item.amount]
        );

        // Update invoice balance & status
        const updated = await client.query(
          `UPDATE public.invoices
           SET paid_total = paid_total + $2::numeric,
               status = CASE WHEN paid_total + $2::numeric + adjusted_total >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END
           WHERE id = $1
           RETURNING id, invoice_no, status, total::text, paid_total::text, adjusted_total::text`,
          [item.invoiceId, item.amount]
        );
        updatedInvoices.push(updated.rows[0]);
      }

      // Return composite primary payment object for backward compatibility
      const primaryPayment = allocatedPayments[0] ? {
        ...allocatedPayments[0],
        amount: totalAmount,
        notes: `Phân bổ cho ${allocatedPayments.length} hóa đơn (Tổng: ${totalAmount} ₫)`
      } : null;

      return {
        payment: primaryPayment,
        allocatedPayments,
        updatedInvoices
      };
    });

    paymentsAmountVnd.inc(Number(totalAmount));

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'payments',
      action: 'PAYMENT_ALLOCATED',
      targetRef: `ALLOC-${result.updatedInvoices.map(i => i.invoice_no).join(',')}`,
      severity: 'INFO',
      summary: `Phân bổ thanh toán tổng ${totalAmount} ₫ cho ${result.updatedInvoices.length} hóa đơn`,
      metadata: { total_amount: totalAmount, invoices: result.updatedInvoices.map((i) => i.invoice_no) }
    });

    res.status(201).json({
      ...result,
      allocations: result.allocatedPayments
    });
  }));

  return router;
}

module.exports = { paymentsRouter };