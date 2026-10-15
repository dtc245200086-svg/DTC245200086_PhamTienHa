const express = require('express');
const crypto = require('node:crypto');
const { AppError, asyncRoute } = require('../errors');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');
const { docTienBangChu, renderRefundVoucherHtml } = require('../services/documentService');

const ALLOWED_PAYOUT_METHODS = new Set(['BANK_TRANSFER', 'CASH', 'CARD']);

function computeRefundSettlementFingerprint(refundId, payload) {
  const normalized = {
    action: 'REFUND_SETTLEMENT',
    refundId: String(refundId),
    payoutMethod: String(payload.payoutMethod || '').toUpperCase().trim(),
    payoutReference: payload.payoutReference ? String(payload.payoutReference).trim() : null,
    notes: payload.notes ? String(payload.notes).trim() : null
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function refundsRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/refunds (and /api/refund-payables)
  router.get('/', requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const customerId = req.query.customer_id ? parseId(req.query.customer_id, 'customer_id') : null;
    const invoiceId = req.query.invoice_id ? parseId(req.query.invoice_id, 'invoice_id') : null;
    const rawStatus = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    // Canonical state mapping: SETTLED -> PAID, REQUESTED -> PENDING
    const status = rawStatus === 'SETTLED' ? 'PAID' : (rawStatus === 'REQUESTED' ? 'PENDING' : rawStatus);

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT r.id, r.refund_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
                r.invoice_id, i.invoice_no,
                r.adjustment_id, a.credit_note_no,
                r.amount::text, r.currency, r.status, r.reason, r.notes,
                r.created_by, u1.username AS created_by_username,
                r.approved_by, u2.username AS approved_by_username,
                r.settled_by, u3.username AS settled_by_username,
                r.created_at, r.approved_at, r.settled_at,
                r.payout_method, r.payout_reference,
                r.paid_payment_id, r.metadata
         FROM public.refund_payables r
         JOIN public.customers c ON c.id = r.customer_id
         JOIN public.invoices i ON i.id = r.invoice_id
         JOIN public.invoice_adjustments a ON a.id = r.adjustment_id
         LEFT JOIN public.users u1 ON u1.id = r.created_by
         LEFT JOIN public.users u2 ON u2.id = r.approved_by
         LEFT JOIN public.users u3 ON u3.id = r.settled_by
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
  router.get('/:id', requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT r.id, r.refund_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
              r.invoice_id, i.invoice_no,
              r.adjustment_id, a.credit_note_no,
              r.amount::text, r.currency, r.status, r.reason, r.notes,
              r.created_by, u1.username AS created_by_username,
              r.approved_by, u2.username AS approved_by_username,
              r.settled_by, u3.username AS settled_by_username,
              r.created_at, r.approved_at, r.settled_at,
              r.payout_method, r.payout_reference,
              r.paid_payment_id, r.metadata
       FROM public.refund_payables r
       JOIN public.customers c ON c.id = r.customer_id
       JOIN public.invoices i ON i.id = r.invoice_id
       JOIN public.invoice_adjustments a ON a.id = r.adjustment_id
       LEFT JOIN public.users u1 ON u1.id = r.created_by
       LEFT JOIN public.users u2 ON u2.id = r.approved_by
       LEFT JOIN public.users u3 ON u3.id = r.settled_by
       WHERE r.id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund payable was not found.');
    res.json({ refund: result.rows[0] });
  }));

  // GET /api/refunds/:id/voucher (Server-side Refund Payout Voucher HTML / JSON)
  const handleRefundVoucher = async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT r.id, r.refund_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
              c.address AS customer_address, c.phone AS customer_phone, c.email AS customer_email,
              r.invoice_id, i.invoice_no, i.issue_date AS invoice_issue_date, i.total::text AS invoice_total,
              r.adjustment_id, a.credit_note_no, a.total_amount::text AS adjustment_total,
              r.amount::text, r.currency, r.status, r.reason, r.notes,
              r.created_by, u1.username AS created_by_username,
              r.approved_by, u2.username AS approved_by_username,
              r.settled_by, u3.username AS settled_by_username,
              r.created_at, r.approved_at, r.settled_at,
              r.payout_method, r.payout_reference,
              r.paid_payment_id, r.metadata
       FROM public.refund_payables r
       JOIN public.customers c ON c.id = r.customer_id
       JOIN public.invoices i ON i.id = r.invoice_id
       JOIN public.invoice_adjustments a ON a.id = r.adjustment_id
       LEFT JOIN public.users u1 ON u1.id = r.created_by
       LEFT JOIN public.users u2 ON u2.id = r.approved_by
       LEFT JOIN public.users u3 ON u3.id = r.settled_by
       WHERE r.id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund payable was not found.');
    const refund = result.rows[0];

    const companyRes = await pool.query('SELECT * FROM public.company_settings WHERE id = 1');
    const company = companyRes.rows[0] || {};

    const format = req.query.format || (req.headers.accept?.includes('application/json') ? 'json' : 'html');
    if (format === 'json') {
      return res.json({
        document_type: 'REFUND_PAYOUT_VOUCHER_MAU_02_TT',
        standard: 'THONG_TU_200_2014_TT_BTC',
        refund,
        customer: {
          name: refund.customer_name,
          tax_code: refund.customer_tax_code,
          address: refund.customer_address
        },
        company,
        amount_in_words: docTienBangChu(refund.amount),
        generated_at: new Date().toISOString()
      });
    }

    const html = renderRefundVoucherHtml({
      refund,
      customer: {
        name: refund.customer_name,
        tax_code: refund.customer_tax_code,
        address: refund.customer_address
      },
      company,
      originalInvoice: {
        id: refund.invoice_id,
        invoice_no: refund.invoice_no,
        total: refund.invoice_total
      },
      adjustment: {
        id: refund.adjustment_id,
        credit_note_no: refund.credit_note_no,
        total_amount: refund.adjustment_total
      }
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  };

  router.get('/:id/voucher', requirePermission('payment.read'), asyncRoute(handleRefundVoucher));
  router.get('/:id/print', requirePermission('payment.read'), asyncRoute(handleRefundVoucher));

  // POST /api/refunds - Request refund payable
  router.post('/', requirePermission('adjustment.create'), asyncRoute(async (req, res) => {
    requireObject(req.body);
    const rawInvoiceId = req.body.invoice_id;
    const rawAdjId = req.body.adjustment_id;
    if (!rawInvoiceId || !rawAdjId) {
      throw new AppError(400, 'INVALID_INPUT', 'invoice_id and adjustment_id are required.');
    }
    const invoiceId = parseId(rawInvoiceId, 'invoice_id');
    const adjustmentId = parseId(rawAdjId, 'adjustment_id');
    const amount = requireDecimal(req.body.amount, 'amount');
    const reason = requireText(req.body.reason, 'reason', 2000);
    const notes = requireText(req.body.notes, 'notes', 1000, { optional: true });

    const created = await inTransaction(async (client) => {
      // Validate invoice & adjustment exist
      const invRes = await client.query(
        'SELECT id, customer_id, invoice_no FROM public.invoices WHERE id = $1',
        [invoiceId]
      );
      if (!invRes.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');

      const adjRes = await client.query(
        'SELECT id, credit_note_no, original_invoice_id, status FROM public.invoice_adjustments WHERE id = $1',
        [adjustmentId]
      );
      if (!adjRes.rowCount) throw new AppError(404, 'ADJUSTMENT_NOT_FOUND', 'Adjustment was not found.');
      if (Number(adjRes.rows[0].original_invoice_id) !== Number(invoiceId)) {
        throw new AppError(409, 'ADJUSTMENT_INVOICE_MISMATCH', 'Adjustment does not belong to the specified invoice.');
      }

      const seqRes = await client.query(
        `SELECT format('REF-%s-%s', to_char(current_date, 'YYYY'),
           lpad(nextval('public.refund_no_seq')::text, 4, '0')) AS refund_no`
      );
      const refundNo = seqRes.rows[0].refund_no;

      const insertRes = await client.query(
        `INSERT INTO public.refund_payables
          (refund_no, customer_id, invoice_id, adjustment_id, amount, currency, status, reason, notes, created_by, metadata)
         VALUES ($1, $2, $3, $4, $5::numeric, 'VND', 'PENDING', $6, $7, $8, $9)
         RETURNING id, refund_no, customer_id, invoice_id, adjustment_id, amount::text, currency, status, reason, notes, created_at`,
        [
          refundNo,
          invRes.rows[0].customer_id,
          invoiceId,
          adjustmentId,
          amount,
          reason,
          notes,
          req.user.id,
          JSON.stringify({
            invoice_no: invRes.rows[0].invoice_no,
            credit_note_no: adjRes.rows[0].credit_note_no
          })
        ]
      );
      const refundRecord = insertRes.rows[0];

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'refunds',
        action: 'REFUND_REQUESTED',
        targetRef: refundRecord.refund_no,
        severity: 'INFO',
        summary: `Yêu cầu hoàn tiền ${refundRecord.refund_no} (${refundRecord.amount} ₫) cho hóa đơn #${invoiceId}`,
        metadata: refundRecord,
        throwOnError: true
      });

      return refundRecord;
    });

    res.status(201).json({ refund: created });
  }));

  // POST /api/refunds/:id/approve - Approve refund payable
  router.post('/:id/approve', requirePermission('adjustment.approve'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);

    const approvedRefund = await inTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id, refund_no, customer_id, invoice_id, adjustment_id, amount::text, status
         FROM public.refund_payables WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!locked.rowCount) {
        throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund payable was not found.');
      }
      const ref = locked.rows[0];

      if (ref.status === 'APPROVED') {
        throw new AppError(409, 'REFUND_ALREADY_APPROVED', 'This refund payable has already been approved.');
      }
      if (ref.status === 'PAID') {
        throw new AppError(409, 'REFUND_ALREADY_SETTLED', 'This refund payable has already been settled.');
      }
      if (ref.status !== 'PENDING') {
        throw new AppError(409, 'INVALID_REFUND_STATUS', `Only PENDING refunds can be approved. Current status: ${ref.status}`);
      }

      const updateRes = await client.query(
        `UPDATE public.refund_payables
         SET status = 'APPROVED', approved_by = $2, approved_at = now()
         WHERE id = $1
         RETURNING id, refund_no, customer_id, invoice_id, adjustment_id, amount::text, currency,
                   status, approved_by, approved_at, created_at`,
        [id, req.user.id]
      );
      const updated = updateRes.rows[0];

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'refunds',
        action: 'REFUND_APPROVED',
        targetRef: updated.refund_no,
        severity: 'INFO',
        summary: `Phê duyệt yêu cầu hoàn tiền ${updated.refund_no} (${updated.amount} ₫)`,
        metadata: updated,
        throwOnError: true
      });

      return updated;
    });

    res.json({ refund: approvedRefund });
  }));

  // Settlement execution logic (used by both /:id/settle and /:id/pay)
  const settleRefundHandler = asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const payoutMethod = (req.body?.payout_method || 'BANK_TRANSFER').toUpperCase();
    if (!ALLOWED_PAYOUT_METHODS.has(payoutMethod)) {
      throw new AppError(400, 'INVALID_PAYOUT_METHOD', `payout_method must be BANK_TRANSFER, CASH, or CARD. Received: ${req.body?.payout_method}`);
    }
    const payoutReference = req.body?.payout_reference ? String(req.body.payout_reference).trim() : null;
    const notes = req.body?.notes ? String(req.body.notes).trim() : null;
    const rawIdempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']).trim() : null;
    if (rawIdempotencyKey && rawIdempotencyKey.length > 255) {
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must not exceed 255 characters.');
    }
    const reqFingerprint = computeRefundSettlementFingerprint(id, { payoutMethod, payoutReference, notes });

    const settledRefund = await inTransaction(async (client) => {
      // 1. Check idempotency if key provided
      if (rawIdempotencyKey) {
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('idemp_refund'), hashtext($1))`,
          [rawIdempotencyKey]
        );
        const existingKeyRes = await client.query(
          `SELECT response_status, response_body, request_hash
           FROM public.payment_idempotency_keys
           WHERE idempotency_key = $1`,
          [rawIdempotencyKey]
        );
        if (existingKeyRes.rowCount > 0) {
          const cached = existingKeyRes.rows[0];
          if (cached.request_hash !== reqFingerprint) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
              `Idempotency-Key '${rawIdempotencyKey}' was already used with a different request payload.`);
          }
          return {
            cached: true,
            status: cached.response_status,
            data: {
              ...cached.response_body,
              is_idempotent_replay: true
            }
          };
        }
      }

      // 2. Lock refund row FOR UPDATE
      const locked = await client.query(
        `SELECT r.id, r.refund_no, r.customer_id, r.invoice_id, r.adjustment_id, r.amount::text,
                r.currency, r.status, r.reason, r.notes, r.created_by, r.approved_by
         FROM public.refund_payables r WHERE r.id = $1 FOR UPDATE`,
        [id]
      );
      if (!locked.rowCount) {
        throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund payable was not found.');
      }
      const ref = locked.rows[0];

      // 3. Strict lifecycle validation
      if (ref.status === 'PAID') {
        throw new AppError(409, 'REFUND_ALREADY_SETTLED', 'This refund payable has already been settled.');
      }
      if (ref.status === 'PENDING') {
        throw new AppError(409, 'REFUND_NOT_APPROVED', 'Only APPROVED refund payables can be settled. It must be approved first.');
      }
      if (ref.status !== 'APPROVED') {
        throw new AppError(409, 'INVALID_REFUND_STATUS', `Cannot settle refund with status: ${ref.status}`);
      }

      // 4. Update status to PAID and record payout attributes
      const updateRes = await client.query(
        `UPDATE public.refund_payables
         SET status = 'PAID',
             settled_at = now(),
             settled_by = $2,
             payout_method = $3,
             payout_reference = $4,
             notes = coalesce($5, notes)
         WHERE id = $1
         RETURNING id, refund_no, customer_id, invoice_id, adjustment_id, amount::text, currency,
                   status, approved_by, approved_at, settled_by, settled_at, payout_method, payout_reference,
                   notes, created_at`,
        [id, req.user.id, payoutMethod, payoutReference, notes]
      );
      const settled = updateRes.rows[0];

      // 5. Transaction-coupled audit
      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'refunds',
        action: 'REFUND_SETTLED',
        targetRef: settled.refund_no,
        severity: 'INFO',
        summary: `Thực hiện chi trả hoàn tiền ${settled.refund_no} (${settled.amount} ₫) qua ${settled.payout_method}`,
        metadata: settled,
        throwOnError: true
      });

      // 6. Record idempotency if key was provided
      const responsePayload = { refund: settled, settled: true };
      if (rawIdempotencyKey) {
        await client.query(
          `INSERT INTO public.payment_idempotency_keys
            (idempotency_key, request_hash, response_status, response_body, created_by)
           VALUES ($1, $2, 200, $3::jsonb, $4)`,
          [rawIdempotencyKey, reqFingerprint, JSON.stringify(responsePayload), req.user.id]
        );
      }

      return { cached: false, data: responsePayload };
    });

    if (settledRefund.cached) {
      return res.status(settledRefund.status).json(settledRefund.data);
    }
    res.json(settledRefund.data);
  });

  // POST /api/refunds/:id/settle & POST /api/refunds/:id/pay
  router.post('/:id/settle', requirePermission('payment.create'), settleRefundHandler);
  router.post('/:id/pay', requirePermission('payment.create'), settleRefundHandler);

  return router;
}

module.exports = { refundsRouter };
