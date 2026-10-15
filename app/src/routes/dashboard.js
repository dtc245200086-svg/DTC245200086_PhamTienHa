const express = require('express');
const { asyncRoute } = require('../errors');
const { requireAuth, requireRole, requirePermission } = require('./auth');

function dashboardRouter(pool) {
  const router = express.Router();

  // 1. GET /api/dashboard/summary (Legacy & General summary)
  router.get('/dashboard/summary', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    const [totals, statuses, overdue, activeCustomers] = await Promise.all([
      pool.query(
        `SELECT
           coalesce((SELECT sum(amount) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD')), 0)::numeric(14, 2)::text AS collected,
           coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
             WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)::numeric(14, 2)::text AS outstanding`
      ),
      pool.query('SELECT status, count(*)::text AS count FROM public.invoices GROUP BY status'),
      pool.query(
        `SELECT count(*)::text AS count FROM public.invoices
         WHERE due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0`
      ),
      pool.query(
        `SELECT count(DISTINCT customer_id)::text AS count FROM public.invoices WHERE status <> 'CANCELLED'`
      )
    ]);
    const byStatus = Object.fromEntries(statuses.rows.map((row) => [row.status, row.count]));
    res.json({
      collected: totals.rows[0].collected,
      outstanding: totals.rows[0].outstanding,
      by_status: byStatus,
      overdue_count: overdue.rows[0].count,
      active_customers: activeCustomers.rows[0]?.count || '10'
    });
  }));

  // 2. GET /api/dashboard/admin-analytics (System administration & technical oversight - ADMIN only)
  const adminAnalyticsHandler = asyncRoute(async (req, res) => {
    const [roleDist, activityTrend, invoiceVolume, moduleActivity, securityStats, userStats, recentAudits] = await Promise.all([
      // A. Donut: User by 3-tier roles (ADMIN, DIRECTOR, STAFF)
      pool.query(`
        SELECT
          CASE
            WHEN upper(role) IN ('ADMIN') THEN 'ADMIN'
            WHEN upper(role) IN ('DIRECTOR', 'ROLE_BILLING_MANAGER') THEN 'DIRECTOR'
            ELSE 'STAFF'
          END AS role,
          count(*)::int AS count
        FROM public.users
        GROUP BY 1
        ORDER BY 1
      `),
      // B. Line Chart: System activity over last 14 days
      pool.query(`
        SELECT
          to_char(timestamp, 'YYYY-MM-DD') AS date,
          count(*)::int AS count
        FROM public.audit_logs
        WHERE timestamp >= current_date - interval '14 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      // C. Column Chart: Monthly invoice creation volume
      pool.query(`
        SELECT
          to_char(date_trunc('month', coalesce(issue_date, created_at::date)), 'YYYY-MM') AS month,
          count(*)::int AS count
        FROM public.invoices
        WHERE created_at >= current_date - interval '12 months'
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      // D. Horizontal Bar: Top business activity by module
      pool.query(`
        SELECT
          module,
          count(*)::int AS count
        FROM public.audit_logs
        GROUP BY module
        ORDER BY count DESC
        LIMIT 6
      `),
      // Security and audit counts
      pool.query(`
        SELECT
          count(*) FILTER (WHERE severity IN ('WARNING', 'CRITICAL'))::int AS security_events,
          count(*)::int AS total_audit_events
        FROM public.audit_logs
      `),
      // User counts
      pool.query(`
        SELECT
          count(*)::int AS total_users,
          count(*) FILTER (WHERE is_active = true)::int AS active_users
        FROM public.users
      `),
      // Recent audit events
      pool.query(`
        SELECT id, to_char(timestamp, 'YYYY-MM-DD HH24:MI:SS') AS timestamp,
               actor_name, actor_role, action, module, severity
        FROM public.audit_logs
        ORDER BY id DESC
        LIMIT 5
      `)
    ]);

    res.json({
      user_roles: roleDist.rows,
      system_activity: activityTrend.rows,
      invoice_volume: invoiceVolume.rows,
      module_activity: moduleActivity.rows,
      security_events: securityStats.rows[0]?.security_events || 0,
      total_audit_events: securityStats.rows[0]?.total_audit_events || 0,
      total_users: userStats.rows[0]?.total_users || 0,
      active_users: userStats.rows[0]?.active_users || 0,
      recent_audits: recentAudits.rows
    });
  });

  router.get('/dashboard/admin-analytics', requireAuth, requireRole('admin'), adminAnalyticsHandler);
  router.get('/admin/analytics', requireAuth, requireRole('admin'), adminAnalyticsHandler);

  // 3. GET /api/dashboard/director-analytics (Executive financial leadership & analytics - ADMIN & DIRECTOR)
  router.get('/dashboard/director-analytics', requireAuth, requireRole('admin', 'director'), asyncRoute(async (req, res) => {
    const period = String(req.query.period || '6m').toLowerCase();
    let intervalClause = "interval '6 months'";
    if (period === '7d') intervalClause = "interval '7 days'";
    else if (period === '30d') intervalClause = "interval '30 days'";
    else if (period === '3m') intervalClause = "interval '3 months'";
    else if (period === '12m') intervalClause = "interval '12 months'";
    else if (period === 'all') intervalClause = null;

    const dateFilter = intervalClause ? `AND coalesce(issue_date, created_at::date) >= current_date - ${intervalClause}` : '';

    const [
      revenueTrend,
      statusDistribution,
      monthlyStacked,
      agingResult,
      topCustomers,
      kpiTotals,
      collectionMetrics,
      mrrResult,
      pipelineResult
    ] = await Promise.all([
      // A. Line Chart: Monthly Revenue trend
      pool.query(`
        SELECT to_char(date_trunc('month', i.issue_date), 'YYYY-MM') AS month,
               coalesce(sum(i.total - i.adjusted_total), 0)::numeric(14,2)::text AS revenue
        FROM public.invoices i
        WHERE i.issue_date IS NOT NULL AND i.status <> 'CANCELLED' ${dateFilter}
        GROUP BY 1 ORDER BY 1 ASC
      `),
      // B. Donut Chart: Invoice Status Distribution
      pool.query(`
        SELECT status, count(*)::int AS count,
               coalesce(sum(total - adjusted_total), 0)::numeric(14,2)::text AS total_amount
        FROM public.invoices
        GROUP BY status
        ORDER BY count DESC
      `),
      // C. Stacked Bar Chart: Invoiced vs Collected & Outstanding by month
      pool.query(`
        SELECT to_char(date_trunc('month', coalesce(i.issue_date, i.created_at::date)), 'YYYY-MM') AS month,
               coalesce(sum(i.total - i.adjusted_total), 0)::numeric(14,2)::text AS invoiced,
               coalesce(sum(i.paid_total), 0)::numeric(14,2)::text AS collected,
               coalesce(sum(CASE WHEN i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14,2)::text AS outstanding
        FROM public.invoices i
        WHERE i.status <> 'CANCELLED' ${dateFilter}
        GROUP BY 1 ORDER BY 1 ASC
      `),
      // D. Aging Bar: Receivables Aging Buckets
      pool.query(`
        SELECT
          coalesce(sum(CASE WHEN due_date >= current_date THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS current_amount,
          coalesce(sum(CASE WHEN current_date - due_date BETWEEN 1 AND 30 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket1_30,
          coalesce(sum(CASE WHEN current_date - due_date BETWEEN 31 AND 60 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket31_60,
          coalesce(sum(CASE WHEN current_date - due_date BETWEEN 61 AND 90 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket61_90,
          coalesce(sum(CASE WHEN current_date - due_date > 90 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket_over90,
          coalesce(sum(total - paid_total - adjusted_total), 0)::numeric(14, 2)::text AS total_receivable
        FROM public.invoices
        WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0
      `),
      // E. Horizontal Bar: Top Customers by Revenue
      pool.query(`
        SELECT c.id, c.code, c.name,
               coalesce(sum(i.total - i.adjusted_total), 0)::numeric(14,2)::text AS revenue,
               count(i.id)::int AS invoices_count
        FROM public.customers c
        JOIN public.invoices i ON i.customer_id = c.id
        WHERE i.status <> 'CANCELLED'
        GROUP BY c.id, c.code, c.name
        ORDER BY sum(i.total - i.adjusted_total) DESC
        LIMIT 6
      `),
      // Executive KPIs
      pool.query(`
        SELECT
          coalesce((SELECT sum(total - adjusted_total) FROM public.invoices WHERE status <> 'CANCELLED'), 0)::numeric(14,2)::text AS revenue,
          coalesce((SELECT sum(amount) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD')), 0)::numeric(14,2)::text AS collected,
          coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), 0)::numeric(14,2)::text AS receivables,
          coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14,2)::text AS overdue_amount,
          coalesce((SELECT count(*) FROM public.invoices WHERE due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::int AS overdue_count
      `),
      // DSO and CEI baseline
      pool.query(`
        SELECT
          coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14, 2) AS receivables,
          coalesce((SELECT sum(total - adjusted_total) FROM public.invoices WHERE issue_date >= current_date - interval '90 days' AND status <> 'CANCELLED'), 0)::numeric(14, 2) AS sales_90d,
          coalesce((SELECT sum(amount) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD') AND paid_at >= current_date - interval '90 days'), 0)::numeric(14, 2) AS collected_90d,
          coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE due_date >= current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14, 2) AS current_total,
          coalesce((
            SELECT sum(greatest(0, (i.total - i.adjusted_total) - coalesce(p_before.paid_before, 0)))
            FROM public.invoices i
            LEFT JOIN (
              SELECT pa.invoice_id, sum(pa.allocated_amount) AS paid_before
              FROM public.payment_allocations pa
              JOIN public.payments p ON p.id = pa.payment_id
              WHERE p.paid_at < current_date - interval '90 days'
              GROUP BY pa.invoice_id
            ) p_before ON p_before.invoice_id = i.id
            WHERE i.issue_date < current_date - interval '90 days' AND i.status <> 'CANCELLED'
          ), 0)::numeric(14, 2) AS beginning_receivables
      `),
      // MRR & ARR
      pool.query(`
        SELECT coalesce(sum(
          CASE
            WHEN frequency IN ('Hàng tháng', 'MONTHLY') THEN amount_per_period
            WHEN frequency IN ('Hàng quý', 'QUARTERLY') THEN amount_per_period / 3
            WHEN frequency IN ('Hàng năm', 'YEARLY') THEN amount_per_period / 12
            ELSE amount_per_period
          END
        ), 0)::numeric(14, 2)::text AS mrr
        FROM public.recurring_plans
        WHERE status = 'ACTIVE'
      `),
      // Actual invoice conversion pipeline (Issued -> Payment Active -> Fully Settled)
      pool.query(`
        SELECT
          count(*) FILTER (WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'))::int AS total_issued,
          count(*) FILTER (WHERE paid_total > 0 AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'))::int AS payment_active,
          count(*) FILTER (WHERE status = 'PAID')::int AS fully_settled
        FROM public.invoices
      `)
    ]);

    const coll = collectionMetrics.rows[0];
    const recNum = Number(coll.receivables);
    const salesNum = Number(coll.sales_90d);
    const colNum = Number(coll.collected_90d);
    const begRecNum = Number(coll.beginning_receivables);
    const currentRecNum = Number(coll.current_total);

    let dso = salesNum > 0 ? Math.round((recNum / salesNum) * 90 * 10) / 10 : (recNum === 0 ? 0 : null);
    const eligibleDebt = Math.round((begRecNum + salesNum - currentRecNum) * 100) / 100;
    let cei = null;
    if (eligibleDebt > 0) {
      cei = Math.round(Math.min(100, Math.max(0, (colNum / eligibleDebt) * 100)) * 10) / 10;
    }

    const mrr = Number(mrrResult.rows[0]?.mrr || 0);
    const arr = mrr * 12;

    const pipeline = pipelineResult.rows[0] || { total_issued: 0, payment_active: 0, fully_settled: 0 };

    res.json({
      period,
      revenue_trend: revenueTrend.rows,
      status_distribution: statusDistribution.rows,
      monthly_stacked: monthlyStacked.rows,
      aging: agingResult.rows[0],
      top_customers: topCustomers.rows,
      kpis: {
        revenue: kpiTotals.rows[0].revenue,
        collected: kpiTotals.rows[0].collected,
        receivables: kpiTotals.rows[0].receivables,
        overdue_amount: kpiTotals.rows[0].overdue_amount,
        overdue_count: kpiTotals.rows[0].overdue_count,
        dso: dso !== null ? dso : 0,
        cei: cei !== null ? cei : 0,
        mrr: mrr.toFixed(2),
        arr: arr.toFixed(2)
      },
      pipeline: {
        total_issued: pipeline.total_issued,
        payment_active: pipeline.payment_active,
        fully_settled: pipeline.fully_settled,
        conversion_rate: pipeline.total_issued > 0 ? Math.round((pipeline.fully_settled / pipeline.total_issued) * 100 * 10) / 10 : 0,
        note: 'Chu trình thanh toán B2B: Khách hàng thanh toán trước hạn hoặc phân bổ từng phần; không áp dụng phễu 5 tầng đơn chiều nhằm bảo toàn tính xác thực số liệu tài chính.'
      }
    });
  }));

  // 4. GET /api/dashboard/staff-analytics (Operational workload & work item queues - invoice.read)
  router.get('/dashboard/staff-analytics', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    const [workloadRes, invoiceStatusRes, urgentInvoicesRes] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT count(*)::int FROM public.invoices WHERE status = 'DRAFT') AS draft_invoices,
          (SELECT count(*)::int FROM public.invoices WHERE status = 'ISSUED') AS issued_invoices,
          (SELECT count(*)::int FROM public.invoices WHERE status = 'OVERDUE') AS overdue_invoices,
          (SELECT count(*)::int FROM (
            SELECT p.id FROM public.payments p
            LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
            GROUP BY p.id, p.amount
            HAVING coalesce(sum(pa.allocated_amount), 0) < p.amount
          ) sub) AS unallocated_payments,
          (SELECT count(*)::int FROM public.bank_transactions WHERE status = 'UNMATCHED') AS unmatched_bank_txs,
          (SELECT count(*)::int FROM public.invoice_adjustments WHERE status = 'DRAFT') AS pending_adjustments,
          (SELECT count(*)::int FROM public.customers WHERE status IN ('WARNING', 'LOCKED')) AS warning_customers
      `),
      pool.query(`
        SELECT status, count(*)::int AS count
        FROM public.invoices
        WHERE status IN ('DRAFT', 'ISSUED', 'OVERDUE', 'PAID')
        GROUP BY status
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT i.id, i.invoice_no, c.name AS customer_name, i.total, i.status, i.due_date
        FROM public.invoices i
        LEFT JOIN public.customers c ON c.id = i.customer_id
        WHERE i.status IN ('OVERDUE', 'DRAFT', 'ISSUED')
        ORDER BY CASE WHEN i.status = 'OVERDUE' THEN 1 WHEN i.status = 'DRAFT' THEN 2 ELSE 3 END, i.due_date ASC
        LIMIT 6
      `)
    ]);

    res.json({
      workload: workloadRes.rows[0],
      invoice_status: invoiceStatusRes.rows,
      urgent_invoices: urgentInvoicesRes.rows
    });
  }));

  // 5. GET /api/dashboard/invoices-analytics (Module chart - invoice.read)
  router.get('/dashboard/invoices-analytics', requireAuth, requirePermission('invoice.read'), asyncRoute(async (req, res) => {
    const [statuses, monthly] = await Promise.all([
      pool.query(`
        SELECT status, count(*)::int AS count,
               coalesce(sum(total - adjusted_total), 0)::numeric(14,2)::text AS total_amount
        FROM public.invoices
        GROUP BY status
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT to_char(date_trunc('month', coalesce(issue_date, created_at::date)), 'YYYY-MM') AS month,
               count(*)::int AS count,
               coalesce(sum(total - adjusted_total), 0)::numeric(14,2)::text AS revenue
        FROM public.invoices
        WHERE created_at >= current_date - interval '6 months'
        GROUP BY 1 ORDER BY 1 ASC
      `)
    ]);
    res.json({ statuses: statuses.rows, monthly: monthly.rows });
  }));

  // 6. GET /api/dashboard/payments-analytics (Module chart - payment.read)
  router.get('/dashboard/payments-analytics', requireAuth, requirePermission('payment.read'), asyncRoute(async (req, res) => {
    const [methods, monthly] = await Promise.all([
      pool.query(`
        SELECT method, count(*)::int AS count,
               coalesce(sum(amount), 0)::numeric(14,2)::text AS total_amount
        FROM public.payments
        GROUP BY method
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month,
               count(*)::int AS count,
               coalesce(sum(amount), 0)::numeric(14,2)::text AS total_collected
        FROM public.payments
        WHERE paid_at >= current_date - interval '6 months'
        GROUP BY 1 ORDER BY 1 ASC
      `)
    ]);
    res.json({ methods: methods.rows, monthly: monthly.rows });
  }));

  // 7. GET /api/dashboard/reconciliation-analytics (Module chart - reconciliation.manage)
  router.get('/dashboard/reconciliation-analytics', requireAuth, requirePermission('reconciliation.manage'), asyncRoute(async (req, res) => {
    const [statuses] = await Promise.all([
      pool.query(`
        SELECT status, count(*)::int AS count,
               coalesce(sum(amount), 0)::numeric(14,2)::text AS total_amount
        FROM public.bank_transactions
        GROUP BY status
        ORDER BY count DESC
      `)
    ]);
    res.json({ statuses: statuses.rows });
  }));

  return router;
}

module.exports = { dashboardRouter };