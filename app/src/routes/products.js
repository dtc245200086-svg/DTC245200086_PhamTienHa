const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireObject, requireText, requireDecimal } = require('../validation');
const { requireAuth, requireRole, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');
const { sendCsvResponse } = require('../csv');

const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

function productInput(body) {
  requireObject(body);
  const sku = requireText(body.sku, 'sku', 64);
  const name = requireText(body.name, 'name', 255);
  const category = requireText(body.category || 'General', 'category', 64);
  const unit = requireText(body.unit || 'Đơn vị', 'unit', 32);
  const unitPrice = requireDecimal(body.unit_price, 'unit_price');
  const rawVat = body.vat_rate !== undefined ? body.vat_rate : body.tax_rate;
  const vatRate = requireDecimal(rawVat === undefined ? '0.10' : String(rawVat), 'vat_rate', TAX_RATE);
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
    const { page, limit, page_size, offset } = parsePage(req.query);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.trim().toUpperCase() : null;
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT id, sku, name, category, unit, unit_price::text, vat_rate::text, vat_rate::text AS tax_rate, description, status, (status = 'ACTIVE') AS is_active, created_at
         FROM public.products
         WHERE ($1::text IS NULL OR sku ILIKE $1 OR name ILIKE $1 OR category ILIKE $1 OR description ILIKE $1)
           AND ($2::text IS NULL OR category = $2)
           AND ($3::text IS NULL OR status = $3)
         ORDER BY id DESC LIMIT $4 OFFSET $5`,
        [pattern, category, status, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.products
         WHERE ($1::text IS NULL OR sku ILIKE $1 OR name ILIKE $1 OR category ILIKE $1 OR description ILIKE $1)
           AND ($2::text IS NULL OR category = $2)
           AND ($3::text IS NULL OR status = $3)`,
        [pattern, category, status]
      )
    ]);

    res.json({ items: items.rows, total: Number(count.rows[0].total), page, limit, page_size: limit });
  }));

  // GET /api/products/export.csv (Server-side unpaginated CSV export with exact query filter consistency)
  router.get('/export.csv', asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.trim().toUpperCase() : null;
    const pattern = search ? `%${search}%` : null;

    const items = await pool.query(
      `SELECT id, sku, name, category, unit, unit_price::text, vat_rate::text, description, status
       FROM public.products
       WHERE ($1::text IS NULL OR sku ILIKE $1 OR name ILIKE $1 OR category ILIKE $1 OR description ILIKE $1)
         AND ($2::text IS NULL OR category = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY id DESC`,
      [pattern, category, status]
    );

    const headers = ['Mã SKU', 'Tên sản phẩm / Dịch vụ', 'Phân loại', 'Đơn vị tính', 'Đơn giá niêm yết (VND)', 'Thuế suất GTGT', 'Trạng thái', 'Mô tả'];
    const rows = items.rows.map(p => [
      p.sku || '',
      p.name || '',
      p.category || '',
      p.unit || '',
      p.unit_price || '0',
      `${(Number(p.vat_rate || 0) * 100).toFixed(0)}%`,
      p.status || '',
      p.description || ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `danh_sach_san_pham_${dateStr}.csv`,
      headers,
      rows
    });
  }));

  // GET /api/products/:id
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT id, sku, name, category, unit, unit_price::text, vat_rate::text, vat_rate::text AS tax_rate, description, status, (status = 'ACTIVE') AS is_active, created_at
       FROM public.products WHERE id = $1`,
      [id]
    );
    if (!result.rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
    res.json({ product: result.rows[0] });
  }));

  // POST /api/products
  router.post('/', requirePermission('product.manage'), asyncRoute(async (req, res) => {
    const input = productInput(req.body);
    try {
      const product = await inTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO public.products (sku, name, category, unit, unit_price, vat_rate, description, status)
           VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8)
           RETURNING id, sku, name, category, unit, unit_price::text, vat_rate::text, vat_rate::text AS tax_rate, description, status, (status = 'ACTIVE') AS is_active, created_at`,
          [input.sku, input.name, input.category, input.unit, input.unitPrice, input.vatRate, input.description, input.status]
        );
        const createdProduct = result.rows[0];

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'products',
          action: 'PRODUCT_CREATED',
          targetRef: createdProduct.sku,
          severity: 'INFO',
          summary: `Thêm sản phẩm mới: ${createdProduct.name} (${createdProduct.sku}) - ${createdProduct.unit_price} ₫`,
          metadata: createdProduct,
          throwOnError: true
        });

        return createdProduct;
      });

      res.status(201).json({ product });
    } catch (error) {
      mapProductError(error);
    }
  }));

  // PUT /api/products/:id
  router.put('/:id', requirePermission('product.manage'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const input = productInput(req.body);
    try {
      const product = await inTransaction(async (client) => {
        const result = await client.query(
          `UPDATE public.products
           SET sku = $2, name = $3, category = $4, unit = $5, unit_price = $6::numeric,
               vat_rate = $7::numeric, description = $8, status = $9
           WHERE id = $1
           RETURNING id, sku, name, category, unit, unit_price::text, vat_rate::text, vat_rate::text AS tax_rate, description, status, (status = 'ACTIVE') AS is_active, created_at`,
          [id, input.sku, input.name, input.category, input.unit, input.unitPrice, input.vatRate, input.description, input.status]
        );
        if (!result.rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
        const updatedProduct = result.rows[0];

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'products',
          action: 'PRODUCT_UPDATED',
          targetRef: updatedProduct.sku,
          severity: 'INFO',
          summary: `Cập nhật sản phẩm: ${updatedProduct.name} (${updatedProduct.sku})`,
          metadata: updatedProduct,
          throwOnError: true
        });

        return updatedProduct;
      });

      res.json({ product });
    } catch (error) {
      mapProductError(error);
    }
  }));

  // DELETE /api/products/:id
  router.delete('/:id', requirePermission('product.manage'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    try {
      await inTransaction(async (client) => {
        const existing = await client.query('SELECT id, sku, name FROM public.products WHERE id = $1 FOR UPDATE', [id]);
        if (!existing.rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');

        await client.query('DELETE FROM public.products WHERE id = $1', [id]);

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'products',
          action: 'PRODUCT_DELETED',
          targetRef: existing.rows[0].sku,
          severity: 'WARNING',
          summary: `Xóa sản phẩm: ${existing.rows[0].name} (${existing.rows[0].sku})`,
          throwOnError: true
        });
      });

      res.status(204).end();
    } catch (error) {
      mapProductError(error);
    }
  }));

  return router;
}

module.exports = { productRouter };
