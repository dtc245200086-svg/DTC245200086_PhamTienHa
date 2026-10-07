const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requireRole, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');

const ADJUSTMENT_TYPES = new Set(['DISCOUNT', 'DECREASE_AMOUNT', 'SERVICE_RETURN', 'INFO_CORRECTION']);
const TYPE_ALIAS_MAP = {
  'CREDIT_NOTE': 'DECREASE_AMOUNT',
  'DEBIT_NOTE': 'INFO_CORRECTION',
  'REPLACEMENT': 'INFO_CORRECTION',
  'DISCOUNT': 'DISCOUNT',
  'DECREASE_AMOUNT': 'DECREASE_AMOUNT',
  'SERVICE_RETURN': 'SERVICE_RETURN',
  'INFO_CORRECTION': 'INFO_CORRECTION'
};
const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

function adjustmentsRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/adjustments
  router.get('/', asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const rawInvoiceId = req.query.invoice_id || req.query.original_invoice_id;
    const invoiceId = rawInvoiceId ? parseId(rawInvoiceId, 'invoice_id') : null;
    const status = req.query.status ? req.query.status : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT a.id, a.credit_note_no, a.credit_note_no AS adjustment_no,
                a.original_invoice_id, a.original_invoice_id AS invoice_id,
                i.invoice_no AS original_invoice_no, i.invoice_no AS target_invoice_no,
                c.name AS customer_name, c.tax_code AS customer_tax_code,
                a.adjustment_type, a.adjustment_type AS type,
                a.amount::text, a.vat_rate::text, a.vat_amount::text,
                a.total_amount::text, a.reason, a.status, a.notes,
                a.created_by, u1.username AS created_by_username,
                a.approved_by, u2.username AS approved_by_username,
                a.created_at, a.approved_at
         FROM public.invoice_adjustments a
         JOIN public.invoices i ON i.id = a.original_invoice_id
         JOIN public.customers c ON c.id = i.customer_id
         LEFT JOIN public.users u1 ON u1.id = a.created_by
         LEFT JOIN public.users u2 ON u2.id = a.approved_by
         WHERE ($1::bigint IS NULL OR a.original_invoice_id = $1)
           AND ($2::text IS NULL OR a.status = $2)
         ORDER BY a.id DESC LIMIT $3 OFFSET $4`,
        [invoiceId, status, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.invoice_adjustments a
         WHERE ($1::bigint IS NULL OR a.original_invoice_id = $1)
           AND ($2::text IS NULL OR a.status = $2)`,
        [invoiceId, status]
      )
    ]);

    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  // GET /api/adjustments/:id
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT a.id, a.credit_note_no, a.credit_note_no AS adjustment_no,
              a.original_invoice_id, a.original_invoice_id AS invoice_id,
              i.invoice_no AS original_invoice_no, i.invoice_no AS target_invoice_no,
              c.name AS customer_name, c.tax_code AS customer_tax_code,
              a.adjustment_type, a.adjustment_type AS type,
              a.amount::text, a.vat_rate::text, a.vat_amount::text,
              a.total_amount::text, a.reason, a.status, a.notes,
              a.created_by, u1.username AS created_by_username,
              a.approved_by, u2.username AS approved_by_username,
              a.created_at, a.approved_at
       FROM public.invoice_adjustments a
       JOIN public.invoices i ON i.id = a.original_invoice_id
       JOIN public.customers c ON c.id = i.customer_id
       LEFT JOIN public.users u1 ON u1.id = a.created_by
       LEFT JOIN public.users u2 ON u2.id = a.approved_by
       WHERE a.id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'ADJUSTMENT_NOT_FOUND', 'Adjustment was not found.');
    res.json({ adjustment: result.rows[0] });
  }));

  // POST /api/adjustments (Support both original_invoice_id / invoice_id & adjustment_type / type)
  router.post('/', requirePermission('adjustment.create'), asyncRoute(async (req, res) => {
    requireObject(req.body);
    const rawInvoiceId = req.body.original_invoice_id || req.body.invoice_id;
    if (!rawInvoiceId) throw new AppError(400, 'INVALID_ID', 'original_invoice_id or invoice_id is required.');
    const invoiceId = parseId(rawInvoiceId, 'original_invoice_id');

    const rawType = req.body.adjustment_type || req.body.type || 'DISCOUNT';
    const normalizedType = TYPE_ALIAS_MAP[rawType] || rawType;
    if (!ADJUSTMENT_TYPES.has(normalizedType)) {
      throw new AppError(400, 'INVALID_ADJUSTMENT_TYPE', `adjustment_type must be DISCOUNT, DECREASE_AMOUNT, SERVICE_RETURN, or INFO_CORRECTION. Received: ${rawType}`);
    }

    const amount = requireDecimal(req.body.amount, 'amount');
    const vatRate = requireDecimal(req.body.vat_rate === undefined ? '0.10' : String(req.body.vat_rate), 'vat_rate', TAX_RATE);
    const reason = requireText(req.body.reason, 'reason', 2000);
    const notes = requireText(req.body.notes, 'notes', 1000, { optional: true });

    const created = await inTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id, invoice_no, customer_id, status, total::text, paid_total::text, adjusted_total::text
         FROM public.invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );
      if (!locked.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const invoice = locked.rows[0];
      if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
        throw new AppError(409, 'INVOICE_NOT_ADJUSTABLE', 'Adjustments can only be issued for issued or paid invoices.');
      }

      const seqRes = await client.query(
        `SELECT format('ADJ-%s-%s', to_char(current_date, 'YYYY'),
           lpad(nextval('public.adjustment_no_seq')::text, 4, '0')) AS credit_note_no`
      );
      const creditNoteNo = seqRes.rows[0].credit_note_no;

      const numAmt = Number(amount);
      const numVatRate = Number(vatRate);
      const vatAmount = Math.round(numAmt * numVatRate * 100) / 100;
      const totalAmount = Math.round((numAmt + vatAmount) * 100) / 100;

      const currentAdjusted = Number(invoice.adjusted_total || 0);
      const invTotal = Number(invoice.total);
      if (currentAdjusted + totalAmount > invTotal) {
        throw new AppError(409, 'ADJUSTMENT_EXCEEDS_INVOICE_TOTAL',
          `Total adjustments (${(currentAdjusted + totalAmount).toFixed(2)} ₫) cannot exceed invoice total (${invTotal.toFixed(2)} ₫).`);
      }

      const result = await client.query(
        `INSERT INTO public.invoice_adjustments
          (credit_note_no, original_invoice_id, adjustment_type, amount, vat_rate, vat_amount, total_amount, reason, status, notes, created_by)
         VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8, 'DRAFT', $9, $10)
         RETURNING id, credit_note_no, original_invoice_id, adjustment_type, amount::text, vat_amount::text, total_amount::text, reason, status, created_at`,
        [creditNoteNo, invoiceId, normalizedType, amount, vatRate, vatAmount, totalAmount, reason, notes, req.user.id]
      );
      return result.rows[0];
    });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'adjustments',
      action: 'CREDIT_NOTE_CREATED',
      targetRef: created.credit_note_no,
      severity: 'INFO',
      summary: `Tạo dự thảo biên bản điều chỉnh ${created.credit_note_no} cho hóa đơn #${invoiceId} (${created.total_amount} ₫)`,
      metadata: created
    });

    res.status(201).json({
      adjustment: {
        ...created,
        adjustment_no: created.credit_note_no,
        type: created.adjustment_type,
        invoice_id: created.original_invoice_id
      }
    });
  }));

  // POST /api/adjustments/:id/approve
  router.post('/:id/approve', requirePermission('adjustment.approve'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const updated = await pool.query(
      `UPDATE public.invoice_adjustments
       SET status = 'APPROVED', approved_by = $2, approved_at = now()
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING id, credit_note_no, original_invoice_id, total_amount::text, status, approved_at`,
      [id, req.user.id]
    );
    if (!updated.rowCount) {
      throw new AppError(404, 'ADJUSTMENT_NOT_DRAFT', 'Adjustment was not found or is not in DRAFT status.');
    }
    const adjustment = updated.rows[0];

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'adjustments',
      action: 'ADJUSTMENT_APPROVED',
      targetRef: adjustment.credit_note_no,
      severity: 'INFO',
      summary: `Phê duyệt biên bản điều chỉnh ${adjustment.credit_note_no}`,
      metadata: adjustment
    });

    res.json({ adjustment });
  }));

  // POST /api/adjustments/:id/process (Real Financial Settlement)
  router.post('/:id/process', requirePermission('adjustment.approve'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);

    const result = await inTransaction(async (client) => {
      // 1. Lock adjustment
      const adjRes = await client.query(
        `SELECT id, credit_note_no, original_invoice_id, adjustment_type, total_amount::text, status, reason
         FROM public.invoice_adjustments WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!adjRes.rowCount) throw new AppError(404, 'ADJUSTMENT_NOT_FOUND', 'Adjustment was not found.');
      const adj = adjRes.rows[0];
      if (adj.status === 'PROCESSED') {
        throw new AppError(409, 'ADJUSTMENT_ALREADY_PROCESSED', 'This adjustment has already been processed.');
      }
      if (adj.status !== 'APPROVED') {
        throw new AppError(409, 'ADJUSTMENT_NOT_APPROVED', 'Only APPROVED adjustments can be processed into the ledger.');
      }

      // 2. Lock invoice
      const invRes = await client.query(
        `SELECT id, invoice_no, customer_id, status, total::text, paid_total::text, adjusted_total::text,
                (total - paid_total - adjusted_total)::numeric(14, 2) AS outstanding
         FROM public.invoices WHERE id = $1 FOR UPDATE`,
        [adj.original_invoice_id]
      );
      if (!invRes.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Target invoice for adjustment was not found.');
      const inv = invRes.rows[0];

      const adjAmount = Number(adj.total_amount);
      const outstanding = Number(inv.outstanding);
      const invTotal = Number(inv.total);
      const currentAdjusted = Number(inv.adjusted_total || 0);

      // Financial validation: Cumulative adjustments on invoice cannot exceed invoice total capacity
      if (currentAdjusted + adjAmount > invTotal) {
        throw new AppError(409, 'ADJUSTMENT_EXCEEDS_INVOICE_TOTAL',
          `Total adjustments (${(currentAdjusted + adjAmount).toFixed(2)} ₫) cannot exceed invoice total (${invTotal.toFixed(2)} ₫).`);
      }

      // Calculate AR reduction vs Refund payable (P1.1 Domain Design)
      const outstandingSafe = Math.max(0, outstanding);
      const arReduction = Math.min(adjAmount, outstandingSafe);
      const refundPayable = Math.max(0, Math.round((adjAmount - outstandingSafe) * 100) / 100);

      // 3. Update invoice adjusted_total and status (DO NOT insert into payments table!)
      // P1.1: adjusted_total ONLY increases by arReduction so that (paid_total + adjusted_total <= total) invariant is strictly preserved!
      const updatedInvRes = await client.query(
        `UPDATE public.invoices
         SET adjusted_total = adjusted_total + $2::numeric,
             status = CASE 
               WHEN paid_total + adjusted_total + $2::numeric >= total THEN 'PAID'
               WHEN status = 'OVERDUE' THEN 'OVERDUE'
               ELSE 'PARTIALLY_PAID' 
             END
         WHERE id = $1
         RETURNING id, invoice_no, status, total::text, paid_total::text, adjusted_total::text,
                   (total - paid_total - adjusted_total)::numeric(14, 2)::text AS outstanding`,
        [inv.id, arReduction.toFixed(2)]
      );

      // 4. Create refund payable in public.refund_payables if refundPayable > 0 (P1.1 Refund Ledger)
      let refundRecord = null;
      if (refundPayable > 0) {
        const refSeqRes = await client.query(
          `SELECT format('REF-%s-%s', to_char(current_date, 'YYYY'),
             lpad(nextval('public.refund_no_seq')::text, 4, '0')) AS refund_no`
        );
        const refundNo = refSeqRes.rows[0].refund_no;

        const refundInsertRes = await client.query(
          `INSERT INTO public.refund_payables
            (refund_no, customer_id, invoice_id, adjustment_id, amount, currency, status, reason, notes, created_by, metadata)
           VALUES ($1, $2, $3, $4, $5::numeric, 'VND', 'PENDING', $6, $7, $8, $9)
           RETURNING id, refund_no, customer_id, invoice_id, adjustment_id, amount::text, currency, status, reason, notes, created_at`,
          [
            refundNo,
            inv.customer_id,
            inv.id,
            adj.id,
            refundPayable.toFixed(2),
            adj.reason || 'Khoản tiền phải hoàn trả phát sinh từ Credit Note',
            `Phát sinh từ Credit Note ${adj.credit_note_no} cho hóa đơn ${inv.invoice_no}`,
            req.user.id,
            JSON.stringify({
              invoice_no: inv.invoice_no,
              credit_note_no: adj.credit_note_no,
              adjustment_amount: adj.total_amount,
              ar_reduction: arReduction.toFixed(2),
              outstanding_before: outstanding.toFixed(2)
            })
          ]
        );
        refundRecord = refundInsertRes.rows[0];
      }

      // 5. Update adjustment status to PROCESSED
      await client.query(
        `UPDATE public.invoice_adjustments SET status = 'PROCESSED' WHERE id = $1`,
        [id]
      );

      return {
        adjustment: { ...adj, status: 'PROCESSED' },
        invoice: updatedInvRes.rows[0],
        ar_reduction: arReduction.toFixed(2),
        refund_payable: refundPayable.toFixed(2),
        refund: refundRecord
      };
    });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'adjustments',
      action: 'ADJUSTMENT_PROCESSED',
      targetRef: result.adjustment.credit_note_no,
      severity: 'INFO',
      summary: `Xử lý áp dụng Credit Note ${result.adjustment.credit_note_no}: Giảm trừ công nợ ${result.ar_reduction} ₫ (Khoản phải hoàn: ${result.refund_payable} ₫) cho hóa đơn ${result.invoice.invoice_no}`,
      metadata: result
    });

    res.json({
      adjustment: result.adjustment,
      invoice: result.invoice,
      ar_reduction: result.ar_reduction,
      refund_payable: result.refund_payable,
      refund: result.refund
    });
  }));

  return router;
}

module.exports = { adjustmentsRouter };
