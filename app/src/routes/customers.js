const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { parseId, parsePage, requireObject, requireText, requireDecimal } = require('../validation');
const { requireAuth, requireRole } = require('./auth');
const { recordAudit } = require('../audit');

const VALID_SEGMENTS = new Set(['Enterprise', 'SME', 'FDI', 'Retail', 'VIP']);
const SEGMENT_MAP = {
  'ENTERPRISE': 'Enterprise',
  'ENTERPRISE': 'Enterprise',
  'SME': 'SME',
  'FDI': 'FDI',
  'RETAIL': 'Retail',
  'VIP': 'VIP',
  'Enterprise': 'Enterprise',
  'Retail': 'Retail'
};
const VALID_STATUSES = new Set(['ACTIVE', 'WARNING', 'LOCKED']);
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

function customerInput(body) {
  requireObject(body);
  const name = requireText(body.name, 'name', 200);
  const email = requireText(body.email, 'email', 320, { optional: true });
  const phone = requireText(body.phone, 'phone', 40, { optional: true });
  const address = requireText(body.address, 'address', 4000, { optional: true });
  const taxCode = requireText(body.tax_code, 'tax_code', 32, { optional: true });

  const code = requireText(body.code, 'code', 32, { optional: true });
  const contactPerson = requireText(body.contact_person, 'contact_person', 200, { optional: true });
  const rawSegment = body.segment ? String(body.segment).trim() : 'SME';
  const normalizedSegment = SEGMENT_MAP[rawSegment.toUpperCase()] || (VALID_SEGMENTS.has(rawSegment) ? rawSegment : 'SME');
  const segment = VALID_SEGMENTS.has(normalizedSegment) ? normalizedSegment : 'SME';
  const status = body.status && VALID_STATUSES.has(body.status) ? body.status : 'ACTIVE';
  const creditLimit = requireDecimal(body.credit_limit === undefined || body.credit_limit === null || body.credit_limit === '' ? '0' : String(body.credit_limit), 'credit_limit', DECIMAL_PATTERN);
  const paymentTermId = body.payment_term_id ? parseId(body.payment_term_id, 'payment_term_id') : null;

  return { name, email, phone, address, taxCode, code, contactPerson, segment, status, creditLimit, paymentTermId };
}

function mapCustomerError(error) {
  if (error.code === '23505') {
    throw new AppError(409, 'CUSTOMER_EMAIL_EXISTS', 'A customer with this email already exists.');
  }
  if (error.code === '23503') {
    throw new AppError(409, 'CUSTOMER_HAS_INVOICES', 'A customer with invoices or contracts cannot be deleted.');
  }
  throw error;
}

function customerRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/customers
  router.get('/', asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const segment = typeof req.query.segment === 'string' && req.query.segment ? req.query.segment : null;
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT c.id, c.code, c.name, c.email, c.phone, c.address, c.tax_code,
                c.contact_person, c.segment, c.status, c.credit_limit::text,
                c.payment_term_id, t.name AS payment_term_name, t.days AS payment_term_days,
                coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                          WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0)::numeric(14, 2)::text AS current_debt,
                (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                                           WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0))::numeric(14, 2)::text AS available_credit,
                (SELECT count(*)::text FROM public.invoices WHERE customer_id = c.id) AS invoices_count,
                c.created_at
         FROM public.customers c
         LEFT JOIN public.payment_terms t ON t.id = c.payment_term_id
         WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1 OR c.tax_code ILIKE $1 OR c.code ILIKE $1)
           AND ($2::text IS NULL OR c.segment = $2)
         ORDER BY c.id DESC LIMIT $3 OFFSET $4`,
        [pattern, segment, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.customers c
         WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1 OR c.tax_code ILIKE $1 OR c.code ILIKE $1)
           AND ($2::text IS NULL OR c.segment = $2)`,
        [pattern, segment]
      )
    ]);

    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  // POST /api/customers
  router.post('/', asyncRoute(async (req, res) => {
    const customer = customerInput(req.body);
    const code = customer.code || `CUST-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      const result = await pool.query(
        `INSERT INTO public.customers
          (name, email, phone, address, tax_code, code, contact_person, segment, status, credit_limit, payment_term_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11)
         RETURNING id, code, name, email, phone, address, tax_code, contact_person, segment, status, credit_limit::text, payment_term_id, created_at`,
        [customer.name, customer.email, customer.phone, customer.address, customer.taxCode, code, customer.contactPerson, customer.segment, customer.status, customer.creditLimit, customer.paymentTermId]
      );
      const created = result.rows[0];

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'customers',
        action: 'CUSTOMER_CREATED',
        targetRef: created.name,
        severity: 'INFO',
        summary: `Tạo khách hàng mới: ${created.name} (${created.code}) - Hạn mức ${created.credit_limit} ₫`,
        metadata: created
      });

      res.status(201).json({ customer: created });
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  // GET /api/customers/:id
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT c.id, c.code, c.name, c.email, c.phone, c.address, c.tax_code,
              c.contact_person, c.segment, c.status, c.credit_limit::text,
              c.payment_term_id, t.name AS payment_term_name, t.days AS payment_term_days,
              coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                        WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0)::numeric(14, 2)::text AS current_debt,
              (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                                         WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0))::numeric(14, 2)::text AS available_credit,
              c.created_at
       FROM public.customers c
       LEFT JOIN public.payment_terms t ON t.id = c.payment_term_id
       WHERE c.id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
    res.json({ customer: result.rows[0] });
  }));

  // GET /api/customers/:id/financial-profile
  router.get('/:id/financial-profile', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const [custRes, invoicesRes, paymentsRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.code, c.name, c.tax_code, c.segment, c.credit_limit::text,
                coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                          WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0)::numeric(14, 2)::text AS current_debt,
                (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                                           WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0))::numeric(14, 2)::text AS available_credit,
                coalesce((SELECT sum(paid_total) FROM public.invoices WHERE customer_id = c.id), 0)::numeric(14, 2)::text AS lifetime_paid
         FROM public.customers c WHERE c.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT id, invoice_no, status, issue_date, due_date, total::text, paid_total::text, adjusted_total::text,
                (total - paid_total - adjusted_total)::numeric(14, 2)::text AS remaining
         FROM public.invoices WHERE customer_id = $1 ORDER BY id DESC LIMIT 10`,
        [id]
      ),
      pool.query(
        `SELECT p.id, p.amount::text, p.method, p.paid_at, p.reference, p.bank_name
         FROM public.payments p
         JOIN public.invoices i ON i.id = p.invoice_id
         WHERE i.customer_id = $1 ORDER BY p.paid_at DESC LIMIT 10`,
        [id]
      )
    ]);

    if (!custRes.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
    res.json({
      profile: custRes.rows[0],
      recent_invoices: invoicesRes.rows,
      recent_payments: paymentsRes.rows
    });
  }));

  // PUT /api/customers/:id
  router.put('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const customer = customerInput(req.body);

    try {
      const result = await pool.query(
        `UPDATE public.customers
         SET name = $2, email = $3, phone = $4, address = $5, tax_code = $6,
             code = coalesce($7, code), contact_person = $8, segment = $9, status = $10,
             credit_limit = $11::numeric, payment_term_id = $12
         WHERE id = $1
         RETURNING id, code, name, email, phone, address, tax_code, contact_person, segment, status, credit_limit::text, payment_term_id, created_at`,
        [id, customer.name, customer.email, customer.phone, customer.address, customer.taxCode, customer.code, customer.contactPerson, customer.segment, customer.status, customer.creditLimit, customer.paymentTermId]
      );
      if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
      const updated = result.rows[0];

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'customers',
        action: 'CUSTOMER_UPDATED',
        targetRef: updated.name,
        severity: 'INFO',
        summary: `Cập nhật thông tin khách hàng: ${updated.name}`,
        metadata: updated
      });

      res.json({ customer: updated });
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  // DELETE /api/customers/:id
  router.delete('/:id', requireRole('admin'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    try {
      const existing = await pool.query('SELECT id, name FROM public.customers WHERE id = $1', [id]);
      if (!existing.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');

      const result = await pool.query('DELETE FROM public.customers WHERE id = $1', [id]);
      if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'customers',
        action: 'CUSTOMER_DELETED',
        targetRef: existing.rows[0].name,
        severity: 'WARNING',
        summary: `Xóa khách hàng: ${existing.rows[0].name}`
      });

      res.status(204).end();
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  return router;
}

module.exports = { customerRouter };