const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { parseId, parsePage, requireObject, requireText, requireDecimal } = require('../validation');
const { requireAuth, requireRole } = require('./auth');
const { recordAudit } = require('../audit');

const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

function productInput(body) {
  requireObject(body);
  const sku = requireText(body.sku, 'sku', 64);
  const name = requireText(body.name, 'name', 255);
  const category = requireText(body.category || 'General', 'category', 64);
  const unit = requireText(body.unit || 'Đơn vị', 'unit', 32);
  const unitPrice = requireDecimal(body.unit_price, 'unit_price');
  const vatRate = requireDecimal(body.vat_rate === undefined ? '0.10' : String(body.vat_rate), 'vat_rate', TAX_RATE);
  const description = requireText(body.description, 'description', 2000, { optional: true });
  const status = body.status === 'DISCONTINUED' ? 'DISCONTINUED' : 'ACTIVE';

  const numVat = Number(vatRate);
  if (numVat < 0 || numVat > 0.20) {
    throw new AppError(400, 'VALIDATION_ERROR', 'vat_rate must be between 0 and 0.20');
  }

  return { sku, name, category, unit, unitPrice, vatRate, description, status };
}

function mapProductError(error) {
  if (error.code === '23505') {
    throw new AppError(409, 'PRODUCT_SKU_EXISTS', 'A product with this SKU already exists.');
  }
  if (error.code === '23503') {
    throw new AppError(409, 'PRODUCT_IN_USE', 'This product is referenced in invoice items and cannot be deleted.');
  }
  throw error;
}

function productRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/products
  router.get('/', asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT id, sku, name, category, unit, unit_price::text, vat_rate::text, description, status, created_at
         FROM public.products
         WHERE ($1::text IS NULL OR sku ILIKE $1 OR name ILIKE $1 OR description ILIKE $1)
           AND ($2::text IS NULL OR category = $2)
         ORDER BY id DESC LIMIT $3 OFFSET $4`,
        [pattern, category, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.products
         WHERE ($1::text IS NULL OR sku ILIKE $1 OR name ILIKE $1 OR description ILIKE $1)
           AND ($2::text IS NULL OR category = $2)`,
        [pattern, category]
      )
    ]);

    res.json({ items: items.rows, total: count.rows[0].total, page, limit });
  }));

  // GET /api/products/:id
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT id, sku, name, category, unit, unit_price::text, vat_rate::text, description, status, created_at
       FROM public.products WHERE id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
    res.json({ product: result.rows[0] });
  }));

  // POST /api/products
  router.post('/', asyncRoute(async (req, res) => {
    const input = productInput(req.body);
    try {
      const result = await pool.query(
        `INSERT INTO public.products (sku, name, category, unit, unit_price, vat_rate, description, status)
         VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8)
         RETURNING id, sku, name, category, unit, unit_price::text, vat_rate::text, description, status, created_at`,
        [input.sku, input.name, input.category, input.unit, input.unitPrice, input.vatRate, input.description, input.status]
      );
      const product = result.rows[0];

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'products',
        action: 'PRODUCT_CREATED',
        targetRef: product.sku,
        severity: 'INFO',
        summary: `Thêm sản phẩm mới: ${product.name} (${product.sku}) - ${product.unit_price} ₫`,
        metadata: product
      });

      res.status(201).json({ product });
    } catch (error) {
      mapProductError(error);
    }
  }));

  // PUT /api/products/:id
  router.put('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const input = productInput(req.body);
    try {
      const result = await pool.query(
        `UPDATE public.products
         SET sku = $2, name = $3, category = $4, unit = $5, unit_price = $6::numeric,
             vat_rate = $7::numeric, description = $8, status = $9
         WHERE id = $1
         RETURNING id, sku, name, category, unit, unit_price::text, vat_rate::text, description, status, created_at`,
        [id, input.sku, input.name, input.category, input.unit, input.unitPrice, input.vatRate, input.description, input.status]
      );
      if (!result.rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
      const product = result.rows[0];

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'products',
        action: 'PRODUCT_UPDATED',
        targetRef: product.sku,
        severity: 'INFO',
        summary: `Cập nhật sản phẩm: ${product.name} (${product.sku})`,
        metadata: product
      });

      res.json({ product });
    } catch (error) {
      mapProductError(error);
    }
  }));

  // DELETE /api/products/:id
  router.delete('/:id', requireRole('admin'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    try {
      const existing = await pool.query('SELECT id, sku, name FROM public.products WHERE id = $1', [id]);
      if (!existing.rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');

      await pool.query('DELETE FROM public.products WHERE id = $1', [id]);

      await recordAudit(pool, {
        user: req.user,
        ip: req.ip,
        module: 'products',
        action: 'PRODUCT_DELETED',
        targetRef: existing.rows[0].sku,
        severity: 'WARNING',
        summary: `Xóa sản phẩm: ${existing.rows[0].name} (${existing.rows[0].sku})`
      });

      res.status(204).end();
    } catch (error) {
      mapProductError(error);
    }
  }));

  return router;
}

module.exports = { productRouter };
