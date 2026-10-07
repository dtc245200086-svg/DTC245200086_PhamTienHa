const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth } = require('./auth');
const { recordAudit } = require('../audit');
const { PaymentService } = require('../services/paymentService');

function reconciliationRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/bank-transactions AND /api/reconciliation/transactions
  const listTransactionsHandler = asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const status = req.query.status ? req.query.status : null;
    const bankName = req.query.bank_name ? req.query.bank_name : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT b.id, b.tx_date, b.tx_time, b.description, b.amount::text,
                b.tx_type, b.reference, b.bank_name, b.bank_account, b.status,
                b.unapplied_amount::text,
                b.matched_invoice_id, i.invoice_no AS matched_invoice_no,
                c.name AS matched_customer_name, b.matched_payment_id, b.created_at
         FROM public.bank_transactions b
         LEFT JOIN public.invoices i ON i.id = b.matched_invoice_id
         LEFT JOIN public.customers c ON c.id = i.customer_id
         WHERE ($1::text IS NULL OR b.status = $1)
           AND ($2::text IS NULL OR b.bank_name = $2)
           AND ($3::text IS NULL OR b.description ILIKE $3 OR b.reference ILIKE $3)
         ORDER BY b.tx_date DESC, b.id DESC LIMIT $4 OFFSET $5`,
        [status, bankName, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.bank_transactions b
         WHERE ($1::text IS NULL OR b.status = $1)
           AND ($2::text IS NULL OR b.bank_name = $2)
           AND ($3::text IS NULL OR b.description ILIKE $3 OR b.reference ILIKE $3)`,
        [status, bankName, pattern]
      )
    ]);

    res.json({ items: items.rows, transactions: items.rows, total: count.rows[0].total, page, limit });
  });

  router.get('/bank-transactions', listTransactionsHandler);
  router.get('/reconciliation/transactions', listTransactionsHandler);
  router.get('/transactions', listTransactionsHandler);

  // POST /api/bank-transactions AND /api/reconciliation/transactions
  const createTransactionHandler = asyncRoute(async (req, res) => {
    requireObject(req.body);
    const txDate = requireDate(req.body.tx_date, 'tx_date');
    const description = requireText(req.body.description, 'description', 1000);
    const amount = requireDecimal(req.body.amount, 'amount');
    const txType = req.body.tx_type === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    const reference = requireText(req.body.reference, 'reference', 120, { optional: true });
    const bankName = requireText(req.body.bank_name || 'Vietcombank', 'bank_name', 100);
    const bankAccount = requireText(req.body.bank_account || '0011004392819', 'bank_account', 50);

    const result = await pool.query(
      `INSERT INTO public.bank_transactions
        (tx_date, description, amount, tx_type, reference, bank_name, bank_account, status, unapplied_amount)
       VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, 'UNMATCHED', 0)
       RETURNING id, tx_date, tx_time, description, amount::text, tx_type, reference, bank_name, bank_account, status, unapplied_amount::text, created_at`,
      [txDate, description, amount, txType, reference, bankName, bankAccount]
    );

    res.status(201).json({ transaction: result.rows[0] });
  });

  router.post('/bank-transactions', createTransactionHandler);
  router.post('/reconciliation/transactions', createTransactionHandler);
  router.post('/transactions', createTransactionHandler);

  // POST /api/reconciliation/auto-match and /api/auto-match
  const autoMatchHandler = asyncRoute(async (req, res) => {
    const matchedCount = await inTransaction(async (client) => {
      // 1. Fetch unmatched credit transactions
      const unmatchedRes = await client.query(
        `SELECT id, description, amount::text, reference, tx_date, bank_name, bank_account
         FROM public.bank_transactions
         WHERE status = 'UNMATCHED' AND tx_type = 'CREDIT' FOR UPDATE`
      );

      let matchedTotal = 0;
      for (const tx of unmatchedRes.rows) {
        // Try to find matching invoice
        const invoiceRes = await client.query(
          `SELECT i.id, i.invoice_no, i.total::text, i.paid_total::text, i.adjusted_total::text,
                  (i.total - i.paid_total - i.adjusted_total)::numeric(14, 2) AS outstanding,
                  c.name AS customer_name, c.tax_code AS customer_tax_code
           FROM public.invoices i
           JOIN public.customers c ON c.id = i.customer_id
           WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
             AND (
               $1 ILIKE ('%' || i.invoice_no || '%')
               OR (c.tax_code IS NOT NULL AND $1 ILIKE ('%' || c.tax_code || '%') AND (i.total - i.paid_total - i.adjusted_total) = $2::numeric)
               OR ((i.total - i.paid_total - i.adjusted_total) = $2::numeric AND $1 ILIKE ('%' || substring(c.name from 1 for 10) || '%'))
             )
           LIMIT 1 FOR UPDATE`,
          [tx.description, tx.amount]
        );

        if (invoiceRes.rowCount > 0) {
          const inv = invoiceRes.rows[0];
          const txAmt = Number(tx.amount);
          const outstandingAmt = Number(inv.outstanding);
          const payAmt = Math.min(txAmt, outstandingAmt).toFixed(2);
          const unappliedAmt = Math.max(0, txAmt - outstandingAmt).toFixed(2);
          const noteText = Number(unappliedAmt) > 0
            ? `Khớp tự động sao kê ngân hàng (Đã khớp: ${payAmt} ₫, Tiền chưa phân bổ/thừa: ${unappliedAmt} ₫)`
            : 'Khớp tự động sao kê ngân hàng';

          // Create canonical payment & allocation via PaymentService
          const payResult = await PaymentService.createPayment(client, {
            customerId: inv.customer_id,
            invoiceId: inv.id,
            amount: txAmt,
            method: 'BANK_TRANSFER',
            paidAt: tx.tx_date,
            reference: tx.reference || `BANK-TX-${tx.id}`,
            bankName: tx.bank_name,
            bankAccount: tx.bank_account,
            notes: noteText,
            recordedBy: req.user.id,
            allocations: [{ invoiceId: inv.id, amount: payAmt }],
            idempotencyKey: `BANK-TX-MATCH-${tx.id}`
          });
          const paymentId = payResult.payment.id;

          // Mark bank transaction as matched / partially matched with unapplied_amount
          const newStatus = Number(unappliedAmt) > 0 ? 'PARTIALLY_MATCHED' : 'MATCHED';
          await client.query(
            `UPDATE public.bank_transactions
             SET status = $4, matched_invoice_id = $2, matched_payment_id = $3, unapplied_amount = $5::numeric
             WHERE id = $1`,
            [tx.id, inv.id, paymentId, newStatus, unappliedAmt]
          );

          matchedTotal++;
        }
      }
      return matchedTotal;
    });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'reconciliation',
      action: 'AUTO_RECONCILIATION_RUN',
      severity: 'INFO',
      summary: `Chạy đối soát tự động: Khớp thành công ${matchedCount} giao dịch sao kê ngân hàng`
    });

    res.json({ matched_count: matchedCount, message: `Đã đối soát thành công ${matchedCount} giao dịch.` });
  });

  router.post('/reconciliation/auto-match', autoMatchHandler);
  router.post('/auto-match', autoMatchHandler);

  // POST /api/reconciliation/manual-match and /api/manual-match
  const manualMatchHandler = asyncRoute(async (req, res) => {
    requireObject(req.body);
    const txId = parseId(req.body.transaction_id, 'transaction_id');
    const invoiceId = parseId(req.body.invoice_id, 'invoice_id');

    const result = await inTransaction(async (client) => {
      const txRes = await client.query(
        `SELECT id, description, amount::text, reference, tx_date, bank_name, bank_account, status
         FROM public.bank_transactions WHERE id = $1 FOR UPDATE`,
        [txId]
      );
      if (!txRes.rowCount) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Bank transaction was not found.');
      const tx = txRes.rows[0];

      if (tx.status !== 'UNMATCHED') {
        throw new AppError(409, 'TRANSACTION_ALREADY_MATCHED', `Bank transaction is already ${tx.status} and cannot be matched again.`);
      }

      const invRes = await client.query(
        `SELECT id, invoice_no, status, total::text, paid_total::text, adjusted_total::text,
                (total - paid_total - adjusted_total)::numeric(14, 2) AS outstanding
         FROM public.invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );
      if (!invRes.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const inv = invRes.rows[0];

      if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status)) {
        throw new AppError(409, 'INVOICE_NOT_PAYABLE', 'Invoice is not in payable state.');
      }

      const txAmt = Number(tx.amount);
      const outstandingAmt = Number(inv.outstanding);
      if (outstandingAmt <= 0) {
        throw new AppError(409, 'INVOICE_ALREADY_SETTLED', 'Invoice has no outstanding balance to match.');
      }

      const payAmt = Math.min(txAmt, outstandingAmt).toFixed(2);
      const unappliedAmt = Math.max(0, txAmt - outstandingAmt).toFixed(2);
      const noteText = Number(unappliedAmt) > 0
        ? `Khớp thủ công sao kê ngân hàng (Đã khớp: ${payAmt} ₫, Tiền chưa phân bổ/thừa: ${unappliedAmt} ₫)`
        : 'Khớp thủ công sao kê ngân hàng';

      // Create canonical payment & allocation via PaymentService
      const payResult = await PaymentService.createPayment(client, {
        customerId: inv.customer_id,
        invoiceId: invoiceId,
        amount: txAmt,
        method: 'BANK_TRANSFER',
        paidAt: tx.tx_date,
        reference: tx.reference || `BANK-TX-${txId}`,
        bankName: tx.bank_name,
        bankAccount: tx.bank_account,
        notes: noteText,
        recordedBy: req.user.id,
        allocations: [{ invoiceId, amount: payAmt }],
        idempotencyKey: `BANK-TX-MATCH-${txId}`
      });
      const paymentId = payResult.payment.id;

      // Update bank transaction with unapplied amount
      const newStatus = Number(unappliedAmt) > 0 ? 'PARTIALLY_MATCHED' : 'MATCHED';
      await client.query(
        `UPDATE public.bank_transactions
         SET status = $4, matched_invoice_id = $2, matched_payment_id = $3, unapplied_amount = $5::numeric
         WHERE id = $1`,
        [txId, invoiceId, paymentId, newStatus, unappliedAmt]
      );

      return {
        tx_id: txId,
        invoice_no: inv.invoice_no,
        amount: payAmt,
        unapplied_amount: unappliedAmt,
        payment_id: paymentId,
        status: newStatus
      };
    });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'reconciliation',
      action: 'BANK_TRANSACTION_MATCHED',
      targetRef: result.invoice_no,
      severity: 'INFO',
      summary: `Khớp thủ công giao dịch #${result.tx_id} (${result.amount} ₫) vào hóa đơn ${result.invoice_no}`,
      metadata: result
    });

    res.json({ result });
  });

  router.post('/reconciliation/manual-match', manualMatchHandler);
  router.post('/manual-match', manualMatchHandler);

  return router;
}

module.exports = { reconciliationRouter };
