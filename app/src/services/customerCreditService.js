const { AppError } = require('../errors');

/**
 * Exact Decimal Arithmetic Helpers using BigInt scaled to cents (100n).
 * Guarantees zero floating-point approximation error for all financial calculations.
 */
function parseToCents(val) {
  if (val === null || val === undefined) return 0n;
  const s = String(val).trim();
  if (!s || s === '0' || s === '0.00') return 0n;

  const isNegative = s.startsWith('-');
  const raw = isNegative ? s.slice(1) : s;
  const parts = raw.split('.');
  const intPart = parts[0] || '0';
  let fracPart = parts[1] || '';

  if (fracPart.length > 2) {
    const extra = Number(fracPart.charAt(2));
    fracPart = fracPart.slice(0, 2);
    let cents = BigInt(intPart) * 100n + BigInt(fracPart.padEnd(2, '0'));
    if (extra >= 5) cents += 1n;
    return isNegative ? -cents : cents;
  }

  const cents = BigInt(intPart) * 100n + BigInt(fracPart.padEnd(2, '0'));
  return isNegative ? -cents : cents;
}

function centsToString(cents) {
  const isNegative = cents < 0n;
  const abs = isNegative ? -cents : cents;
  const intPart = (abs / 100n).toString();
  const fracPart = (abs % 100n).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * CustomerCreditService
 * Single source of business logic for P1.5 Customer Credit, Debt, and Risk management.
 */
class CustomerCreditService {
  /**
   * Calculate live current debt for a customer across all open, uncancelled invoices.
   * Canonical Formula: SUM(total - paid_total - adjusted_total)
   * Status filter: ISSUED, PARTIALLY_PAID, OVERDUE
   * 
   * @param {object} clientOrPool - pg.Pool or pg.Client (transaction)
   * @param {number|string} customerId - Target customer ID
   * @returns {Promise<string>} Canonical decimal string representation (e.g. '0.00')
   */
  static async calculateCurrentDebt(clientOrPool, customerId) {
    if (!clientOrPool || typeof clientOrPool.query !== 'function') {
      throw new Error('A database client or pool is required.');
    }

    const cid = parseInt(customerId, 10);
    if (!cid || cid <= 0 || !Number.isInteger(cid)) {
      throw new AppError(400, 'INVALID_ID', 'Customer ID must be a positive integer.');
    }

    const sql = `
      SELECT coalesce(sum(total - paid_total - adjusted_total), 0)::numeric(14, 2)::text AS current_debt
      FROM public.invoices
      WHERE customer_id = $1
        AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
    `;

    const res = await clientOrPool.query(sql, [cid]);
    return res.rows[0]?.current_debt || '0.00';
  }

  /**
   * Calculate available credit for a given credit limit and current debt.
   * 
   * Rules:
   * - credit_limit = 0 -> unlimited credit ({ unlimited: true, available: null })
   * - credit_limit > 0 -> available = credit_limit - current_debt
   * 
   * @param {number|string} creditLimit
   * @param {number|string} currentDebt
   * @returns {{ unlimited: boolean, available: string|null }}
   */
  static calculateAvailableCredit(creditLimit, currentDebt) {
    const limitCents = parseToCents(creditLimit);
    if (limitCents < 0n) {
      throw new AppError(400, 'INVALID_CREDIT_LIMIT', 'Credit limit cannot be negative.');
    }

    if (limitCents === 0n) {
      return {
        unlimited: true,
        available: null
      };
    }

    const debtCents = parseToCents(currentDebt);
    const availableCents = limitCents - debtCents;

    return {
      unlimited: false,
      available: centsToString(availableCents)
    };
  }

  /**
   * Evaluate customer credit risk FSM based on debt utilization and overdue age.
   * Pure calculation function matching P1.5 Frozen Spec v1.0.0.
   * 
   * FSM Transitions:
   * - LOCKED when:
   *   * oldestOverdueDays > autoLockOverdueDays (Severe Overdue)
   *   OR
   *   * creditLimit > 0 AND currentDebt > creditLimit (Credit Breach)
   * - WARNING when (if not LOCKED):
   *   * 1 <= oldestOverdueDays <= autoLockOverdueDays (Minor Overdue)
   *   OR
   *   * creditLimit > 0 AND currentDebt >= 80% creditLimit (High Utilization)
   * - ACTIVE when:
   *   * No applicable warning or lock conditions.
   * 
   * @param {object} params
   * @param {number|string} params.creditLimit
   * @param {number|string} params.currentDebt
   * @param {number} [params.oldestOverdueDays=0]
   * @param {number} [params.autoLockOverdueDays=30]
   * @returns {{ targetStatus: 'ACTIVE'|'WARNING'|'LOCKED', reason: string|null, lockSource: 'AUTO_RISK'|null }}
   */
  static evaluateCreditRisk({
    creditLimit,
    currentDebt,
    oldestOverdueDays = 0,
    autoLockOverdueDays = 30
  }) {
    const limitCents = parseToCents(creditLimit);
    const debtCents = parseToCents(currentDebt);
    const overdueDays = Number.isInteger(Number(oldestOverdueDays))
      ? Math.max(0, parseInt(oldestOverdueDays, 10))
      : 0;
    const thresholdDays = Number.isInteger(Number(autoLockOverdueDays))
      ? parseInt(autoLockOverdueDays, 10)
      : 30;

    // 1. Check LOCKED conditions
    const isOverdueBreach = overdueDays > thresholdDays;
    const isCreditBreach = limitCents > 0n && debtCents > limitCents;

    if (isOverdueBreach || isCreditBreach) {
      let reason;
      if (isOverdueBreach && isCreditBreach) {
        reason = `Hóa đơn quá hạn ${overdueDays} ngày (vượt ngưỡng ${thresholdDays} ngày) và công nợ (${centsToString(debtCents)}) vượt hạn mức tín dụng (${centsToString(limitCents)}).`;
      } else if (isOverdueBreach) {
        reason = `Hóa đơn quá hạn ${overdueDays} ngày (vượt ngưỡng khóa tự động ${thresholdDays} ngày).`;
      } else {
        reason = `Công nợ hiện tại (${centsToString(debtCents)}) vượt quá hạn mức tín dụng (${centsToString(limitCents)}).`;
      }

      return {
        targetStatus: 'LOCKED',
        reason,
        lockSource: 'AUTO_RISK'
      };
    }

    // 2. Check WARNING conditions (if not LOCKED)
    const isOverdueWarning = overdueDays >= 1 && overdueDays <= thresholdDays;
    // Debt utilization >= 80%: debtCents * 100n >= limitCents * 80n
    const isUtilizationWarning = limitCents > 0n &&
      (debtCents * 100n >= limitCents * 80n) &&
      (debtCents <= limitCents);

    if (isOverdueWarning || isUtilizationWarning) {
      let reason;
      if (isOverdueWarning && isUtilizationWarning) {
        const utilPct = Number((debtCents * 10000n) / limitCents) / 100;
        reason = `Hóa đơn quá hạn ${overdueDays} ngày và công nợ đạt ${utilPct.toFixed(2)}% hạn mức tín dụng.`;
      } else if (isOverdueWarning) {
        reason = `Hóa đơn quá hạn ${overdueDays} ngày (trong hạn mức cảnh báo ${thresholdDays} ngày).`;
      } else {
        const utilPct = Number((debtCents * 10000n) / limitCents) / 100;
        reason = `Công nợ đạt ${utilPct.toFixed(2)}% hạn mức tín dụng (ngưỡng cảnh báo >= 80%).`;
      }

      return {
        targetStatus: 'WARNING',
        reason,
        lockSource: null
      };
    }

    // 3. Normal Standing (ACTIVE)
    return {
      targetStatus: 'ACTIVE',
      reason: null,
      lockSource: null
    };
  }

  /**
   * Retrieve the oldest overdue age (in days) for a customer's open OVERDUE invoices.
   * Respects P1.4 overdue lifecycle and positive outstanding balance.
   * 
   * @param {object} clientOrPool
   * @param {number|string} customerId
   * @returns {Promise<number>} Oldest overdue days (0 if none)
   */
  static async getOldestOverdueDays(clientOrPool, customerId) {
    if (!clientOrPool || typeof clientOrPool.query !== 'function') {
      throw new Error('A database client or pool is required.');
    }

    const cid = parseInt(customerId, 10);
    if (!cid || cid <= 0 || !Number.isInteger(cid)) {
      throw new AppError(400, 'INVALID_ID', 'Customer ID must be a positive integer.');
    }

    const sql = `
      SELECT coalesce(max((CURRENT_DATE - due_date)::int), 0) AS oldest_overdue_days
      FROM public.invoices
      WHERE customer_id = $1
        AND status = 'OVERDUE'
        AND (total - paid_total - adjusted_total) > 0
    `;

    const res = await clientOrPool.query(sql, [cid]);
    return parseInt(res.rows[0]?.oldest_overdue_days || 0, 10);
  }

  /**
   * Fortified Invoice Issuance Eligibility Checker.
   * Pre-issue gate executed synchronously inside the caller's transaction.
   * 
   * Strict Safety Constraints:
   * 1. Must run within an active transaction.
   * 2. Locks customer row FOR UPDATE.
   * 3. Rejects if customer.status === 'LOCKED' (HTTP 409 CUSTOMER_IS_LOCKED).
   * 4. Rejects if credit_limit > 0 and (current_debt + invoice_total) > credit_limit (HTTP 409 CREDIT_LIMIT_EXCEEDED).
   * 5. Does NOT mutate database (no invoice update, no customer update, no audit emission).
   * 6. Does NOT lock invoice rows.
   * 
   * @param {object} client - Active PostgreSQL transaction Client
   * @param {object} params
   * @param {number|string} params.customerId - Target customer ID
   * @param {number|string} params.invoiceTotal - Total amount of invoice to issue
   * @returns {Promise<object>} Customer financial snapshot
   */
  static async checkInvoiceIssueEligibility(client, { customerId, invoiceTotal }) {
    if (!client || typeof client.query !== 'function') {
      throw new Error('A PostgreSQL client within a transaction is required.');
    }

    const cid = parseInt(customerId, 10);
    if (!cid || cid <= 0 || !Number.isInteger(cid)) {
      throw new AppError(400, 'INVALID_ID', 'Customer ID must be a positive integer.');
    }

    const invTotalCents = parseToCents(invoiceTotal);
    if (invTotalCents <= 0n) {
      throw new AppError(400, 'INVALID_AMOUNT', 'Invoice total must be a positive decimal.');
    }

    // Step 1: Lock customer row inside transaction
    const custRes = await client.query(
      `SELECT id, name, status, credit_limit::text, lock_source, lock_reason
       FROM public.customers
       WHERE id = $1
       FOR UPDATE`,
      [cid]
    );

    if (custRes.rowCount === 0) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
    }

    const customer = custRes.rows[0];

    // Step 2: Reject if customer is locked
    if (customer.status === 'LOCKED') {
      const err = new AppError(409, 'CUSTOMER_IS_LOCKED', 'Customer credit is locked.');
      err.customer_id = customer.id;
      err.customer_status = customer.status;
      err.lock_source = customer.lock_source;
      err.lock_reason = customer.lock_reason;
      throw err;
    }

    // Step 3: Compute live open debt via MVCC SELECT (no invoice row locks)
    const currentDebtStr = await CustomerCreditService.calculateCurrentDebt(client, cid);
    const currentDebtCents = parseToCents(currentDebtStr);
    const limitCents = parseToCents(customer.credit_limit);
    const projectedDebtCents = currentDebtCents + invTotalCents;

    // Step 4: Evaluate credit limit (if positive)
    if (limitCents > 0n && projectedDebtCents > limitCents) {
      const excessCents = projectedDebtCents - limitCents;
      const details = {
        customer_id: customer.id,
        credit_limit: centsToString(limitCents),
        current_debt: centsToString(currentDebtCents),
        invoice_total: centsToString(invTotalCents),
        projected_debt: centsToString(projectedDebtCents),
        excess_amount: centsToString(excessCents)
      };

      const err = new AppError(409, 'CREDIT_LIMIT_EXCEEDED', 'Invoice total exceeds available credit limit.');
      err.details = details;
      Object.assign(err, details);
      throw err;
    }

    // Step 5: Compute available credit string
    const available = limitCents === 0n ? null : centsToString(limitCents - currentDebtCents);

    return {
      eligible: true,
      customer_id: customer.id,
      status: customer.status,
      credit_limit: centsToString(limitCents),
      current_debt: centsToString(currentDebtCents),
      invoice_total: centsToString(invTotalCents),
      projected_debt: centsToString(projectedDebtCents),
      available_credit: available
    };
  }

  /**
   * Non-enforcing Credit Snapshot Helper for Manager Override.
   * Acquires customer row lock FOR UPDATE and computes exact live credit/debt
   * snapshot without enforcing the normal issue gate (does NOT reject on LOCKED or credit breach).
   *
   * @param {object} client - Active PostgreSQL transaction Client
   * @param {object} params
   * @param {number|string} params.customerId
   * @param {number|string} params.invoiceTotal
   * @returns {Promise<object>} Detailed financial & credit snapshot
   */
  static async getInvoiceCreditSnapshot(client, { customerId, invoiceTotal }) {
    if (!client || typeof client.query !== 'function') {
      throw new Error('A PostgreSQL client within a transaction is required.');
    }

    const cid = parseInt(customerId, 10);
    if (!cid || cid <= 0 || !Number.isInteger(cid)) {
      throw new AppError(400, 'INVALID_ID', 'Customer ID must be a positive integer.');
    }

    const invTotalCents = parseToCents(invoiceTotal);
    if (invTotalCents <= 0n) {
      throw new AppError(400, 'INVALID_AMOUNT', 'Invoice total must be a positive decimal.');
    }

    // Step 1: Lock customer row inside transaction (Level 2 lock)
    const custRes = await client.query(
      `SELECT id, name, status, credit_limit::text, lock_source, locked_at, lock_reason
       FROM public.customers
       WHERE id = $1
       FOR UPDATE`,
      [cid]
    );

    if (custRes.rowCount === 0) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
    }

    const customer = custRes.rows[0];

    // Step 2: Compute live open debt via MVCC SELECT (no invoice row locks)
    const currentDebtStr = await CustomerCreditService.calculateCurrentDebt(client, cid);
    const currentDebtCents = parseToCents(currentDebtStr);
    const limitCents = parseToCents(customer.credit_limit);
    const projectedDebtCents = currentDebtCents + invTotalCents;

    // Step 3: Compute amount over limit
    let amountOverLimitCents = 0n;
    if (limitCents > 0n && projectedDebtCents > limitCents) {
      amountOverLimitCents = projectedDebtCents - limitCents;
    }

    return {
      customer_id: customer.id,
      customer_name: customer.name,
      customer_status: customer.status,
      credit_limit: centsToString(limitCents),
      current_debt: centsToString(currentDebtCents),
      invoice_total: centsToString(invTotalCents),
      projected_debt: centsToString(projectedDebtCents),
      amount_over_limit: centsToString(amountOverLimitCents),
      lock_source: customer.lock_source,
      locked_at: customer.locked_at,
      lock_reason: customer.lock_reason
    };
  }
}

CustomerCreditService.parseToCents = parseToCents;
CustomerCreditService.centsToString = centsToString;

module.exports = CustomerCreditService;
module.exports.CustomerCreditService = CustomerCreditService;
module.exports.parseToCents = parseToCents;
module.exports.centsToString = centsToString;
