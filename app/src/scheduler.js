const { writeLog } = require('./logger');
const { inTransaction } = require('./db');
const { recordAudit } = require('./audit');
const { PaymentService } = require('./services/paymentService');
const CustomerCreditService = require('./services/customerCreditService');
const PaymentTermsService = require('./services/paymentTermsService');

/**
 * Safe date calculation that clamps day-of-month to prevent month rollover (e.g. Jan 31 -> Feb 28).
 */
function addMonthsSafe(dateStr, monthsToAdd) {
  const d = new Date(dateStr);
  const day = d.getUTCDate();
  const currentMonth = d.getUTCMonth();
  const currentYear = d.getUTCFullYear();

  const totalMonths = currentMonth + monthsToAdd;
  const targetYear = currentYear + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // Last day of target month in UTC (passing day 0 of month+1 gives last day of month)
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDayOfTargetMonth);

  const result = new Date(Date.UTC(targetYear, targetMonth, safeDay));
  return result.toISOString().slice(0, 10);
}

function calculateNextSafeDate(currentDateStr, frequency) {
  if (frequency === 'Hàng tháng' || frequency === 'MONTHLY') {
    return addMonthsSafe(currentDateStr, 1);
  } else if (frequency === 'Hàng quý' || frequency === 'QUARTERLY') {
    return addMonthsSafe(currentDateStr, 3);
  } else if (frequency === 'Hàng năm' || frequency === 'YEARLY') {
    return addMonthsSafe(currentDateStr, 12);
  }
  return addMonthsSafe(currentDateStr, 1);
}

const SCHEDULER_LOCK_ID = 88812345;

/**
 * Run a recurring billing cycle. Uses PostgreSQL advisory lock to prevent duplicate concurrent runs.
 */
async function runRecurringCycle(pool) {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    // 1. Try acquire advisory lock
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [SCHEDULER_LOCK_ID]);
    lockAcquired = lockRes.rows[0]?.acquired;
    if (!lockAcquired) {
      writeLog('debug', 'scheduler.skipped_locked', { lock_id: SCHEDULER_LOCK_ID });
      return { skipped: true, reason: 'LOCKED' };
    }

    // 2. Fetch plans due today or earlier
    const duePlans = await client.query(
      `SELECT r.id, r.code, r.customer_id, r.service_title, r.contract_ref,
              r.frequency, r.amount_per_period::text, r.next_run_date,
              r.completed_cycles, r.total_cycles, r.status, r.auto_sign,
              r.auto_settle_unapplied, r.vat_rate::text, r.payment_term_id,
              c.name AS customer_name
       FROM public.recurring_plans r
       JOIN public.customers c ON c.id = r.customer_id
       WHERE r.status = 'ACTIVE' AND r.next_run_date <= current_date
       ORDER BY r.id ASC`
    );

    let processedCount = 0;
    const generatedInvoices = [];

    for (const plan of duePlans.rows) {
      try {
        let createdInvoice = null;
        await inTransaction(async (txClient) => {
          // Re-lock plan row in transaction
          const lockedRes = await txClient.query(
            `SELECT id, status, completed_cycles, total_cycles, next_run_date,
                    vat_rate::text, payment_term_id,
                    (next_run_date <= current_date) AS is_due
             FROM public.recurring_plans WHERE id = $1 FOR UPDATE`,
            [plan.id]
          );
          const currentPlan = lockedRes.rows[0];
          if (!currentPlan || currentPlan.status !== 'ACTIVE' || !currentPlan.is_due) return;

          // Check company settings for credit control
          const settingsRes = await txClient.query(
            'SELECT credit_control_enabled FROM public.company_settings WHERE id = 1'
          );
          const creditControlEnabled = settingsRes.rows[0]?.credit_control_enabled !== false;

          const planVatRate = currentPlan.vat_rate;
          if (planVatRate === null || planVatRate === undefined) {
            throw new Error(`Recurring plan ${plan.code} is missing vat_rate.`);
          }

          // Authoritative decimal calculation via PostgreSQL NUMERIC to eliminate JavaScript floating-point errors
          const calcRes = await txClient.query(
            `SELECT
               ($1::numeric(14, 2))::text AS unit_price,
               round(($1::numeric(14, 2)) * ($2::numeric(5, 4)), 2)::text AS vat_amount,
               (($1::numeric(14, 2)) + round(($1::numeric(14, 2)) * ($2::numeric(5, 4)), 2))::text AS total_amount`,
            [plan.amount_per_period, planVatRate]
          );
          const { unit_price: unitPrice, vat_amount: vatAmountStr, total_amount: projectedTotal } = calcRes.rows[0];

          // Credit Risk Pre-Issuance Gate (if enabled)
          if (creditControlEnabled) {
            try {
              await CustomerCreditService.checkInvoiceIssueEligibility(txClient, {
                customerId: plan.customer_id,
                invoiceTotal: projectedTotal
              });
            } catch (riskErr) {
              // Block auto-generation and record audit
              await txClient.query(
                `UPDATE public.recurring_plans
                 SET last_error = $2
                 WHERE id = $1`,
                [plan.id, riskErr.message]
              );

              await recordAudit(txClient, {
                user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
                module: 'recurring',
                action: 'RECURRING_INVOICE_BLOCKED_BY_RISK',
                targetRef: plan.code,
                severity: 'WARNING',
                summary: `Chặn sinh hóa đơn định kỳ cho thuê bao ${plan.code} (${plan.customer_name}) do kiểm soát tín dụng: ${riskErr.message}`,
                metadata: {
                  plan_id: plan.id,
                  plan_code: plan.code,
                  customer_id: plan.customer_id,
                  error_code: riskErr.code,
                  error_message: riskErr.message,
                  details: riskErr.details || null
                },
                throwOnError: true
              });

              return; // Do NOT create invoice or advance cycle
            }
          }

          // Calculate authoritative due date from customer payment term or plan payment term
          const curDateRes = await txClient.query('SELECT current_date::text AS cd');
          const currentDate = curDateRes.rows[0].cd;
          const termResolution = await PaymentTermsService.calculateAuthoritativeDueDate(txClient, {
            paymentTermId: currentPlan.payment_term_id,
            customerId: plan.customer_id,
            baseDate: currentDate
          });
          const dueDate = termResolution.dueDate;
          const paymentTermId = termResolution.term?.id || currentPlan.payment_term_id || null;

          // 1. Create invoice in DRAFT
          const invRes = await txClient.query(
            `INSERT INTO public.invoices (customer_id, due_date, tax_rate, payment_term_id, notes)
             VALUES ($1, $2, $3::numeric, $4, $5) RETURNING id`,
            [plan.customer_id, dueDate, planVatRate, paymentTermId, `Phát sinh tự động theo hợp đồng định kỳ ${plan.contract_ref || plan.code}`]
          );
          const invoiceId = invRes.rows[0].id;

          // 2. Add line item with authoritative VAT columns
          const cycleNumber = currentPlan.completed_cycles + 1;
          await txClient.query(
            `INSERT INTO public.invoice_items
              (invoice_id, description, quantity, unit_price, line_total, vat_rate, vat_amount, total_amount)
             VALUES ($1, $2, 1, $3::numeric, $3::numeric, $4::numeric, $5::numeric, $6::numeric)`,
            [
              invoiceId,
              `${plan.service_title} (Kỳ cước ${cycleNumber})`,
              unitPrice,
              planVatRate,
              vatAmountStr,
              projectedTotal
            ]
          );

          // 3. Recalculate totals
          await txClient.query(
            `UPDATE public.invoices AS invoice
             SET subtotal = totals.subtotal,
                 tax_amount = totals.tax_amount,
                 total = totals.subtotal + totals.tax_amount
             FROM (
               SELECT coalesce(sum(line_total), 0)::numeric(14, 2) AS subtotal,
                      coalesce(sum(vat_amount), 0)::numeric(14, 2) AS tax_amount
               FROM public.invoice_items WHERE invoice_id = $1
             ) AS totals
             WHERE invoice.id = $1`,
            [invoiceId]
          );

          let invoiceNo = null;
          let eInvoiceCode = null;

          // 4. Auto sign if configured
          if (plan.auto_sign) {
            const seqRes = await txClient.query(
              `SELECT format('INV-%s-%s', to_char(current_date, 'YYYY'),
                 lpad(nextval('public.invoice_no_seq')::text, 6, '0')) AS invoice_no`
            );
            invoiceNo = seqRes.rows[0].invoice_no;
            eInvoiceCode = `1C25TND-${invoiceNo.split('-')[2]}`;
            await txClient.query(
              `UPDATE public.invoices
               SET invoice_no = $2, e_invoice_code = $3, status = 'ISSUED', issue_date = current_date
               WHERE id = $1`,
              [invoiceId, invoiceNo, eInvoiceCode]
            );
          }

          // 5. Advance plan cycle and calculate next safe date
          const nextSafeDate = calculateNextSafeDate(currentPlan.next_run_date, plan.frequency);
          const isCompleted = currentPlan.total_cycles && cycleNumber >= currentPlan.total_cycles;
          const nextStatus = isCompleted ? 'COMPLETED' : 'ACTIVE';

          await txClient.query(
            `UPDATE public.recurring_plans
             SET completed_cycles = $2, next_run_date = $3, status = $4, last_error = null
             WHERE id = $1`,
            [plan.id, cycleNumber, nextSafeDate, nextStatus]
          );

          processedCount++;
          generatedInvoices.push({
            plan_code: plan.code,
            invoice_id: invoiceId,
            invoice_no: invoiceNo || `DRAFT-${invoiceId}`,
            next_run_date: nextSafeDate
          });

          // Audit inside transaction
          await recordAudit(txClient, {
            user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
            module: 'recurring',
            action: 'RECURRING_INVOICE_GENERATED',
            targetRef: invoiceNo || plan.code,
            severity: 'INFO',
            summary: `Hệ thống tự động phát sinh hóa đơn ${invoiceNo || `DRAFT-${invoiceId}`} cho thuê bao ${plan.code} (${plan.customer_name})`,
            metadata: {
              plan_id: plan.id,
              plan_code: plan.code,
              invoice_id: invoiceId,
              invoice_no: invoiceNo,
              customer_id: plan.customer_id,
              total_amount: projectedTotal
            },
            throwOnError: true
          });

          createdInvoice = {
            id: invoiceId,
            invoice_no: invoiceNo,
            auto_sign: Boolean(plan.auto_sign),
            auto_settle_unapplied: Boolean(plan.auto_settle_unapplied)
          };
        });

        // Auto-settle unapplied cash if invoice was issued and auto_settle_unapplied is enabled
        if (createdInvoice && createdInvoice.auto_sign && createdInvoice.auto_settle_unapplied) {
          const autoAllocKey = `RECURRING-AUTO-ALLOC-INV-${createdInvoice.id}-PLAN-${plan.id}`;
          try {
            const allocResult = await inTransaction(async (allocClient) => {
              const res = await PaymentService.autoAllocateUnappliedCash(allocClient, {
                customerId: plan.customer_id,
                invoiceId: createdInvoice.id,
                recordedBy: 1, // System User ID
                idempotencyKey: autoAllocKey,
                source: 'SCHEDULER'
              });

              if (!res.is_idempotent_replay) {
                await recordAudit(allocClient, {
                  user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
                  module: 'payments',
                  action: 'PAYMENT_AUTO_ALLOCATED',
                  targetRef: res.invoice_no || `INV-${createdInvoice.id}`,
                  severity: 'INFO',
                  summary: `Tự động phân bổ ${res.allocated_total} ₫ từ ${res.allocations_count} khoản tiền thừa cho hóa đơn ${res.invoice_no} (Nguồn: SCHEDULER)`,
                  metadata: {
                    invoice_id: res.invoice_id,
                    invoice_no: res.invoice_no,
                    allocated_total: res.allocated_total,
                    allocations_count: res.allocations_count,
                    payment_ids: res.payment_ids,
                    idempotency_key: autoAllocKey,
                    invoice_status: res.invoice_status,
                    settlement_type: res.settlement_type,
                    allocated_from_unapplied: res.allocated_from_unapplied,
                    previous_paid_total: res.previous_paid_total,
                    new_paid_total: res.new_paid_total,
                    allocations: res.allocations,
                    remaining_unapplied_cash: res.remaining_unapplied_cash
                  },
                  throwOnError: true
                });
              }

              return res;
            });
          } catch (allocErr) {
            if (allocErr.code === 'NO_UNAPPLIED_CASH_AVAILABLE') {
              writeLog('info', 'scheduler.no_unapplied_cash', {
                plan_id: plan.id,
                invoice_id: createdInvoice.id,
                customer_id: plan.customer_id
              });
            } else {
              writeLog('error', 'scheduler.auto_settle_failed', {
                plan_id: plan.id,
                invoice_id: createdInvoice.id,
                error: allocErr.message
              });
            }
          }
        }
      } catch (err) {
        writeLog('error', 'scheduler.plan_execution_failed', { plan_id: plan.id, error: err.message });
        await pool.query(
          `UPDATE public.recurring_plans SET last_error = $2 WHERE id = $1`,
          [plan.id, err.message]
        ).catch(() => {});
      }
    }

    if (processedCount > 0) {
      writeLog('info', 'scheduler.cycle_completed', { processed: processedCount, total_due: duePlans.rowCount });
    }

    return { processed: processedCount, invoices: generatedInvoices };
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}

const OVERDUE_SCAN_LOCK_ID = 88812346;

/**
 * Scan for open invoices past their due date and transition them to OVERDUE.
 * Uses dedicated PostgreSQL advisory lock (88812346) and single-invoice row transaction locking.
 */
async function runOverdueScan(pool) {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [OVERDUE_SCAN_LOCK_ID]);
    lockAcquired = lockRes.rows[0]?.acquired;
    if (!lockAcquired) {
      writeLog('debug', 'scheduler.overdue_scan_skipped_locked', { lock_id: OVERDUE_SCAN_LOCK_ID });
      return { skipped: true, reason: 'LOCKED' };
    }

    // Step 1: Query candidate invoices past due_date that still have outstanding debt
    const candidatesRes = await client.query(
      `SELECT id, invoice_no, due_date, total::text, paid_total::text, adjusted_total::text,
              (CURRENT_DATE - due_date)::int AS days_overdue,
              (total - paid_total - adjusted_total)::numeric(14, 2)::text AS outstanding_amount
       FROM public.invoices
       WHERE status IN ('ISSUED', 'PARTIALLY_PAID')
         AND due_date < CURRENT_DATE
         AND (total - paid_total - adjusted_total) > 0
       ORDER BY id ASC`
    );

    let processedCount = 0;
    const flaggedInvoices = [];

    // Step 2: Process each candidate invoice in its own isolated transaction with row-level lock
    for (const candidate of candidatesRes.rows) {
      try {
        await inTransaction(async (txClient) => {
          // Re-lock the single invoice row for update
          const lockRowRes = await txClient.query(
            `SELECT id, invoice_no, due_date, total, paid_total, adjusted_total, status,
                    (CURRENT_DATE - due_date)::int AS days_overdue,
                    (total - paid_total - adjusted_total)::numeric(14, 2)::text AS outstanding_amount
             FROM public.invoices
             WHERE id = $1
             FOR UPDATE`,
            [candidate.id]
          );

          if (!lockRowRes.rowCount) return;
          const inv = lockRowRes.rows[0];

          // Re-verify eligibility inside the exclusive row lock
          if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) return;
          const outstandingNum = Number(inv.outstanding_amount);
          if (outstandingNum <= 0.0001) return;
          if (inv.days_overdue <= 0) return;

          // Transition invoice status to OVERDUE
          await txClient.query(
            `UPDATE public.invoices
             SET status = 'OVERDUE'
             WHERE id = $1`,
            [inv.id]
          );

          const formattedDueDate = inv.due_date instanceof Date
            ? inv.due_date.toISOString().slice(0, 10)
            : String(inv.due_date);

          // Record chained SHA-256 audit entry
          await recordAudit(txClient, {
            user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
            ip: '127.0.0.1',
            module: 'invoices',
            action: 'INVOICE_OVERDUE_FLAGGED',
            targetRef: inv.invoice_no,
            severity: 'WARNING',
            summary: `Hóa đơn ${inv.invoice_no} quá hạn thanh toán ${inv.days_overdue} ngày, chuyển trạng thái sang OVERDUE`,
            metadata: {
              invoice_id: Number(inv.id),
              invoice_no: inv.invoice_no,
              due_date: formattedDueDate,
              days_overdue: Number(inv.days_overdue),
              outstanding_amount: inv.outstanding_amount,
              scanned_at: new Date().toISOString()
            },
            throwOnError: true
          });

          processedCount++;
          flaggedInvoices.push({
            id: Number(inv.id),
            invoice_no: inv.invoice_no,
            days_overdue: Number(inv.days_overdue),
            outstanding_amount: inv.outstanding_amount
          });
        });
      } catch (err) {
        writeLog('error', 'scheduler.overdue_invoice_failed', {
          invoice_id: candidate.id,
          error: err.message
        });
      }
    }

    if (processedCount > 0) {
      writeLog('info', 'scheduler.overdue_scan_completed', {
        flagged_count: processedCount,
        candidates_found: candidatesRes.rowCount
      });
    }

    return { processed: processedCount, invoices: flaggedInvoices };
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [OVERDUE_SCAN_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}

const CUSTOMER_RISK_SCAN_LOCK_ID = 88812347;

/**
 * Scan customers for credit risk and overdue debt, transitioning statuses:
 * ACTIVE -> WARNING
 * ACTIVE -> LOCKED
 * WARNING -> LOCKED
 *
 * Uses dedicated PostgreSQL advisory lock (88812347) and per-customer row transaction locking.
 * Never acquires invoice row locks (pure MVCC reads on invoices).
 * Never automatically unlocks LOCKED customers.
 *
 * @param {object} pool - pg.Pool instance
 * @param {object} [options]
 * @param {number|string} [options.customerId] - Target specific customer ID
 * @param {number[]|string[]} [options.customerIds] - Target specific customer IDs
 * @param {boolean} [options.skipAdvisoryLock=false] - For isolated concurrency sub-tests
 * @returns {Promise<{ processed: number, transitions: Array, skipped?: boolean, reason?: string }>}
 */
async function runCustomerRiskScan(pool, options = {}) {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    if (!options.skipAdvisoryLock) {
      const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [CUSTOMER_RISK_SCAN_LOCK_ID]);
      lockAcquired = lockRes.rows[0]?.acquired;
      if (!lockAcquired) {
        writeLog('debug', 'scheduler.customer_risk_scan_skipped_locked', { lock_id: CUSTOMER_RISK_SCAN_LOCK_ID });
        return { skipped: true, reason: 'LOCKED', processed: 0, transitions: [] };
      }
    }

    // Step 1: Read company settings
    const settingsRes = await client.query(
      `SELECT auto_lock_overdue_days, credit_control_enabled
       FROM public.company_settings
       WHERE id = 1`
    );
    const settings = settingsRes.rows[0] || { auto_lock_overdue_days: 30, credit_control_enabled: true };

    if (settings.credit_control_enabled === false) {
      writeLog('info', 'scheduler.customer_risk_scan_skipped_disabled');
      return { skipped: true, reason: 'CREDIT_CONTROL_DISABLED', processed: 0, transitions: [] };
    }

    const autoLockOverdueDays = parseInt(settings.auto_lock_overdue_days, 10) || 30;

    // Step 2: Determine candidate customer IDs
    let candidateIds = [];
    if (options.customerId) {
      candidateIds = [parseInt(options.customerId, 10)];
    } else if (Array.isArray(options.customerIds)) {
      candidateIds = options.customerIds.map(id => parseInt(id, 10));
    } else {
      // Non-locking candidate discovery
      const candidatesRes = await client.query(
        `SELECT DISTINCT c.id
         FROM public.customers c
         WHERE c.status IN ('ACTIVE', 'WARNING')
           AND (
             EXISTS (
               SELECT 1 FROM public.invoices i
               WHERE i.customer_id = c.id
                 AND i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
                 AND (i.total - i.paid_total - i.adjusted_total) > 0
                 AND (i.due_date < CURRENT_DATE OR c.credit_limit > 0)
             )
           )
         ORDER BY c.id ASC`
      );
      candidateIds = candidatesRes.rows.map(r => r.id);
    }

    let processedCount = 0;
    const transitions = [];

    // Step 3: Process each candidate in its own isolated transaction with Customer row FOR UPDATE
    for (const cid of candidateIds) {
      try {
        await inTransaction(async (txClient) => {
          // Lock the single customer row FOR UPDATE (Level 2 lock)
          const custRes = await txClient.query(
            `SELECT id, code, name, status, credit_limit::text, lock_source, locked_at, lock_reason
             FROM public.customers
             WHERE id = $1
             FOR UPDATE`,
            [cid]
          );

          if (!custRes.rowCount) return;
          const customer = custRes.rows[0];

          // Re-verify: Never mutate already LOCKED customers
          if (customer.status === 'LOCKED') return;

          // Pure MVCC SELECT on invoices for live current debt
          const debtRes = await txClient.query(
            `SELECT coalesce(sum(total - paid_total - adjusted_total), 0)::numeric(14, 2)::text AS current_debt
             FROM public.invoices
             WHERE customer_id = $1
               AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')`,
            [customer.id]
          );
          const currentDebt = debtRes.rows[0]?.current_debt || '0.00';

          // Pure MVCC SELECT on invoices for overdue age and count
          const overdueRes = await txClient.query(
            `SELECT coalesce(max((CURRENT_DATE - due_date)::int), 0) AS oldest_overdue_days,
                    count(*) FILTER (WHERE (CURRENT_DATE - due_date) > 0) AS overdue_invoices_count
             FROM public.invoices
             WHERE customer_id = $1
               AND (status = 'OVERDUE' OR (status IN ('ISSUED', 'PARTIALLY_PAID') AND due_date < CURRENT_DATE))
               AND (total - paid_total - adjusted_total) > 0`,
            [customer.id]
          );
          const oldestOverdueDays = parseInt(overdueRes.rows[0]?.oldest_overdue_days || 0, 10);
          const overdueCount = parseInt(overdueRes.rows[0]?.overdue_invoices_count || 0, 10);

          // Evaluate risk FSM using canonical CustomerCreditService
          const riskResult = CustomerCreditService.evaluateCreditRisk({
            creditLimit: customer.credit_limit,
            currentDebt,
            oldestOverdueDays,
            autoLockOverdueDays
          });

          if (riskResult.targetStatus === 'LOCKED') {
            // Transition ACTIVE -> LOCKED or WARNING -> LOCKED
            await txClient.query(
              `UPDATE public.customers
               SET status = 'LOCKED',
                   lock_source = 'AUTO_RISK',
                   locked_at = now(),
                   lock_reason = $2
               WHERE id = $1`,
              [customer.id, riskResult.reason]
            );

            await recordAudit(txClient, {
              user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
              ip: '127.0.0.1',
              module: 'customers',
              action: 'CUSTOMER_STATUS_AUTO_LOCKED',
              targetRef: customer.code,
              severity: 'WARNING',
              summary: `Hệ thống tự động khóa công nợ khách hàng ${customer.name} (${customer.code}): ${customer.status} -> LOCKED. Lý do: ${riskResult.reason}`,
              metadata: {
                customer_id: Number(customer.id),
                customer_code: customer.code,
                customer_name: customer.name,
                status_prior: customer.status,
                previous_status: customer.status,
                target_status: 'LOCKED',
                new_status: 'LOCKED',
                status_after: 'LOCKED',
                transition_source: 'AUTO_RISK',
                lock_source: 'AUTO_RISK',
                lock_reason: riskResult.reason,
                overdue_invoices_count: Number(overdueCount),
                max_overdue_days: Number(oldestOverdueDays),
                current_debt: currentDebt,
                credit_limit: customer.credit_limit,
                scanned_at: new Date().toISOString()
              },
              throwOnError: true
            });

            processedCount++;
            transitions.push({
              customer_id: Number(customer.id),
              customer_code: customer.code,
              customer_name: customer.name,
              status_prior: customer.status,
              status_after: 'LOCKED',
              lock_source: 'AUTO_RISK',
              reason: riskResult.reason
            });
          } else if (riskResult.targetStatus === 'WARNING' && customer.status === 'ACTIVE') {
            // Transition ACTIVE -> WARNING
            await txClient.query(
              `UPDATE public.customers
               SET status = 'WARNING'
               WHERE id = $1`,
              [customer.id]
            );

            await recordAudit(txClient, {
              user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
              ip: '127.0.0.1',
              module: 'customers',
              action: 'CUSTOMER_STATUS_AUTO_WARNING',
              targetRef: customer.code,
              severity: 'INFO',
              summary: `Hệ thống tự động chuyển khách hàng ${customer.name} (${customer.code}) sang trạng thái WARNING. Lý do: ${riskResult.reason}`,
              metadata: {
                customer_id: Number(customer.id),
                customer_code: customer.code,
                customer_name: customer.name,
                status_prior: customer.status,
                previous_status: customer.status,
                target_status: 'WARNING',
                new_status: 'WARNING',
                status_after: 'WARNING',
                transition_source: 'AUTO_RISK',
                warning_reason: riskResult.reason,
                lock_reason: riskResult.reason,
                overdue_invoices_count: Number(overdueCount),
                max_overdue_days: Number(oldestOverdueDays),
                current_debt: currentDebt,
                credit_limit: customer.credit_limit,
                scanned_at: new Date().toISOString()
              },
              throwOnError: true
            });

            processedCount++;
            transitions.push({
              customer_id: Number(customer.id),
              customer_code: customer.code,
              customer_name: customer.name,
              status_prior: customer.status,
              status_after: 'WARNING',
              reason: riskResult.reason
            });
          }
          // If targetStatus === 'WARNING' and customer.status === 'WARNING', or targetStatus === 'ACTIVE', no action
        });
      } catch (err) {
        writeLog('error', 'scheduler.customer_risk_evaluation_failed', {
          customer_id: cid,
          error: err.message
        });
      }
    }

    if (processedCount > 0) {
      writeLog('info', 'scheduler.customer_risk_scan_completed', {
        processed_count: processedCount,
        candidates_count: candidateIds.length
      });
    }

    return { processed: processedCount, transitions, skipped: false };
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [CUSTOMER_RISK_SCAN_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}

let schedulerTimer = null;

function startScheduler(pool, intervalMs = 60000) {
  if (schedulerTimer) return;
  writeLog('info', 'scheduler.started', { interval_ms: intervalMs });

  // Initial check after 5 seconds
  setTimeout(() => {
    runRecurringCycle(pool).catch(err => writeLog('error', 'scheduler.recurring_error', { error: err.message }));
    runOverdueScan(pool).catch(err => writeLog('error', 'scheduler.overdue_error', { error: err.message }));
    runCustomerRiskScan(pool).catch(err => writeLog('error', 'scheduler.risk_scan_error', { error: err.message }));
  }, 5000);

  // Periodic check
  schedulerTimer = setInterval(() => {
    runRecurringCycle(pool).catch(err => writeLog('error', 'scheduler.recurring_error', { error: err.message }));
    runOverdueScan(pool).catch(err => writeLog('error', 'scheduler.overdue_error', { error: err.message }));
    runCustomerRiskScan(pool).catch(err => writeLog('error', 'scheduler.risk_scan_error', { error: err.message }));
  }, intervalMs);
}

function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    writeLog('info', 'scheduler.stopped');
  }
}

module.exports = {
  addMonthsSafe,
  calculateNextSafeDate,
  runRecurringCycle,
  runOverdueScan,
  runCustomerRiskScan,
  startScheduler,
  stopScheduler,
  SCHEDULER_LOCK_ID,
  OVERDUE_SCAN_LOCK_ID,
  CUSTOMER_RISK_SCAN_LOCK_ID
};

