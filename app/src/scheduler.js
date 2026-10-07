const { writeLog } = require('./logger');
const { inTransaction } = require('./db');
const { recordAudit } = require('./audit');
const { PaymentService } = require('./services/paymentService');

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
              r.auto_settle_unapplied,
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
            `SELECT id, status, completed_cycles, total_cycles, next_run_date
             FROM public.recurring_plans WHERE id = $1 FOR UPDATE`,
            [plan.id]
          );
          const currentPlan = lockedRes.rows[0];
          if (!currentPlan || currentPlan.status !== 'ACTIVE') return;

          // Calculate due date (30 days from today)
          const dueDateRes = await txClient.query(`SELECT (current_date + interval '30 days')::date AS due_date`);
          const dueDate = dueDateRes.rows[0].due_date;

          // 1. Create invoice in DRAFT
          const invRes = await txClient.query(
            `INSERT INTO public.invoices (customer_id, due_date, tax_rate, notes)
             VALUES ($1, $2, 0.10, $3) RETURNING id`,
            [plan.customer_id, dueDate, `Phát sinh tự động theo hợp đồng định kỳ ${plan.contract_ref || plan.code}`]
          );
          const invoiceId = invRes.rows[0].id;

          // 2. Add line item
          const cycleNumber = currentPlan.completed_cycles + 1;
          await txClient.query(
            `INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
             VALUES ($1, $2, 1, $3::numeric, $3::numeric)`,
            [invoiceId, `${plan.service_title} (Kỳ cước ${cycleNumber})`, plan.amount_per_period]
          );

          // 3. Recalculate totals
          await txClient.query(
            `UPDATE public.invoices AS invoice
             SET subtotal = totals.subtotal,
                 tax_amount = round(totals.subtotal * 0.10, 2),
                 total = totals.subtotal + round(totals.subtotal * 0.10, 2)
             FROM (
               SELECT coalesce(sum(line_total), 0)::numeric(14, 2) AS subtotal
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

          createdInvoice = {
            id: invoiceId,
            invoice_no: invoiceNo,
            auto_sign: Boolean(plan.auto_sign),
            auto_settle_unapplied: Boolean(plan.auto_settle_unapplied)
          };
        });

        // Audit outside transaction
        await recordAudit(pool, {
          user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
          module: 'recurring',
          action: 'RECURRING_AUTO_GENERATED',
          targetRef: plan.code,
          severity: 'INFO',
          summary: `Hệ thống tự động phát sinh hóa đơn kỳ cước cho thuê bao ${plan.code} (${plan.customer_name})`
        });

        // Auto-settle unapplied cash if invoice was issued and auto_settle_unapplied is enabled
        if (createdInvoice && createdInvoice.auto_sign && createdInvoice.auto_settle_unapplied) {
          const autoAllocKey = `RECURRING-AUTO-ALLOC-INV-${createdInvoice.id}-PLAN-${plan.id}`;
          try {
            const allocResult = await inTransaction(async (allocClient) => {
              return await PaymentService.autoAllocateUnappliedCash(allocClient, {
                customerId: plan.customer_id,
                invoiceId: createdInvoice.id,
                recordedBy: 1, // System User ID
                idempotencyKey: autoAllocKey,
                source: 'SCHEDULER'
              });
            });

            if (!allocResult.is_idempotent_replay) {
              await recordAudit(pool, {
                user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' },
                module: 'payments',
                action: 'PAYMENT_AUTO_ALLOCATED',
                targetRef: allocResult.invoice_no || `INV-${createdInvoice.id}`,
                severity: 'INFO',
                summary: `Tự động phân bổ ${allocResult.allocated_total} ₫ từ ${allocResult.allocations_count} khoản tiền thừa cho hóa đơn ${allocResult.invoice_no} (Nguồn: SCHEDULER)`,
                metadata: {
                  invoice_id: allocResult.invoice_id,
                  invoice_no: allocResult.invoice_no,
                  allocated_total: allocResult.allocated_total,
                  allocations_count: allocResult.allocations_count,
                  payment_ids: allocResult.payment_ids,
                  idempotency_key: autoAllocKey,
                  invoice_status: allocResult.invoice_status,
                  settlement_type: allocResult.settlement_type,
                  allocated_from_unapplied: allocResult.allocated_from_unapplied,
                  previous_paid_total: allocResult.previous_paid_total,
                  new_paid_total: allocResult.new_paid_total,
                  allocations: allocResult.allocations,
                  remaining_unapplied_cash: allocResult.remaining_unapplied_cash
                }
              });
            }
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
            }
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

let schedulerTimer = null;

function startScheduler(pool, intervalMs = 60000) {
  if (schedulerTimer) return;
  writeLog('info', 'scheduler.started', { interval_ms: intervalMs });

  // Initial check after 5 seconds
  setTimeout(() => {
    runRecurringCycle(pool).catch(err => writeLog('error', 'scheduler.recurring_error', { error: err.message }));
    runOverdueScan(pool).catch(err => writeLog('error', 'scheduler.overdue_error', { error: err.message }));
  }, 5000);

  // Periodic check
  schedulerTimer = setInterval(() => {
    runRecurringCycle(pool).catch(err => writeLog('error', 'scheduler.recurring_error', { error: err.message }));
    runOverdueScan(pool).catch(err => writeLog('error', 'scheduler.overdue_error', { error: err.message }));
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
  startScheduler,
  stopScheduler,
  SCHEDULER_LOCK_ID,
  OVERDUE_SCAN_LOCK_ID
};

