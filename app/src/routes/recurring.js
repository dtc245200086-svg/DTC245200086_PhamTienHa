const express = require('express');
const crypto = require('node:crypto');
const { AppError, asyncRoute } = require('../errors');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');
const { calculateNextSafeDate } = require('../scheduler');
const { PaymentService } = require('../services/paymentService');
const CustomerCreditService = require('../services/customerCreditService');
const PaymentTermsService = require('../services/paymentTermsService');
const { sendCsvResponse } = require('../csv');

const FREQUENCIES = new Set(['Hàng tháng', 'Hàng quý', 'Hàng năm', 'MONTHLY', 'QUARTERLY', 'YEARLY']);
const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;
const FREQUENCY_MAP = {
  'MONTHLY': 'Hàng tháng',
  'QUARTERLY': 'Hàng quý',
  'YEARLY': 'Hàng năm',
  'Hàng tháng': 'Hàng tháng',
  'Hàng quý': 'Hàng quý',
  'Hàng năm': 'Hàng năm'
};

function computeRecurringTriggerFingerprint(planId) {
  const normalized = {
    action: 'RECURRING_TRIGGER',
    planId: String(planId)
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function recurringRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/recurring-plans (or /api/recurring)
  router.get('/', requirePermission('recurring.manage'), asyncRoute(async (req, res) => {
    const { page, limit, page_size, offset } = parsePage(req.query);
    const status = req.query.status ? req.query.status : null;
    const rawFreq = req.query.frequency || req.query.billing_cycle || null;
    const frequency = rawFreq ? (FREQUENCY_MAP[rawFreq] || rawFreq) : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT r.id, r.code, r.code AS plan_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
                r.service_title, r.contract_ref, r.frequency, r.frequency AS billing_cycle,
                r.amount_per_period::text, r.amount_per_period::text AS amount,
                r.next_run_date, r.next_run_date AS next_billing_date,
                r.completed_cycles, r.completed_cycles AS invoices_generated,
                r.total_cycles, r.status, r.auto_sign, r.auto_settle_unapplied,
                r.last_error, r.created_at
         FROM public.recurring_plans r
         JOIN public.customers c ON c.id = r.customer_id
         WHERE ($1::text IS NULL OR r.status = $1)
           AND ($2::text IS NULL OR r.frequency = $2 OR r.frequency = $3)
           AND ($4::text IS NULL OR r.code ILIKE $4 OR c.name ILIKE $4 OR r.service_title ILIKE $4 OR r.contract_ref ILIKE $4 OR r.status ILIKE $4)
         ORDER BY r.id DESC LIMIT $5 OFFSET $6`,
        [status, frequency, rawFreq, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.recurring_plans r
         JOIN public.customers c ON c.id = r.customer_id
         WHERE ($1::text IS NULL OR r.status = $1)
           AND ($2::text IS NULL OR r.frequency = $2 OR r.frequency = $3)
           AND ($4::text IS NULL OR r.code ILIKE $4 OR c.name ILIKE $4 OR r.service_title ILIKE $4 OR r.contract_ref ILIKE $4 OR r.status ILIKE $4)`,
        [status, frequency, rawFreq, pattern]
      )
    ]);

    res.json({ items: items.rows, total: Number(count.rows[0].total), page, limit, page_size: limit });
  }));

  // GET /api/recurring/export.csv (Server-side unpaginated CSV export with exact query filter consistency)
  router.get('/export.csv', requirePermission('recurring.manage'), asyncRoute(async (req, res) => {
    const status = req.query.status ? req.query.status : null;
    const rawFreq = req.query.frequency || req.query.billing_cycle || null;
    const frequency = rawFreq ? (FREQUENCY_MAP[rawFreq] || rawFreq) : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const items = await pool.query(
      `SELECT r.id, r.code, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
              r.service_title, r.frequency, r.amount_per_period::text,
              r.next_run_date, r.completed_cycles, r.status
       FROM public.recurring_plans r
       JOIN public.customers c ON c.id = r.customer_id
       WHERE ($1::text IS NULL OR r.status = $1)
         AND ($2::text IS NULL OR r.frequency = $2 OR r.frequency = $3)
         AND ($4::text IS NULL OR r.code ILIKE $4 OR c.name ILIKE $4 OR r.service_title ILIKE $4 OR r.contract_ref ILIKE $4 OR r.status ILIKE $4)
       ORDER BY r.id DESC`,
      [status, frequency, rawFreq, pattern]
    );

    const headers = ['Mã thuê bao', 'Khách hàng', 'MST', 'Tên dịch vụ', 'Chu kỳ', 'Số tiền mỗi kỳ (VND)', 'Kỳ tiếp theo', 'Đã sinh (kỳ)', 'Trạng thái'];
    const rows = items.rows.map(p => [
      p.code || '',
      p.customer_name || '',
      p.customer_tax_code || '',
      p.service_title || '',
      p.frequency || '',
      p.amount_per_period || '0',
      p.next_run_date ? new Date(p.next_run_date).toISOString().slice(0, 10) : '',
      p.completed_cycles || '0',
      p.status || ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `thue_bao_dinh_ky_${dateStr}.csv`,
      headers,
      rows
    });
  }));

  // GET /api/recurring-plans/:id
  router.get('/:id', requirePermission('recurring.manage'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT r.id, r.code, r.code AS plan_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
              r.service_title, r.contract_ref, r.frequency, r.frequency AS billing_cycle,
              r.amount_per_period::text, r.amount_per_period::text AS amount,
              r.next_run_date, r.next_run_date AS next_billing_date,
              r.completed_cycles, r.completed_cycles AS invoices_generated,
              r.total_cycles, r.status, r.auto_sign, r.auto_settle_unapplied,
              r.last_error, r.created_at
       FROM public.recurring_plans r
       JOIN public.customers c ON c.id = r.customer_id
       WHERE r.id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'RECURRING_PLAN_NOT_FOUND', 'Recurring plan was not found.');
    res.json({ plan: result.rows[0] });
  }));

  // POST /api/recurring-plans
  router.post('/', requirePermission('recurring.manage'), asyncRoute(async (req, res) => {
    requireObject(req.body);
    const customerId = parseId(req.body.customer_id, 'customer_id');
    const serviceTitle = requireText(req.body.service_title || 'Dịch vụ định kỳ', 'service_title', 255);
    const contractRef = requireText(req.body.contract_ref, 'contract_ref', 64, { optional: true });

    const rawFreq = req.body.frequency || req.body.billing_cycle || 'Hàng tháng';
    const frequency = FREQUENCY_MAP[rawFreq] || rawFreq;
    const rawAmt = req.body.amount_per_period || req.body.amount;
    const amount = requireDecimal(rawAmt, 'amount_per_period');
    const rawDate = req.body.next_run_date || req.body.start_date || new Date().toISOString().slice(0, 10);
    const nextRunDate = requireDate(rawDate, 'next_run_date');
    const totalCycles = req.body.total_cycles ? Number(req.body.total_cycles) : null;
    const autoSign = Boolean(req.body.auto_sign);
    const autoSettleUnapplied = req.body.auto_settle_unapplied === undefined ? true : Boolean(req.body.auto_settle_unapplied);
    const hasExplicitVat = req.body.vat_rate !== undefined && req.body.vat_rate !== null;
    const vatRate = hasExplicitVat ? requireDecimal(String(req.body.vat_rate), 'vat_rate', TAX_RATE) : null;
    const paymentTermId = req.body.payment_term_id ? parseId(req.body.payment_term_id, 'payment_term_id') : null;

    if (!FREQUENCIES.has(frequency)) {
      throw new AppError(400, 'INVALID_FREQUENCY', 'frequency must be Hàng tháng, Hàng quý, or Hàng năm.');
    }

    const plan = await inTransaction(async (client) => {
      const seqRes = await client.query(
        `SELECT format('REC-%s-%s', to_char(current_date, 'YYYY'),
           lpad(nextval('public.recurring_plan_no_seq')::text, 4, '0')) AS code`
      );
      const code = seqRes.rows[0].code;

      const insertSql = hasExplicitVat
        ? `INSERT INTO public.recurring_plans
            (code, customer_id, service_title, contract_ref, frequency, amount_per_period, next_run_date, total_cycles, auto_sign, auto_settle_unapplied, vat_rate, payment_term_id, status)
           VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11::numeric, $12, 'ACTIVE')
           RETURNING id, code, customer_id, service_title, contract_ref, frequency,
                     amount_per_period::text, next_run_date, completed_cycles, total_cycles, status, auto_sign, auto_settle_unapplied,
                     vat_rate::text, payment_term_id, created_at`
        : `INSERT INTO public.recurring_plans
            (code, customer_id, service_title, contract_ref, frequency, amount_per_period, next_run_date, total_cycles, auto_sign, auto_settle_unapplied, vat_rate, payment_term_id, status)
           VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, DEFAULT, $11, 'ACTIVE')
           RETURNING id, code, customer_id, service_title, contract_ref, frequency,
                     amount_per_period::text, next_run_date, completed_cycles, total_cycles, status, auto_sign, auto_settle_unapplied,
                     vat_rate::text, payment_term_id, created_at`;

      const insertParams = hasExplicitVat
        ? [code, customerId, serviceTitle, contractRef, frequency, amount, nextRunDate, totalCycles, autoSign, autoSettleUnapplied, vatRate, paymentTermId]
        : [code, customerId, serviceTitle, contractRef, frequency, amount, nextRunDate, totalCycles, autoSign, autoSettleUnapplied, paymentTermId];

      const result = await client.query(insertSql, insertParams);
      const created = result.rows[0];

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'recurring',
        action: 'RECURRING_PLAN_CREATED',
        targetRef: created.code,
        severity: 'INFO',
        summary: `Tạo kế hoạch định kỳ ${created.code}: ${created.service_title} (${created.amount_per_period} ₫ / ${created.frequency})`,
        metadata: created,
        throwOnError: true
      });

      return created;
    });

    res.status(201).json({
      plan: {
        ...plan,
        plan_no: plan.code,
        billing_cycle: plan.frequency,
        amount: plan.amount_per_period,
        next_billing_date: plan.next_run_date,
        vat_rate: plan.vat_rate,
        payment_term_id: plan.payment_term_id
      }
    });
  }));

  // PUT /api/recurring-plans/:id/status (and POST /:id/toggle-status)
  const statusUpdateHandler = asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);

    const updated = await inTransaction(async (client) => {
      const current = await client.query('SELECT id, code, status FROM public.recurring_plans WHERE id = $1', [id]);
      if (!current.rowCount) throw new AppError(404, 'RECURRING_PLAN_NOT_FOUND', 'Recurring plan was not found.');

      let newStatus = req.body?.status;
      if (!newStatus) {
        newStatus = current.rows[0].status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      }

      const resUpdate = await client.query(
        `UPDATE public.recurring_plans SET status = $2 WHERE id = $1 RETURNING id, code, status`,
        [id, newStatus]
      );

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'recurring',
        action: 'RECURRING_STATUS_CHANGED',
        targetRef: current.rows[0].code,
        severity: 'INFO',
        summary: `Đổi trạng thái hợp đồng định kỳ ${current.rows[0].code} sang ${newStatus}`,
        throwOnError: true
      });

      return resUpdate.rows[0];
    });

    res.json({ plan: updated });
  });

  router.post('/:id/toggle-status', requirePermission('recurring.manage'), statusUpdateHandler);
  router.put('/:id/status', requirePermission('recurring.manage'), statusUpdateHandler);

  // POST /api/recurring-plans/:id/trigger (Execute Recurring Generation)
  router.post('/:id/trigger', requirePermission('recurring.manage'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const rawIdempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']).trim() : null;
    if (rawIdempotencyKey && rawIdempotencyKey.length > 255) {
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must not exceed 255 characters.');
    }
    const reqFingerprint = computeRecurringTriggerFingerprint(id);

    let generated;
    try {
      generated = await inTransaction(async (client) => {
        // 1. Check idempotency if key provided
        if (rawIdempotencyKey) {
          await client.query(
            `SELECT pg_advisory_xact_lock(hashtext('idemp_recurring'), hashtext($1))`,
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
              ...cached.response_body,
              is_idempotent_replay: true
            };
          }
        }

        const planRes = await client.query(
          `SELECT r.id, r.code, r.customer_id, r.service_title, r.contract_ref,
                  r.frequency, r.amount_per_period::text, r.next_run_date,
                  r.completed_cycles, r.total_cycles, r.status, r.auto_sign,
                  r.auto_settle_unapplied, r.vat_rate::text, r.payment_term_id,
                  c.payment_term_id AS customer_payment_term_id,
                  c.name AS customer_name
           FROM public.recurring_plans r
           JOIN public.customers c ON c.id = r.customer_id
           WHERE r.id = $1 FOR UPDATE`,
          [id]
        );
        if (!planRes.rowCount) throw new AppError(404, 'RECURRING_PLAN_NOT_FOUND', 'Recurring plan was not found.');
        const plan = planRes.rows[0];

        if (plan.status !== 'ACTIVE') {
          throw new AppError(409, 'PLAN_NOT_ACTIVE', 'Only ACTIVE recurring plans can be triggered.');
        }

        // Check company credit control setting
        const settingsRes = await client.query(
          'SELECT credit_control_enabled FROM public.company_settings WHERE id = 1'
        );
        const creditControlEnabled = settingsRes.rows[0]?.credit_control_enabled !== false;

        const planVatRate = plan.vat_rate;
        if (planVatRate === null || planVatRate === undefined) {
          throw new AppError(400, 'RECURRING_PLAN_VAT_RATE_REQUIRED', `Kế hoạch định kỳ ${plan.code} thiếu thông tin vat_rate.`);
        }

        // Authoritative decimal calculation via PostgreSQL NUMERIC to eliminate JavaScript floating-point errors
        const calcRes = await client.query(
          `SELECT
             ($1::numeric(14, 2))::text AS unit_price,
             round(($1::numeric(14, 2)) * ($2::numeric(5, 4)), 2)::text AS vat_amount,
             (($1::numeric(14, 2)) + round(($1::numeric(14, 2)) * ($2::numeric(5, 4)), 2))::text AS total_amount`,
          [plan.amount_per_period, planVatRate]
        );
        const { unit_price: unitPrice, vat_amount: vatAmountStr, total_amount: projectedTotal } = calcRes.rows[0];

        // Customer credit risk pre-issuance check
        if (creditControlEnabled) {
          try {
            await CustomerCreditService.checkInvoiceIssueEligibility(client, {
              customerId: plan.customer_id,
              invoiceTotal: projectedTotal
            });
          } catch (riskErr) {
            riskErr.plan_code = plan.code;
            riskErr.customer_name = plan.customer_name;
            throw riskErr;
          }
        }

      // Authoritative due date resolution
      const curDateRes = await client.query('SELECT current_date::text AS cd');
      const currentDate = curDateRes.rows[0].cd;
      const termResolution = await PaymentTermsService.calculateAuthoritativeDueDate(client, {
        paymentTermId: plan.payment_term_id,
        customerId: plan.customer_id,
        baseDate: currentDate
      });
      const dueDate = termResolution.dueDate;
      const paymentTermId = termResolution.term?.id || plan.payment_term_id || null;

      // 1. Create invoice in DRAFT
      const invRes = await client.query(
        `INSERT INTO public.invoices (customer_id, due_date, tax_rate, payment_term_id, notes, created_by)
         VALUES ($1, $2, $3::numeric, $4, $5, $6) RETURNING id`,
        [plan.customer_id, dueDate, planVatRate, paymentTermId, `Phát sinh định kỳ theo hợp đồng ${plan.contract_ref || plan.code}`, req.user.id]
      );
      const invoiceId = invRes.rows[0].id;

      // 2. Add line item with authoritative VAT columns
      const cycleNumber = plan.completed_cycles + 1;
      await client.query(
        `INSERT INTO public.invoice_items
          (invoice_id, description, quantity, unit_price, line_total, vat_rate, vat_amount, total_amount)
         VALUES ($1, $2, 1, $3::numeric, $3::numeric, $4::numeric, $5::numeric, $6::numeric)`,
        [
          invoiceId,
          `${plan.service_title} (Kỳ cước ${cycleNumber})`,
          unitPrice,
          planVatRate,
          vatAmountStr,
          projectedTotal
        ]
      );

      // 3. Recalculate totals
      await client.query(
        `UPDATE public.invoices AS invoice
         SET subtotal = totals.subtotal,
             tax_amount = totals.tax_amount,
             total = totals.subtotal + totals.tax_amount
         FROM (
           SELECT coalesce(sum(line_total), 0)::numeric(14, 2) AS subtotal,
                  coalesce(sum(vat_amount), 0)::numeric(14, 2) AS tax_amount
           FROM public.invoice_items WHERE invoice_id = $1
         ) AS totals
         WHERE invoice.id = $1`,
        [invoiceId]
      );

      let invoiceNo = null;
      let eInvoiceCode = null;
      // 4. If auto_sign, issue immediately
      if (plan.auto_sign) {
        const seqRes = await client.query(
          `SELECT format('INV-%s-%s', to_char(current_date, 'YYYY'),
             lpad(nextval('public.invoice_no_seq')::text, 6, '0')) AS invoice_no`
        );
        invoiceNo = seqRes.rows[0].invoice_no;
        eInvoiceCode = `1C25TND-${invoiceNo.split('-')[2]}`;
        await client.query(
          `UPDATE public.invoices
           SET invoice_no = $2, e_invoice_code = $3, status = 'ISSUED', issue_date = current_date
           WHERE id = $1`,
          [invoiceId, invoiceNo, eInvoiceCode]
        );
      }

      // 5. Advance recurring plan cycles and next run date using safe date arithmetic
      const newCycles = cycleNumber;
      const nextRunDate = calculateNextSafeDate(plan.next_run_date, plan.frequency);
      const isCompleted = plan.total_cycles && newCycles >= plan.total_cycles;
      const nextStatus = isCompleted ? 'COMPLETED' : 'ACTIVE';

      await client.query(
        `UPDATE public.recurring_plans
         SET completed_cycles = $2, next_run_date = $3, status = $4, last_error = null
         WHERE id = $1`,
        [id, newCycles, nextRunDate, nextStatus]
      );

      const genData = {
        invoice_id: invoiceId,
        invoice_no: invoiceNo || `DRAFT-${invoiceId}`,
        plan_code: plan.code,
        completed_cycles: newCycles,
        next_run_date: nextRunDate,
        status: nextStatus,
        customer_id: plan.customer_id,
        auto_sign: Boolean(plan.auto_sign),
        auto_settle_unapplied: Boolean(plan.auto_settle_unapplied)
      };

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'recurring',
        action: 'RECURRING_INVOICE_GENERATED',
        targetRef: genData.invoice_no,
        severity: 'INFO',
        summary: `Sinh hóa đơn định kỳ ${genData.invoice_no} cho hợp đồng ${genData.plan_code} (Chu kỳ ${genData.completed_cycles})`,
        metadata: genData,
        throwOnError: true
      });

      // 6. Record idempotency if key was provided
      if (rawIdempotencyKey) {
        await client.query(
          `INSERT INTO public.payment_idempotency_keys
            (idempotency_key, request_hash, response_status, response_body, created_by)
           VALUES ($1, $2, 200, $3::jsonb, $4)`,
          [rawIdempotencyKey, reqFingerprint, JSON.stringify(genData), req.user.id]
        );
      }

      return genData;
    });
  } catch (err) {
    if (err.code === 'CREDIT_LIMIT_EXCEEDED' || err.code === 'CUSTOMER_IS_LOCKED') {
      await inTransaction(async (auditClient) => {
        await auditClient.query('UPDATE public.recurring_plans SET last_error = $2 WHERE id = $1', [id, err.message]);
        await recordAudit(auditClient, {
          user: req.user,
          ip: req.ip,
          module: 'recurring',
          action: 'RECURRING_INVOICE_BLOCKED_BY_RISK',
          targetRef: err.plan_code || `#PLAN-${id}`,
          severity: 'WARNING',
          summary: `Chặn sinh hóa đơn định kỳ cho hợp đồng ${err.plan_code || id}: ${err.message}`,
          metadata: {
            plan_id: id,
            error_code: err.code,
            error_message: err.message,
            details: err.details || null
          },
          throwOnError: true
        });
      });
    }
    throw err;
  }

    let autoSettled = null;
    if (generated.auto_sign && generated.auto_settle_unapplied) {
      const autoAllocKey = `RECURRING-AUTO-ALLOC-INV-${generated.invoice_id}-PLAN-${id}`;
      try {
        autoSettled = await inTransaction(async (allocClient) => {
          const allocRes = await PaymentService.autoAllocateUnappliedCash(allocClient, {
            customerId: generated.customer_id,
            invoiceId: generated.invoice_id,
            recordedBy: req.user.id,
            idempotencyKey: autoAllocKey,
            source: 'SCHEDULER'
          });

          if (!allocRes.is_idempotent_replay) {
            await recordAudit(allocClient, {
              user: req.user,
              ip: req.ip,
              module: 'payments',
              action: 'PAYMENT_AUTO_ALLOCATED',
              targetRef: allocRes.invoice_no || `INV-${generated.invoice_id}`,
              severity: 'INFO',
              summary: `Tự động phân bổ ${allocRes.allocated_total} ₫ từ ${allocRes.allocations_count} khoản tiền thừa cho hóa đơn định kỳ ${allocRes.invoice_no} (Nguồn: MANUAL_RECURRING_TRIGGER)`,
              metadata: {
                invoice_id: allocRes.invoice_id,
                invoice_no: allocRes.invoice_no,
                allocated_total: allocRes.allocated_total,
                allocations_count: allocRes.allocations_count,
                payment_ids: allocRes.payment_ids,
                idempotency_key: autoAllocKey,
                invoice_status: allocRes.invoice_status,
                settlement_type: allocRes.settlement_type,
                allocated_from_unapplied: allocRes.allocated_from_unapplied,
                previous_paid_total: allocRes.previous_paid_total,
                new_paid_total: allocRes.new_paid_total,
                allocations: allocRes.allocations,
                remaining_unapplied_cash: allocRes.remaining_unapplied_cash
              },
              throwOnError: true
            });
          }

          return allocRes;
        });
      } catch (allocErr) {
        // Normal condition if no unapplied cash available
      }
    }

    res.json({
      invoice_id: generated.invoice_id,
      invoice_no: generated.invoice_no,
      completed_cycles: generated.completed_cycles,
      next_run_date: generated.next_run_date,
      result: generated,
      invoice: {
        id: generated.invoice_id,
        invoice_no: generated.invoice_no
      },
      is_idempotent_replay: Boolean(generated.is_idempotent_replay),
      auto_settled: autoSettled
    });
  }));

  return router;
}

module.exports = { recurringRouter };
