const express = require('express');
const crypto = require('node:crypto');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');
const { parseId, parsePage, requireObject, requireText, requireDecimal } = require('../validation');
const { requireAuth, requireRole, requirePermission } = require('./auth');
const { inTransaction } = require('../db');
const { recordAudit } = require('../audit');
const { PaymentService } = require('../services/paymentService');
const CustomerCreditService = require('../services/customerCreditService');
const { sendCsvResponse } = require('../csv');

const VALID_SEGMENTS = new Set(['Enterprise', 'SME', 'FDI', 'Retail', 'VIP']);
const SEGMENT_MAP = {
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

function extractUnlockIdempotencyKey(req) {
  const canonical = req.headers['idempotency-key'];
  const legacy = req.headers['x-idempotency-key'];
  const rawKey = canonical !== undefined ? canonical : legacy;

  if (rawKey === undefined || rawKey === null) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required for customer unlock.');
  }

  const strKey = String(rawKey);
  if (strKey.length > 255) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key must not exceed 255 characters.');
  }

  const key = strKey.trim();
  if (key.length === 0) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header cannot be empty.');
  }

  return key;
}

function validateUnlockReason(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'UNLOCK_REASON_REQUIRED', 'Request body must be an object containing unlock_reason.');
  }
  if (typeof body.unlock_reason !== 'string') {
    throw new AppError(400, 'UNLOCK_REASON_REQUIRED', 'unlock_reason must be a string.');
  }
  const cleanReason = body.unlock_reason.trim();
  if (cleanReason.length < 10) {
    throw new AppError(400, 'UNLOCK_REASON_REQUIRED', 'unlock_reason must be at least 10 characters after trimming.');
  }
  return cleanReason;
}

function validateTargetStatus(body) {
  if (body.target_status === undefined || body.target_status === null || body.target_status === '') {
    return 'ACTIVE';
  }
  const status = String(body.target_status).trim();
  if (status !== 'ACTIVE' && status !== 'WARNING') {
    throw new AppError(400, 'INVALID_TARGET_STATUS', 'target_status must be either ACTIVE or WARNING.');
  }
  return status;
}

function computeUnlockRequestFingerprint(customerId, unlockReason, targetStatus) {
  const payload = JSON.stringify({
    action: 'CUSTOMER_MANUAL_UNLOCK',
    customer_id: String(customerId),
    unlock_reason: String(unlockReason),
    target_status: String(targetStatus)
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function loadCustomer(db, customerId) {
  const result = await db.query(
    `SELECT c.id, c.code, c.name, c.email, c.phone, c.address, c.tax_code, c.contact_person,
            c.segment, c.status, c.credit_limit::text, c.payment_term_id, pt.name AS payment_term_name,
            c.lock_source, c.locked_at, c.lock_reason, c.created_at
     FROM public.customers c
     LEFT JOIN public.payment_terms pt ON pt.id = c.payment_term_id
     WHERE c.id = $1`,
    [customerId]
  );
  if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
  return result.rows[0];
}

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

function customerUpdateInput(body, existing) {
  requireObject(body);
  const name = body.name !== undefined ? requireText(body.name, 'name', 200) : existing.name;
  const email = body.email !== undefined ? requireText(body.email, 'email', 320, { optional: true }) : existing.email;
  const phone = body.phone !== undefined ? requireText(body.phone, 'phone', 40, { optional: true }) : existing.phone;
  const address = body.address !== undefined ? requireText(body.address, 'address', 4000, { optional: true }) : existing.address;
  const taxCode = body.tax_code !== undefined ? requireText(body.tax_code, 'tax_code', 32, { optional: true }) : existing.tax_code;
  const code = body.code !== undefined ? requireText(body.code, 'code', 32, { optional: true }) : existing.code;
  const contactPerson = body.contact_person !== undefined ? requireText(body.contact_person, 'contact_person', 200, { optional: true }) : existing.contact_person;

  let segment = existing.segment;
  if (body.segment !== undefined && body.segment !== null && body.segment !== '') {
    const rawSegment = String(body.segment).trim();
    const normalizedSegment = SEGMENT_MAP[rawSegment.toUpperCase()] || (VALID_SEGMENTS.has(rawSegment) ? rawSegment : null);
    if (!normalizedSegment || !VALID_SEGMENTS.has(normalizedSegment)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'segment is invalid.');
    }
    segment = normalizedSegment;
  }

  let creditLimit = existing.credit_limit;
  if (body.credit_limit !== undefined && body.credit_limit !== null && body.credit_limit !== '') {
    creditLimit = requireDecimal(String(body.credit_limit), 'credit_limit', DECIMAL_PATTERN);
  }

  let paymentTermId = existing.payment_term_id;
  if (body.payment_term_id !== undefined) {
    paymentTermId = body.payment_term_id ? parseId(body.payment_term_id, 'payment_term_id') : null;
  }

  let targetStatus = existing.status;
  if (body.status !== undefined && body.status !== null && body.status !== '') {
    if (!VALID_STATUSES.has(body.status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'status must be one of ACTIVE, WARNING, LOCKED.');
    }
    targetStatus = body.status;
  }

  return { name, email, phone, address, taxCode, code, contactPerson, segment, creditLimit, paymentTermId, targetStatus };
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
  router.get('/', requirePermission('customer.read'), asyncRoute(async (req, res) => {
    const { page, limit, page_size, offset } = parsePage(req.query);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const segment = typeof req.query.segment === 'string' && req.query.segment ? req.query.segment : null;
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.trim().toUpperCase() : null;
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT c.id, c.code, c.name, c.email, c.phone, c.address, c.tax_code,
                c.contact_person, c.segment, c.status, c.credit_limit::text,
                c.payment_term_id, t.name AS payment_term_name, t.days AS payment_term_days,
                c.lock_source, c.locked_at, c.lock_reason,
                coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                          WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)::numeric(14, 2)::text AS current_debt,
                (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                                           WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0))::numeric(14, 2)::text AS available_credit,
                (SELECT count(*)::text FROM public.invoices WHERE customer_id = c.id) AS invoices_count,
                c.created_at
         FROM public.customers c
         LEFT JOIN public.payment_terms t ON t.id = c.payment_term_id
         WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1 OR c.tax_code ILIKE $1 OR c.code ILIKE $1 OR c.contact_person ILIKE $1)
           AND ($2::text IS NULL OR c.segment = $2)
           AND ($3::text IS NULL OR c.status = $3)
         ORDER BY c.id DESC LIMIT $4 OFFSET $5`,
        [pattern, segment, status, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total FROM public.customers c
         WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1 OR c.tax_code ILIKE $1 OR c.code ILIKE $1 OR c.contact_person ILIKE $1)
           AND ($2::text IS NULL OR c.segment = $2)
           AND ($3::text IS NULL OR c.status = $3)`,
        [pattern, segment, status]
      )
    ]);

    res.json({ items: items.rows, total: Number(count.rows[0].total), page, limit, page_size: limit });
  }));

  // GET /api/customers/export.csv (Server-side unpaginated CSV export with exact query filter consistency)
  router.get('/export.csv', requirePermission('customer.read'), asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const segment = typeof req.query.segment === 'string' && req.query.segment ? req.query.segment : null;
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.trim().toUpperCase() : null;
    const pattern = search ? `%${search}%` : null;

    const items = await pool.query(
      `SELECT c.id, c.code, c.name, c.email, c.phone, c.address, c.tax_code,
              c.contact_person, c.segment, c.status, c.credit_limit::text,
              coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                        WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)::numeric(14, 2)::text AS current_debt,
              (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                                         WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0))::numeric(14, 2)::text AS available_credit,
              (SELECT count(*)::text FROM public.invoices WHERE customer_id = c.id) AS invoices_count
       FROM public.customers c
       WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1 OR c.tax_code ILIKE $1 OR c.code ILIKE $1 OR c.contact_person ILIKE $1)
         AND ($2::text IS NULL OR c.segment = $2)
         AND ($3::text IS NULL OR c.status = $3)
       ORDER BY c.id DESC`,
      [pattern, segment, status]
    );

    const headers = ['Mã KH', 'Tên khách hàng', 'Email', 'Điện thoại', 'Mã số thuế', 'Người liên hệ', 'Phân khúc', 'Trạng thái', 'Hạn mức tín dụng (VND)', 'Dư nợ hiện tại (VND)', 'Khả dụng (VND)', 'Số lượng HĐ'];
    const rows = items.rows.map(c => [
      c.code || '',
      c.name || '',
      c.email || '',
      c.phone || '',
      c.tax_code || '',
      c.contact_person || '',
      c.segment || '',
      c.status || '',
      c.credit_limit || '0',
      c.current_debt || '0',
      c.available_credit || '0',
      c.invoices_count || '0'
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `danh_sach_khach_hang_${dateStr}.csv`,
      headers,
      rows
    });
  }));

  // POST /api/customers
  router.post('/', requirePermission('customer.create'), asyncRoute(async (req, res) => {
    const customer = customerInput(req.body);
    const code = customer.code || `CUST-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      const created = await inTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO public.customers
            (name, email, phone, address, tax_code, code, contact_person, segment, status, credit_limit, payment_term_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11)
           RETURNING id, code, name, email, phone, address, tax_code, contact_person, segment, status, credit_limit::text, payment_term_id, created_at`,
          [customer.name, customer.email, customer.phone, customer.address, customer.taxCode, code, customer.contactPerson, customer.segment, customer.status, customer.creditLimit, customer.paymentTermId]
        );
        const newCustomer = result.rows[0];

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'customers',
          action: 'CUSTOMER_CREATED',
          targetRef: newCustomer.code,
          severity: 'INFO',
          summary: `Tạo khách hàng mới: ${newCustomer.name} (${newCustomer.code}) - Hạn mức ${newCustomer.credit_limit} ₫`,
          metadata: newCustomer,
          throwOnError: true
        });

        return newCustomer;
      });

      res.status(201).json({ customer: created });
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  // GET /api/customers/:id
  router.get('/:id', requirePermission('customer.read'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT c.id, c.code, c.name, c.email, c.phone, c.address, c.tax_code,
              c.contact_person, c.segment, c.status, c.credit_limit::text,
              c.payment_term_id, t.name AS payment_term_name, t.days AS payment_term_days,
              c.lock_source, c.locked_at, c.lock_reason,
              coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                        WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)::numeric(14, 2)::text AS current_debt,
              (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                                         WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0))::numeric(14, 2)::text AS available_credit,
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
  router.get('/:id/financial-profile', requirePermission('customer.read'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const [custRes, invoicesRes, paymentsRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.code, c.name, c.tax_code, c.segment, c.status,
                c.lock_source, c.locked_at, c.lock_reason,
                c.credit_limit::text,
                coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                          WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)::numeric(14, 2)::text AS current_debt,
                (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                                           WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0))::numeric(14, 2)::text AS available_credit,
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
         WHERE (p.customer_id = $1 OR p.id IN (SELECT payment_id FROM public.payment_allocations pa JOIN public.invoices inv ON inv.id = pa.invoice_id WHERE inv.customer_id = $1))
         ORDER BY p.paid_at DESC, p.id DESC LIMIT 10`,
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

  // GET /api/customers/:id/unapplied-balance
  router.get('/:id/unapplied-balance', requirePermission('customer.read'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const balance = await PaymentService.getCustomerUnappliedBalance(pool, id);
    res.json(balance);
  }));

  // PUT /api/customers/:id
  router.put('/:id', requirePermission('customer.update'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);

    try {
      const updated = await inTransaction(async (client) => {
        const existingRes = await client.query(
          `SELECT id, code, name, email, phone, address, tax_code, contact_person,
                  segment, status, credit_limit::text, payment_term_id,
                  lock_source, locked_at, lock_reason
           FROM public.customers
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );
        if (!existingRes.rowCount) {
          throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
        }
        const existing = existingRes.rows[0];

        const input = customerUpdateInput(req.body, existing);

        // C4. LOCKED PROTECTION: LOCKED cannot become ACTIVE or WARNING via PUT
        if (existing.status === 'LOCKED' && (input.targetStatus === 'ACTIVE' || input.targetStatus === 'WARNING')) {
          throw new AppError(
            409,
            'CUSTOMER_IS_LOCKED',
            'Không thể mở khóa khách hàng qua cập nhật thông tin thông thường. Vui lòng sử dụng luồng Mở khóa công nợ (/api/customers/:id/unlock).',
            { customer_id: id, customer_status: 'LOCKED' }
          );
        }

        const result = await client.query(
          `UPDATE public.customers
           SET name = $2, email = $3, phone = $4, address = $5, tax_code = $6,
               code = coalesce($7, code), contact_person = $8, segment = $9, status = $10,
               credit_limit = $11::numeric, payment_term_id = $12
           WHERE id = $1
           RETURNING id, code, name, email, phone, address, tax_code, contact_person, segment, status,
                     credit_limit::text, payment_term_id, lock_source, locked_at, lock_reason, created_at`,
          [
            id,
            input.name,
            input.email,
            input.phone,
            input.address,
            input.taxCode,
            input.code,
            input.contactPerson,
            input.segment,
            input.targetStatus,
            input.creditLimit,
            input.paymentTermId
          ]
        );
        const updatedCustomer = result.rows[0];

        const auditMetadata = {
          ...updatedCustomer,
          customer_id: id,
          status_prior: existing.status,
          status_after: updatedCustomer.status,
          transition_source: 'PROFILE_UPDATE'
        };

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'customers',
          action: 'CUSTOMER_UPDATED',
          targetRef: updatedCustomer.name,
          severity: 'INFO',
          summary: `Cập nhật thông tin khách hàng: ${updatedCustomer.name}`,
          metadata: auditMetadata,
          throwOnError: true
        });

        return updatedCustomer;
      });

      res.json({ customer: updated });
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  // POST /api/customers/:id/unlock
  router.post('/:id/unlock', requirePermission('customer.unlock'), asyncRoute(async (req, res) => {
    const customerId = parseId(req.params.id);
    const cleanIdempotencyKey = extractUnlockIdempotencyKey(req);
    const unlockReason = validateUnlockReason(req.body);
    const targetStatus = validateTargetStatus(req.body);
    const requestHash = computeUnlockRequestFingerprint(customerId, unlockReason, targetStatus);
    const namespacedKey = cleanIdempotencyKey.length <= 240
      ? `cust_unlock:${cleanIdempotencyKey}`
      : `cust_unlock:h_${crypto.createHash('sha256').update(cleanIdempotencyKey).digest('hex')}`;

    const result = await inTransaction(async (client) => {
      // Step 1: Idempotency advisory lock (Level 0)
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        ['idemp_customer_unlock', namespacedKey]
      );

      // Step 2: Check existing idempotency key
      const existingKeyRes = await client.query(
        `SELECT id, request_hash, response_status, response_body
         FROM public.payment_idempotency_keys
         WHERE idempotency_key = $1`,
        [namespacedKey]
      );

      if (existingKeyRes.rowCount > 0) {
        const row = existingKeyRes.rows[0];
        if (row.request_hash !== requestHash) {
          throw new AppError(
            409,
            'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            'The provided Idempotency-Key has already been used with different request parameters.'
          );
        }
        return {
          ...row.response_body,
          is_idempotent_replay: true
        };
      }

      // Step 3: Lock customer row FOR UPDATE (Level 2)
      const custRes = await client.query(
        `SELECT id, code, name, status, credit_limit::text, lock_source, locked_at, lock_reason
         FROM public.customers
         WHERE id = $1
         FOR UPDATE`,
        [customerId]
      );

      if (custRes.rowCount === 0) {
        throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
      }

      const customer = custRes.rows[0];

      // Step 4: Require customer status === 'LOCKED'
      if (customer.status !== 'LOCKED') {
        throw new AppError(409, 'CUSTOMER_NOT_LOCKED', 'Only LOCKED customers can be unlocked.');
      }

      // Step 5: Update customer status and clear lock metadata
      await client.query(
        `UPDATE public.customers
         SET status = $2,
             lock_source = NULL,
             locked_at = NULL,
             lock_reason = NULL
         WHERE id = $1`,
        [customerId, targetStatus]
      );

      // Step 6: Compute live open debt for audit snapshot
      const currentDebtStr = await CustomerCreditService.calculateCurrentDebt(client, customerId);

      // Step 7: Record audit event atomically inside transaction
      const auditMetadata = {
        customer_id: Number(customer.id),
        customer_code: customer.code,
        customer_name: customer.name,
        status_prior: customer.status,
        previous_status: customer.status,
        target_status: targetStatus,
        new_status: targetStatus,
        unlock_reason: unlockReason,
        credit_limit: customer.credit_limit,
        current_debt: currentDebtStr,
        idempotency_key: cleanIdempotencyKey,
        actor: {
          id: req.user.id,
          username: req.user.username,
          role: req.user.role
        }
      };

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'customers',
        action: 'CUSTOMER_STATUS_MANUAL_UNLOCKED',
        targetRef: customer.name,
        severity: 'INFO',
        summary: `Mở khóa công nợ khách hàng ${customer.name} (${customer.code}): LOCKED -> ${targetStatus}. Lý do: ${unlockReason}`,
        metadata: auditMetadata,
        throwOnError: true
      });

      // Step 8: Load updated customer details inside transaction
      const customerDetail = await loadCustomer(client, customerId);

      const responsePayload = {
        customer: customerDetail,
        is_idempotent_replay: false
      };

      // Step 9: Persist idempotency mapping inside SAME transaction
      await client.query(
        `INSERT INTO public.payment_idempotency_keys
         (idempotency_key, request_hash, payment_id, response_status, response_body, created_by)
         VALUES ($1, $2, NULL, $3, $4, $5)`,
        [namespacedKey, requestHash, 200, JSON.stringify(responsePayload), req.user.id]
      );

      return responsePayload;
    });

    if (!result.is_idempotent_replay) {
      writeLog('info', 'customer.unlocked', {
        request_id: req.requestId,
        user: req.user.username,
        customer_id: customerId,
        target_status: targetStatus
      });
    }

    res.status(200).json(result);
  }));

  // DELETE /api/customers/:id
  router.delete('/:id', requirePermission('customer.delete'), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    try {
      await inTransaction(async (client) => {
        const existing = await client.query('SELECT id, name FROM public.customers WHERE id = $1 FOR UPDATE', [id]);
        if (!existing.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');

        const result = await client.query('DELETE FROM public.customers WHERE id = $1', [id]);
        if (!result.rowCount) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'customers',
          action: 'CUSTOMER_DELETED',
          targetRef: existing.rows[0].name,
          severity: 'WARNING',
          summary: `Xóa khách hàng: ${existing.rows[0].name}`,
          throwOnError: true
        });
      });

      res.status(204).end();
    } catch (error) {
      mapCustomerError(error);
    }
  }));

  return router;
}

module.exports = { customerRouter };