const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');
const { calculateNextSafeDate } = require('../scheduler');

const FREQUENCIES = new Set(['Hàng tháng', 'Hàng quý', 'Hàng năm', 'MONTHLY', 'QUARTERLY', 'YEARLY']);
const FREQUENCY_MAP = {
  'MONTHLY': 'Hàng tháng',
  'QUARTERLY': 'Hàng quý',
  'YEARLY': 'Hàng năm',
  'Hàng tháng': 'Hàng tháng',
  'Hàng quý': 'Hàng quý',
  'Hàng năm': 'Hàng năm'
};

function recurringRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/recurring-plans (or /api/recurring)
  router.get('/', asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const status = req.query.status ? req.query.status : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT r.id, r.code, r.code AS plan_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
                r.service_title, r.contract_ref, r.frequency, r.frequency AS billing_cycle,
                r.amount_per_period::text, r.amount_per_period::text AS amount,
                r.next_run_date, r.next_run_date AS next_billing_date,
                r.completed_cycles, r.completed_cycles AS invoices_generated,
                r.total_cycles, r.status, r.auto_sign,
                r.last_error, r.created_at
         FROM public.recurring_plans r
         JOIN public.customers c ON c.id = r.customer_id
         WHERE ($1::text IS NULL OR r.status = $1)
           AND ($2::text IS NULL OR r.code ILIKE $2 OR c.name ILIKE $2 OR r.service_title ILIKE $2 OR r.contract_ref ILIKE $2)
         ORDER BY r.id DESC LIMIT $3 OFFSET $4`,
        [status, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.recurring_plans r
         JOIN public.customers c ON c.id = r.customer_id
         WHERE ($1::text IS NULL OR r.status = $1)
           AND ($2::text IS NULL OR r.code ILIKE $2 OR c.name ILIKE $2 OR r.service_title ILIKE $2 OR r.contract_ref ILIKE $2)`,
        [status, pattern]
      )
    ]);

    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  // GET /api/recurring-plans/:id
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT r.id, r.code, r.code AS plan_no, r.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
              r.service_title, r.contract_ref, r.frequency, r.frequency AS billing_cycle,
              r.amount_per_period::text, r.amount_per_period::text AS amount,
              r.next_run_date, r.next_run_date AS next_billing_date,
              r.completed_cycles, r.completed_cycles AS invoices_generated,
              r.total_cycles, r.status, r.auto_sign,
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

    if (!FREQUENCIES.has(frequency)) {
      throw new AppError(400, 'INVALID_FREQUENCY', 'frequency must be Hàng tháng, Hàng quý, or Hàng năm.');
    }

    const seqRes = await pool.query(
      `SELECT format('REC-%s-%s', to_char(current_date, 'YYYY'),
         lpad(nextval('public.recurring_plan_no_seq')::text, 4, '0')) AS code`
    );
    const code = seqRes.rows[0].code;

    const result = await pool.query(
      `INSERT INTO public.recurring_plans
        (code, customer_id, service_title, contract_ref, frequency, amount_per_period, next_run_date, total_cycles, auto_sign, status)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, 'ACTIVE')
       RETURNING id, code, customer_id, service_title, contract_ref, frequency,
                 amount_per_period::text, next_run_date, completed_cycles, total_cycles, status, auto_sign, created_at`,
      [code, customerId, serviceTitle, contractRef, frequency, amount, nextRunDate, totalCycles, autoSign]
    );
    const plan = result.rows[0];

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'recurring',
      action: 'RECURRING_PLAN_CREATED',
      targetRef: plan.code,
      severity: 'INFO',
      summary: `Tạo kế hoạch định kỳ ${plan.code}: ${plan.service_title} (${plan.amount_per_period} ₫ / ${plan.frequency})`,
      metadata: plan
    });

    res.status(201).json({
      plan: {
        ...plan,
        plan_no: plan.code,
        billing_cycle: plan.frequency,
        amount: plan.amount_per_period,
        next_billing_date: plan.next_run_date
      }
    });
  }));

  // PUT /api/recurring-plans/:id/status (and POST /:id/toggle-status)
  const statusUpdateHandler = asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const current = await pool.query('SELECT id, code, status FROM public.recurring_plans WHERE id = $1', [id]);
    if (!current.rowCount) throw new AppError(404, 'RECURRING_PLAN_NOT_FOUND', 'Recurring plan was not found.');

    let newStatus = req.body?.status;
    if (!newStatus) {
      newStatus = current.rows[0].status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    }

    const updated = await pool.query(
      `UPDATE public.recurring_plans SET status = $2 WHERE id = $1 RETURNING id, code, status`,
      [id, newStatus]
    );

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'recurring',
      action: 'RECURRING_STATUS_CHANGED',
      targetRef: current.rows[0].code,
      severity: 'INFO',
      summary: `Đổi trạng thái hợp đồng định kỳ ${current.rows[0].code} sang ${newStatus}`
    });

    res.json({ plan: updated.rows[0] });
  });

  router.post('/:id/toggle-status', requirePermission('recurring.manage'), statusUpdateHandler);
  router.put('/:id/status', requirePermission('recurring.manage'), statusUpdateHandler);

  // POST /api/recurring-plans/:id/trigger (Execute Recurring Generation)
  router.post('/:id/trigger', requirePermission('recurring.manage'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);

    const generated = await inTransaction(async (client) => {
      const planRes = await client.query(
        `SELECT r.id, r.code, r.customer_id, r.service_title, r.contract_ref,
                r.frequency, r.amount_per_period::text, r.next_run_date,
                r.completed_cycles, r.total_cycles, r.status, r.auto_sign,
                c.payment_term_id
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

      // Calculate due date (30 days by default or from term)
      const dueDateRes = await client.query(`SELECT (current_date + interval '30 days')::date AS due_date`);
      const dueDate = dueDateRes.rows[0].due_date;

      // 1. Create invoice in DRAFT
      const invRes = await client.query(
        `INSERT INTO public.invoices (customer_id, due_date, tax_rate, notes, created_by)
         VALUES ($1, $2, 0.10, $3, $4) RETURNING id`,
        [plan.customer_id, dueDate, `Phát sinh định kỳ theo hợp đồng ${plan.contract_ref || plan.code}`, req.user.id]
      );
      const invoiceId = invRes.rows[0].id;

      // 2. Add line item
      const unitPrice = plan.amount_per_period;
      const cycleNumber = plan.completed_cycles + 1;
      await client.query(
        `INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
         VALUES ($1, $2, 1, $3::numeric, $3::numeric)`,
        [invoiceId, `${plan.service_title} (Kỳ cước ${cycleNumber})`, unitPrice]
      );

      // 3. Recalculate totals
      await client.query(
        `UPDATE public.invoices AS invoice
         SET subtotal = totals.subtotal,
             tax_amount = round(totals.subtotal * 0.10, 2),
             total = totals.subtotal + round(totals.subtotal * 0.10, 2)
         FROM (
           SELECT coalesce(sum(line_total), 0)::numeric(14, 2) AS subtotal
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

      return {
        invoice_id: invoiceId,
        invoice_no: invoiceNo || `DRAFT-${invoiceId}`,
        plan_code: plan.code,
        completed_cycles: newCycles,
        next_run_date: nextRunDate,
        status: nextStatus
      };
    });

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'recurring',
      action: 'RECURRING_INVOICE_GENERATED',
      targetRef: generated.invoice_no,
      severity: 'INFO',
      summary: `Sinh hóa đơn định kỳ ${generated.invoice_no} cho hợp đồng ${generated.plan_code} (Chu kỳ ${generated.completed_cycles})`,
      metadata: generated
    });

    res.json({
      invoice_id: generated.invoice_id,
      invoice_no: generated.invoice_no,
      completed_cycles: generated.completed_cycles,
      next_run_date: generated.next_run_date,
      result: generated,
      invoice: {
        id: generated.invoice_id,
        invoice_no: generated.invoice_no
      }
    });
  }));

  return router;
}

module.exports = { recurringRouter };
