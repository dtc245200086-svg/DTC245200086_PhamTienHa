const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { parseId, parsePage, requireObject, requireText } = require('../validation');
const { requireAuth, requireRole } = require('./auth');

function customerInput(body) {
  requireObject(body);
  return {
    name: requireText(body.name, 'name', 200),
    email: requireText(body.email, 'email', 320, { optional: true }),
    phone: requireText(body.phone, 'phone', 40, { optional: true }),
    address: requireText(body.address, 'address', 4000, { optional: true }),
    tax_code: requireText(body.tax_code, 'tax_code', 32, { optional: true })
  };
}

function mapCustomerError(error) {
  if (error.code === '23505') {
    throw new AppError(409, 'CUSTOMER_EMAIL_EXISTS', 'A customer with this email already exists.');
  }
  if (error.code === '23503') {
    throw new AppError(409, 'CUSTOMER_HAS_INVOICES', 'A customer with invoices cannot be deleted.');
  }
  throw error;
}

function customerRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT id, name, email, phone, address, tax_code, created_at
         FROM public.customers
         WHERE $1::text IS NULL OR name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR tax_code ILIKE $1
         ORDER BY id DESC LIMIT $2 OFFSET $3`,
        [pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.customers
         WHERE $1::text IS NULL OR name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR tax_code ILIKE $1`,
        [pattern]
      )
    ]);
    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const customer = customerInput(req.body);
    try {
      const result = await pool.query(
        `INSERT INTO public.customers (name, email, phone, address, tax_code)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, phone, address, tax_code, created_at`,
        [customer.name, customer.email, customer.phone, customer.address, customer.tax_code]
      );
      res.status(201).json({ customer: result.rows[0] });
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT id, name, email, phone, address, tax_code, created_at
       FROM public.customers WHERE id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
    res.json({ customer: result.rows[0] });
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const customer = customerInput(req.body);
    try {
      const result = await pool.query(
        `UPDATE public.customers SET name = $2, email = $3, phone = $4, address = $5, tax_code = $6
         WHERE id = $1
         RETURNING id, name, email, phone, address, tax_code, created_at`,
        [id, customer.name, customer.email, customer.phone, customer.address, customer.tax_code]
      );
      if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
      res.json({ customer: result.rows[0] });
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  router.delete('/:id', requireRole('admin'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    try {
      const result = await pool.query('DELETE FROM public.customers WHERE id = $1', [id]);
      if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
      res.status(204).end();
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  return router;
}

module.exports = { customerRouter };