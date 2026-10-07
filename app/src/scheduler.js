const { writeLog } = require('./logger');
const { inTransaction } = require('./db');
const { recordAudit } = require('./audit');

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

let schedulerTimer = null;

function startScheduler(pool, intervalMs = 60000) {
  if (schedulerTimer) return;
  writeLog('info', 'scheduler.started', { interval_ms: intervalMs });

  // Initial check after 5 seconds
  setTimeout(() => {
    runRecurringCycle(pool).catch(err => writeLog('error', 'scheduler.run_error', { error: err.message }));
  }, 5000);

  // Periodic recurring check
  schedulerTimer = setInterval(() => {
    runRecurringCycle(pool).catch(err => writeLog('error', 'scheduler.run_error', { error: err.message }));
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
  startScheduler,
  stopScheduler
};
