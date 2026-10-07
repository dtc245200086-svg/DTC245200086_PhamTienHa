const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { parseId, parsePage, requireObject, requireText } = require('../validation');
const { requireAuth, requireRole, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');

function paymentTermInput(body) {
  requireObject(body);
  const code = requireText(body.code, 'code', 32).toUpperCase().replace(/\s+/g, '_');
  const name = requireText(body.name, 'name', 100);
  const rawDays = body.days !== undefined ? body.days : (body.net_days !== undefined ? body.net_days : 30);
  const days = Number(rawDays);
  const gracePeriodDays = Number(body.grace_period_days === undefined ? 0 : body.grace_period_days);
  const latePenaltyRate = Number(body.late_penalty_rate === undefined ? 0 : body.late_penalty_rate);
  const rawDiscPct = body.early_discount_percent !== undefined ? body.early_discount_percent : (body.discount_percent !== undefined ? body.discount_percent : 0);
  const earlyDiscountPercent = Number(rawDiscPct);
  const rawDiscDays = body.early_discount_days !== undefined ? body.early_discount_days : (body.discount_days !== undefined ? body.discount_days : 0);
  const earlyDiscountDays = Number(rawDiscDays);
  const description = requireText(body.description, 'description', 1000, { optional: true });
  const isDefault = Boolean(body.is_default);

  if (!Number.isInteger(days) || days < 0) throw new AppError(400, 'VALIDATION_ERROR', 'days must be a non-negative integer.');
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) throw new AppError(400, 'VALIDATION_ERROR', 'grace_period_days must be a non-negative integer.');
  if (latePenaltyRate < 0) throw new AppError(400, 'VALIDATION_ERROR', 'late_penalty_rate must be non-negative.');
  if (earlyDiscountPercent < 0 || earlyDiscountPercent > 100) throw new AppError(400, 'VALIDATION_ERROR', 'early_discount_percent must be between 0 and 100.');
  if (!Number.isInteger(earlyDiscountDays) || earlyDiscountDays < 0) throw new AppError(400, 'VALIDATION_ERROR', 'early_discount_days must be non-negative.');

  return { code, name, days, gracePeriodDays, latePenaltyRate, earlyDiscountPercent, earlyDiscountDays, description, isDefault };
}

function mapPaymentTermError(error) {
  if (error.code === '23505') {
    throw new AppError(409, 'PAYMENT_TERM_CODE_EXISTS', 'A payment term with this code already exists.');
  }
  if (error.code === '23503') {
    throw new AppError(409, 'PAYMENT_TERM_IN_USE', 'This payment term is assigned to customers/invoices and cannot be deleted.');
  }
  throw error;
}

function paymentTermsRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/payment-terms
  router.get('/', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT t.id, t.code, t.name, t.days, t.days AS net_days, t.grace_period_days,
              t.late_penalty_rate::text, t.early_discount_percent::text, t.early_discount_percent::text AS discount_percent,
              t.early_discount_days, t.early_discount_days AS discount_days,
              t.description, t.is_default, t.created_at,
              count(c.id)::text AS active_customers_count
       FROM public.payment_terms t
       LEFT JOIN public.customers c ON c.payment_term_id = t.id
       GROUP BY t.id
       ORDER BY t.days ASC, t.id ASC`
    );
    res.json({ items: result.rows });
  }));

  // GET /api/payment-terms/:id
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT id, code, name, days, days AS net_days, grace_period_days,
              late_penalty_rate::text, early_discount_percent::text, early_discount_percent::text AS discount_percent,
              early_discount_days, early_discount_days AS discount_days,
              description, is_default, created_at
       FROM public.payment_terms WHERE id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'PAYMENT_TERM_NOT_FOUND', 'Payment term was not found.');
    res.json({ term: result.rows[0], payment_term: result.rows[0] });
  }));

  // POST /api/payment-terms
  router.post('/', requireRole('admin'), asyncRoute(async (req, res) => {
    const input = paymentTermInput(req.body);
    try {
      if (input.isDefault) {
        await pool.query('UPDATE public.payment_terms SET is_default = false WHERE is_default = true');
      }

      const result = await pool.query(
        `INSERT INTO public.payment_terms
          (code, name, days, grace_period_days, late_penalty_rate, early_discount_percent, early_discount_days, description, is_default)
         VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9)
         RETURNING id, code, name, days, days AS net_days, grace_period_days,
                   late_penalty_rate::text, early_discount_percent::text, early_discount_percent::text AS discount_percent,
                   early_discount_days, early_discount_days AS discount_days,
                   description, is_default, created_at`,
        [input.code, input.name, input.days, input.gracePeriodDays, input.latePenaltyRate, input.earlyDiscountPercent, input.earlyDiscountDays, input.description, input.isDefault]
      );
      const term = result.rows[0];

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'payment_terms',
        action: 'PAYMENT_TERM_CREATED',
        targetRef: term.code,
        severity: 'INFO',
        summary: `Tạo điều khoản thanh toán: ${term.name} (${term.code}) - Net ${term.days} ngày`,
        metadata: term
      });

      res.status(201).json({ term, payment_term: term });
    } catch (error) {
      mapPaymentTermError(error);
    }
  }));

  // PUT /api/payment-terms/:id
  router.put('/:id', requireRole('admin'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const input = paymentTermInput(req.body);
    try {
      const existing = await pool.query('SELECT id, code, is_default FROM public.payment_terms WHERE id = $1', [id]);
      if (!existing.rowCount) throw new AppError(404, 'PAYMENT_TERM_NOT_FOUND', 'Payment term was not found.');

      if (input.isDefault) {
        await pool.query('UPDATE public.payment_terms SET is_default = false WHERE id <> $1 AND is_default = true', [id]);
      }

      const result = await pool.query(
        `UPDATE public.payment_terms
         SET code = $2, name = $3, days = $4, grace_period_days = $5,
             late_penalty_rate = $6::numeric, early_discount_percent = $7::numeric,
             early_discount_days = $8, description = $9, is_default = $10
         WHERE id = $1
         RETURNING id, code, name, days, days AS net_days, grace_period_days,
                   late_penalty_rate::text, early_discount_percent::text, early_discount_percent::text AS discount_percent,
                   early_discount_days, early_discount_days AS discount_days,
                   description, is_default, created_at`,
        [id, input.code, input.name, input.days, input.gracePeriodDays, input.latePenaltyRate, input.earlyDiscountPercent, input.earlyDiscountDays, input.description, input.isDefault]
      );
      const term = result.rows[0];

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'payment_terms',
        action: 'PAYMENT_TERM_UPDATED',
        targetRef: term.code,
        severity: 'INFO',
        summary: `Cập nhật điều khoản thanh toán: ${term.name} (${term.code})`,
        metadata: term
      });

      res.json({ term, payment_term: term });
    } catch (error) {
      mapPaymentTermError(error);
    }
  }));

  // POST /api/payment-terms/:id/default
  router.post('/:id/default', requireRole('admin'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await pool.query('SELECT id, code, name FROM public.payment_terms WHERE id = $1', [id]);
    if (!existing.rowCount) throw new AppError(404, 'PAYMENT_TERM_NOT_FOUND', 'Payment term was not found.');

    await pool.query('UPDATE public.payment_terms SET is_default = false WHERE is_default = true');
    const result = await pool.query('UPDATE public.payment_terms SET is_default = true WHERE id = $1 RETURNING id, code, name, is_default', [id]);

    res.json({ term: result.rows[0], payment_term: result.rows[0] });
  }));

  // DELETE /api/payment-terms/:id
  router.delete('/:id', requireRole('admin'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    try {
      const existing = await pool.query('SELECT id, code, name FROM public.payment_terms WHERE id = $1', [id]);
      if (!existing.rowCount) throw new AppError(404, 'PAYMENT_TERM_NOT_FOUND', 'Payment term was not found.');

      await pool.query('DELETE FROM public.payment_terms WHERE id = $1', [id]);

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'payment_terms',
        action: 'PAYMENT_TERM_DELETED',
        targetRef: existing.rows[0].code,
        severity: 'WARNING',
        summary: `Xóa điều khoản thanh toán: ${existing.rows[0].name} (${existing.rows[0].code})`
      });

      res.status(204).end();
    } catch (error) {
      mapPaymentTermError(error);
    }
  }));

  return router;
}

module.exports = { paymentTermsRouter };
