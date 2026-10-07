const crypto = require('node:crypto');
const { AppError } = require('../errors');

const VALID_METHODS = new Set(['CASH', 'BANK_TRANSFER', 'CARD']);

/**
 * Helper to ensure consistent lock ordering and avoid deadlocks.
 */
function sortIds(ids) {
  return [...new Set(ids)].sort((a, b) => Number(a) - Number(b));
}

/**
 * Compute a deterministic cryptographic fingerprint of payment creation parameters.
 */
function computePaymentRequestFingerprint(payload) {
  const normalized = {
    customerId: payload.customerId ? String(payload.customerId) : null,
    invoiceId: payload.invoiceId ? String(payload.invoiceId) : null,
    amount: Number(payload.amount).toFixed(2),
    method: String(payload.method || '').toUpperCase().trim(),
    paidAt: String(payload.paidAt || '').trim(),
    reference: payload.reference ? String(payload.reference).trim() : null,
    allocations: Array.isArray(payload.allocations)
      ? payload.allocations
          .map(a => ({
            invoiceId: String(a.invoiceId || a.invoice_id),
            amount: Number(a.amount).toFixed(2)
          }))
          .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
      : []
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Compute a deterministic cryptographic fingerprint of allocation parameters.
 */
function computeAllocationRequestFingerprint(paymentId, allocations) {
  const normalized = {
    paymentId: String(paymentId),
    allocations: Array.isArray(allocations)
      ? allocations
          .map(a => ({
            invoiceId: String(a.invoiceId || a.invoice_id),
            amount: Number(a.amount).toFixed(2)
          }))
          .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
      : []
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Core canonical service managing Payments, Allocations, and Unapplied Cash.
 */
class PaymentService {
  /**
   * Create a new cash payment, with optional immediate allocations to one or more invoices.
   * If allocations are omitted or partial, remaining amount becomes unapplied cash.
   * Supports transactional idempotency via Idempotency-Key.
   */
  static async createPayment(client, {
    customerId = null,
    invoiceId = null,
    amount,
    method,
    paidAt,
    reference = null,
    bankName = null,
    bankAccount = null,
    notes = null,
    recordedBy,
    allocations = [],
    idempotencyKey = null
  }) {
    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Payment amount must be greater than zero.');
    }

    const cleanMethod = String(method || '').toUpperCase().trim();
    if (!VALID_METHODS.has(cleanMethod)) {
      throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'Payment method must be CASH, BANK_TRANSFER, or CARD.');
    }

    // If an initial invoiceId is provided directly, synthesize it into allocations if not explicitly given
    let effectiveAllocations = Array.isArray(allocations) ? [...allocations] : [];
    if (invoiceId && effectiveAllocations.length === 0) {
      effectiveAllocations.push({ invoiceId, amount: paymentAmount });
    }

    // If customerId is not provided but invoiceId is, resolve customerId from invoice
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && effectiveAllocations.length > 0) {
      const firstInvId = effectiveAllocations[0].invoiceId || effectiveAllocations[0].invoice_id;
      const invCheck = await client.query('SELECT customer_id FROM public.invoices WHERE id = $1', [firstInvId]);
      if (invCheck.rowCount > 0) {
        resolvedCustomerId = invCheck.rows[0].customer_id;
      }
    }

    // 0. Idempotency Check & Advisory Lock
    let cleanIdempotencyKey = null;
    let requestHash = null;
    if (idempotencyKey) {
      cleanIdempotencyKey = String(idempotencyKey).trim();
      if (cleanIdempotencyKey.length === 0 || cleanIdempotencyKey.length > 255) {
        throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key must be between 1 and 255 characters.');
      }

      requestHash = computePaymentRequestFingerprint({
        customerId: resolvedCustomerId,
        invoiceId,
        amount: paymentAmount,
        method: cleanMethod,
        paidAt,
        reference,
        allocations: effectiveAllocations
      });

      // Acquire 64-bit transaction-level advisory lock on idempotency key
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('idemp_payment'), hashtext($1))`,
        [cleanIdempotencyKey]
      );

      // Check if key already processed and committed
      const existingKeyRes = await client.query(
        `SELECT id, idempotency_key, request_hash, payment_id, response_status, response_body
         FROM public.payment_idempotency_keys
         WHERE idempotency_key = $1`,
        [cleanIdempotencyKey]
      );

      if (existingKeyRes.rowCount > 0) {
        const keyRow = existingKeyRes.rows[0];
        if (keyRow.request_hash !== requestHash) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            `Idempotency-Key '${cleanIdempotencyKey}' was already used with a different request payload.`);
        }
        return {
          ...keyRow.response_body,
          is_idempotent_replay: true
        };
      }
    }

    // 1. Insert the master payment record representing the real cash inflow
    const payInsert = await client.query(
      `INSERT INTO public.payments
        (customer_id, invoice_id, amount, method, paid_at, reference, bank_name, bank_account, notes, recorded_by)
       VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, customer_id, invoice_id, amount::text, method, paid_at, reference, bank_name, bank_account, notes, recorded_by, created_at`,
      [
        resolvedCustomerId,
        invoiceId || (effectiveAllocations.length === 1 ? (effectiveAllocations[0].invoiceId || effectiveAllocations[0].invoice_id) : null),
        paymentAmount.toFixed(2),
        cleanMethod,
        paidAt,
        reference,
        bankName,
        bankAccount,
        notes,
        recordedBy
      ]
    );
    const paymentRow = payInsert.rows[0];

    // 2. If allocations are requested, apply them through the canonical allocation engine
    let appliedAllocations = [];
    let updatedInvoices = [];
    if (effectiveAllocations.length > 0) {
      const allocResult = await this.allocatePayment(client, {
        paymentId: paymentRow.id,
        allocations: effectiveAllocations,
        recordedBy
      });
      appliedAllocations = allocResult.allocations;
      updatedInvoices = allocResult.updatedInvoices;
    }

    const totalAllocated = appliedAllocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
    const unappliedAmount = Math.max(0, Math.round((paymentAmount - totalAllocated) * 100) / 100);

    const resultPayload = {
      payment: paymentRow,
      allocations: appliedAllocations,
      allocated_total: totalAllocated.toFixed(2),
      unapplied_amount: unappliedAmount.toFixed(2),
      updated_invoices: updatedInvoices
    };

    // 3. Persist idempotency key mapping if provided
    if (cleanIdempotencyKey) {
      await client.query(
        `INSERT INTO public.payment_idempotency_keys
          (idempotency_key, request_hash, payment_id, response_status, response_body, created_by)
         VALUES ($1, $2, $3, 201, $4, $5)`,
        [cleanIdempotencyKey, requestHash, paymentRow.id, JSON.stringify(resultPayload), recordedBy]
      );
    }

    return {
      ...resultPayload,
      is_idempotent_replay: false
    };
  }

  /**
   * Allocate unapplied cash from an existing payment to one or more invoices.
   * Enforces transaction isolation, consistent lock ordering, and strict capacity checks.
   */
  static async allocatePayment(client, {
    paymentId,
    allocations = [],
    recordedBy,
    idempotencyKey = null
  }) {
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'allocations array must not be empty.');
    }

    // 0. Idempotency Check & Advisory Lock for allocations
    let cleanIdempotencyKey = null;
    let requestHash = null;
    if (idempotencyKey) {
      cleanIdempotencyKey = String(idempotencyKey).trim();
      if (cleanIdempotencyKey.length === 0 || cleanIdempotencyKey.length > 255) {
        throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key must be between 1 and 255 characters.');
      }

      requestHash = computeAllocationRequestFingerprint(paymentId, allocations);

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('idemp_alloc'), hashtext($1))`,
        [cleanIdempotencyKey]
      );

      const existingKeyRes = await client.query(
        `SELECT id, idempotency_key, request_hash, payment_id, response_status, response_body
         FROM public.payment_idempotency_keys
         WHERE idempotency_key = $1`,
        [cleanIdempotencyKey]
      );

      if (existingKeyRes.rowCount > 0) {
        const keyRow = existingKeyRes.rows[0];
        if (keyRow.request_hash !== requestHash) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            `Idempotency-Key '${cleanIdempotencyKey}' was already used with a different request payload.`);
        }
        return {
          ...keyRow.response_body,
          is_idempotent_replay: true
        };
      }
    }

    // 1. Acquire transaction-level advisory lock on paymentId to serialize allocations and prevent concurrent over-allocation
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [paymentId]);

    const payRes = await client.query(
      `SELECT id, customer_id, amount::text, method, paid_at, reference, recorded_by
       FROM public.payments WHERE id = $1`,
      [paymentId]
    );
    if (!payRes.rowCount) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', `Payment #${paymentId} was not found.`);
    }
    const payment = payRes.rows[0];
    const paymentTotal = Number(payment.amount);

    // Calculate current allocations on this payment
    const currAllocRes = await client.query(
      `SELECT coalesce(sum(allocated_amount), 0)::numeric(14, 2) AS current_allocated
       FROM public.payment_allocations WHERE payment_id = $1`,
      [paymentId]
    );
    const currentlyAllocated = Number(currAllocRes.rows[0].current_allocated);
    const availableUnapplied = Math.max(0, Math.round((paymentTotal - currentlyAllocated) * 100) / 100);

    // Validate allocation payload format & amounts
    let reqSum = 0;
    const validatedItems = [];
    for (const item of allocations) {
      const invId = Number(item.invoiceId || item.invoice_id);
      const allocAmt = Number(item.amount);
      if (!Number.isFinite(invId) || invId <= 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Each allocation must specify a valid invoice_id.');
      }
      if (!Number.isFinite(allocAmt) || allocAmt <= 0) {
        throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Allocated amount must be greater than zero.');
      }
      reqSum += allocAmt;
      validatedItems.push({ invoiceId: invId, amount: allocAmt, notes: item.notes || null });
    }

    reqSum = Math.round(reqSum * 100) / 100;
    if (reqSum > availableUnapplied + 0.001) {
      throw new AppError(409, 'PAYMENT_EXCEEDS_UNAPPLIED',
        `Requested allocation total (${reqSum.toFixed(2)} ₫) exceeds available unapplied payment cash (${availableUnapplied.toFixed(2)} ₫).`);
    }

    // 2. Lock all target invoices in ASCENDING order of IDs to eliminate deadlock risks
    const uniqueInvoiceIds = sortIds(validatedItems.map(i => i.invoiceId));
    const invRes = await client.query(
      `SELECT id, invoice_no, customer_id, status, total::text, paid_total::text, adjusted_total::text,
              (total - paid_total - adjusted_total)::numeric(14, 2) AS outstanding
       FROM public.invoices WHERE id = ANY($1::bigint[]) FOR UPDATE`,
      [uniqueInvoiceIds]
    );

    const invoiceMap = new Map(invRes.rows.map(inv => [Number(inv.id), inv]));
    for (const invId of uniqueInvoiceIds) {
      if (!invoiceMap.has(invId)) {
        throw new AppError(404, 'INVOICE_NOT_FOUND', `Invoice #${invId} was not found.`);
      }
    }

    // 3. Validate invoice capacity & customer matching
    // Track cumulative allocation per invoice within this request
    const requestedPerInvoice = new Map();
    for (const item of validatedItems) {
      const cur = requestedPerInvoice.get(item.invoiceId) || 0;
      requestedPerInvoice.set(item.invoiceId, cur + item.amount);
    }

    for (const [invId, totalAllocForInv] of requestedPerInvoice.entries()) {
      const inv = invoiceMap.get(invId);
      if (payment.customer_id && Number(inv.customer_id) !== Number(payment.customer_id)) {
        throw new AppError(400, 'CUSTOMER_MISMATCH',
          `Invoice ${inv.invoice_no} belongs to customer #${inv.customer_id}, but payment belongs to customer #${payment.customer_id}.`);
      }
      if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) {
        throw new AppError(409, 'INVOICE_NOT_PAYABLE',
          `Invoice ${inv.invoice_no} is in status ${inv.status} and cannot accept allocations.`);
      }

      const outstanding = Number(inv.outstanding);
      if (totalAllocForInv > outstanding + 0.001) {
        throw new AppError(409, 'PAYMENT_EXCEEDS_OUTSTANDING',
          `Allocation amount (${totalAllocForInv.toFixed(2)} ₫) exceeds outstanding balance (${outstanding.toFixed(2)} ₫) of invoice ${inv.invoice_no}.`);
      }
    }

    // 4. Apply allocations and update invoices
    const insertedAllocations = [];
    const updatedInvoices = [];

    for (const item of validatedItems) {
      const allocInsert = await client.query(
        `INSERT INTO public.payment_allocations (payment_id, invoice_id, allocated_amount, created_by, notes)
         VALUES ($1, $2, $3::numeric, $4, $5)
         RETURNING id, payment_id, invoice_id, allocated_amount::text, created_at, created_by, notes`,
        [paymentId, item.invoiceId, item.amount.toFixed(2), recordedBy, item.notes]
      );
      insertedAllocations.push(allocInsert.rows[0]);

      const invUpdate = await client.query(
        `UPDATE public.invoices
         SET paid_total = paid_total + $2::numeric,
             status = CASE WHEN paid_total + $2::numeric + adjusted_total >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END
         WHERE id = $1
         RETURNING id, invoice_no, status, total::text, paid_total::text, adjusted_total::text,
                   (total - paid_total - adjusted_total)::numeric(14, 2)::text AS outstanding`,
        [item.invoiceId, item.amount.toFixed(2)]
      );
      updatedInvoices.push(invUpdate.rows[0]);
    }

    const newAllocatedTotal = currentlyAllocated + reqSum;
    const newUnapplied = Math.max(0, Math.round((paymentTotal - newAllocatedTotal) * 100) / 100);

    const resultPayload = {
      payment: {
        ...payment,
        allocated_total: newAllocatedTotal.toFixed(2),
        unapplied_amount: newUnapplied.toFixed(2)
      },
      allocations: insertedAllocations,
      updatedInvoices
    };

    if (cleanIdempotencyKey) {
      await client.query(
        `INSERT INTO public.payment_idempotency_keys
          (idempotency_key, request_hash, payment_id, response_status, response_body, created_by)
         VALUES ($1, $2, $3, 201, $4, $5)`,
        [cleanIdempotencyKey, requestHash, paymentId, JSON.stringify(resultPayload), recordedBy]
      );
    }

    return {
      ...resultPayload,
      is_idempotent_replay: false
    };
  }

  /**
   * Fetch comprehensive payment details, including allocations and unapplied balance.
   */
  static async getPaymentDetails(poolOrClient, paymentId) {
    const payRes = await poolOrClient.query(
      `SELECT p.id, p.customer_id, c.name AS customer_name, c.tax_code AS customer_tax_code,
              p.invoice_id, inv_direct.invoice_no AS direct_invoice_no,
              p.amount::text, p.method, p.paid_at, p.reference, p.bank_name, p.bank_account, p.notes,
              p.recorded_by, u.username AS recorded_by_username, p.created_at,
              coalesce((SELECT sum(allocated_amount) FROM public.payment_allocations WHERE payment_id = p.id), 0)::numeric(14, 2)::text AS allocated_amount,
              (p.amount - coalesce((SELECT sum(allocated_amount) FROM public.payment_allocations WHERE payment_id = p.id), 0))::numeric(14, 2)::text AS unapplied_amount
       FROM public.payments p
       LEFT JOIN public.customers c ON c.id = p.customer_id
       LEFT JOIN public.invoices inv_direct ON inv_direct.id = p.invoice_id
       LEFT JOIN public.users u ON u.id = p.recorded_by
       WHERE p.id = $1`,
      [paymentId]
    );
    if (!payRes.rowCount) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', `Payment #${paymentId} was not found.`);
    }

    const allocRes = await poolOrClient.query(
      `SELECT pa.id, pa.payment_id, pa.invoice_id, i.invoice_no, i.total::text AS invoice_total,
              i.status AS invoice_status, pa.allocated_amount::text, pa.created_at, pa.notes
       FROM public.payment_allocations pa
       JOIN public.invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = $1 ORDER BY pa.id ASC`,
      [paymentId]
    );

    return {
      ...payRes.rows[0],
      allocations: allocRes.rows
    };
  }

  /**
   * Fetch all allocation records contributing to a specific invoice.
   */
  static async getInvoiceAllocations(poolOrClient, invoiceId) {
    const res = await poolOrClient.query(
      `SELECT pa.id, pa.payment_id, pa.invoice_id, pa.allocated_amount::text AS amount,
              p.method, p.paid_at, p.reference, p.bank_name, p.bank_account, p.notes,
              pa.created_at, p.recorded_by, u.username AS recorded_by_username
       FROM public.payment_allocations pa
       JOIN public.payments p ON p.id = pa.payment_id
       LEFT JOIN public.users u ON u.id = p.recorded_by
       WHERE pa.invoice_id = $1
       ORDER BY pa.id ASC`,
      [invoiceId]
    );
    return res.rows;
  }
}

module.exports = { PaymentService };
