'use strict';

const { AppError } = require('../errors');

class PaymentTermsService {
  /**
   * Deterministic calendar calculation of due date from baseDate + days.
   * Handles leap years, month boundaries, and year boundaries using UTC date math.
   * 
   * @param {string|Date} baseDateInput - Base date in YYYY-MM-DD or Date object
   * @param {number} days - Non-negative integer of term days
   * @returns {string} - Resulting due date in YYYY-MM-DD format
   */
  static calculateDueDate(baseDateInput, days) {
    if (!baseDateInput) {
      throw new AppError(400, 'VALIDATION_ERROR', 'baseDate is required for due date calculation.');
    }
    const dateStr = typeof baseDateInput === 'string'
      ? baseDateInput.slice(0, 10)
      : (baseDateInput instanceof Date ? baseDateInput.toISOString().slice(0, 10) : String(baseDateInput));

    const parsed = new Date(`${dateStr}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', `Invalid baseDate: '${baseDateInput}'.`);
    }

    const numDays = Number(days);
    if (!Number.isInteger(numDays) || numDays < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'days must be a non-negative integer.');
    }

    parsed.setUTCDate(parsed.getUTCDate() + numDays);
    return parsed.toISOString().slice(0, 10);
  }

  /**
   * Resolve authoritative payment term from explicit termId, customer profile, or system default.
   * 
   * @param {import('pg').ClientBase} client - Active DB client/pool
   * @param {object} options
   * @param {number|string|null} [options.paymentTermId]
   * @param {number|string|null} [options.customerId]
   * @returns {Promise<object>} - Resolved payment term row
   */
  static async resolvePaymentTerm(client, { paymentTermId = null, customerId = null } = {}) {
    // 1. Explicit payment term supplied by caller
    if (paymentTermId !== null && paymentTermId !== undefined && paymentTermId !== '') {
      const termId = Number(paymentTermId);
      if (!Number.isInteger(termId) || termId <= 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'payment_term_id must be a positive integer.');
      }
      const res = await client.query(
        `SELECT id, code, name, days, grace_period_days, late_penalty_rate::text,
                early_discount_percent::text, early_discount_days, is_default, created_at
         FROM public.payment_terms
         WHERE id = $1`,
        [termId]
      );
      if (!res.rowCount) {
        throw new AppError(404, 'PAYMENT_TERM_NOT_FOUND', `Payment term with id ${termId} was not found.`);
      }
      return res.rows[0];
    }

    // 2. Customer profile default payment term
    if (customerId) {
      const custRes = await client.query(
        `SELECT c.payment_term_id, t.id, t.code, t.name, t.days, t.grace_period_days,
                t.late_penalty_rate::text, t.early_discount_percent::text,
                t.early_discount_days, t.is_default, t.created_at
         FROM public.customers c
         LEFT JOIN public.payment_terms t ON t.id = c.payment_term_id
         WHERE c.id = $1`,
        [customerId]
      );
      if (custRes.rowCount && custRes.rows[0].payment_term_id && custRes.rows[0].code) {
        return {
          id: custRes.rows[0].id,
          code: custRes.rows[0].code,
          name: custRes.rows[0].name,
          days: custRes.rows[0].days,
          grace_period_days: custRes.rows[0].grace_period_days,
          late_penalty_rate: custRes.rows[0].late_penalty_rate,
          early_discount_percent: custRes.rows[0].early_discount_percent,
          early_discount_days: custRes.rows[0].early_discount_days,
          is_default: custRes.rows[0].is_default,
          created_at: custRes.rows[0].created_at
        };
      }
    }

    // 3. System-wide default payment term (is_default = true)
    const defaultRes = await client.query(
      `SELECT id, code, name, days, grace_period_days, late_penalty_rate::text,
              early_discount_percent::text, early_discount_days, is_default, created_at
       FROM public.payment_terms
       WHERE is_default = true
       ORDER BY id ASC
       LIMIT 1`
    );
    if (defaultRes.rowCount) {
      return defaultRes.rows[0];
    }

    // 4. Fallback if no term marked is_default (first available term or standard NET 30)
    const fallbackRes = await client.query(
      `SELECT id, code, name, days, grace_period_days, late_penalty_rate::text,
              early_discount_percent::text, early_discount_days, is_default, created_at
       FROM public.payment_terms
       ORDER BY days ASC, id ASC
       LIMIT 1`
    );
    if (fallbackRes.rowCount) {
      return fallbackRes.rows[0];
    }

    // 5. Ultimate fallback if payment_terms table is empty
    return {
      id: null,
      code: 'NET_30',
      name: 'NET 30 Ng\u00E0y (M\u1EB7c \u0111\u1ECBnh)',
      days: 30,
      grace_period_days: 0,
      late_penalty_rate: '0',
      early_discount_percent: '0',
      early_discount_days: 0,
      is_default: true,
      created_at: new Date()
    };
  }

  /**
   * Authoritatively calculate due date based on payment term resolution and base date.
   * 
   * @param {import('pg').ClientBase} client
   * @param {object} options
   * @param {number|string|null} [options.paymentTermId]
   * @param {number|string|null} [options.customerId]
   * @param {string|Date|null} [options.baseDate]
   * @returns {Promise<{ term: object, dueDate: string, baseDate: string }>}
   */
  static async calculateAuthoritativeDueDate(client, { paymentTermId = null, customerId = null, baseDate = null } = {}) {
    const term = await this.resolvePaymentTerm(client, { paymentTermId, customerId });
    
    let resolvedBaseDate = baseDate;
    if (!resolvedBaseDate) {
      const curRes = await client.query('SELECT current_date::text AS cd');
      resolvedBaseDate = curRes.rows[0].cd;
    } else if (typeof resolvedBaseDate !== 'string') {
      resolvedBaseDate = resolvedBaseDate.toISOString().slice(0, 10);
    } else {
      resolvedBaseDate = resolvedBaseDate.slice(0, 10);
    }

    const dueDate = this.calculateDueDate(resolvedBaseDate, term.days);
    return { term, dueDate, baseDate: resolvedBaseDate };
  }
}

module.exports = PaymentTermsService;
