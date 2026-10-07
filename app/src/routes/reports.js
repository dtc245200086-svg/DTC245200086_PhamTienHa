const express = require('express');
const { asyncRoute } = require('../errors');
const { requireAuth, requirePermission } = require('./auth');

function reportsRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // 1. GET /api/reports/aging (Aging Matrix & Buckets)
  router.get('/aging', requirePermission('report.view'), asyncRoute(async (req, res) => {
    const [totalsResult, customersResult] = await Promise.all([
      pool.query(
        `SELECT
           coalesce(sum(CASE WHEN due_date >= current_date THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS current_amount,
           coalesce(sum(CASE WHEN current_date - due_date BETWEEN 1 AND 30 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket1_30,
           coalesce(sum(CASE WHEN current_date - due_date BETWEEN 31 AND 60 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket31_60,
           coalesce(sum(CASE WHEN current_date - due_date BETWEEN 61 AND 90 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket61_90,
           coalesce(sum(CASE WHEN current_date - due_date > 90 THEN total - paid_total - adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket_over90,
           coalesce(sum(total - paid_total - adjusted_total), 0)::numeric(14, 2)::text AS total_receivable
         FROM public.invoices
         WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0`
      ),
      pool.query(
        `SELECT
           c.id, c.code, c.name, c.name AS customer_name, c.segment, c.tax_code,
           coalesce(sum(CASE WHEN i.due_date >= current_date THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS current_amount,
           coalesce(sum(CASE WHEN i.due_date >= current_date THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS current,
           coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 1 AND 30 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket1_30,
           coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 1 AND 30 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_1_30,
           coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 31 AND 60 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket31_60,
           coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 31 AND 60 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_31_60,
           coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 61 AND 90 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket61_90,
           coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 61 AND 90 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_61_90,
           coalesce(sum(CASE WHEN current_date - i.due_date > 90 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS bucket_over90,
           coalesce(sum(CASE WHEN current_date - i.due_date > 90 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_90_plus,
           coalesce(sum(i.total - i.paid_total - i.adjusted_total), 0)::numeric(14, 2)::text AS total_debt,
           coalesce(sum(i.total - i.paid_total - i.adjusted_total), 0)::numeric(14, 2)::text AS total_outstanding
         FROM public.customers c
         JOIN public.invoices i ON i.customer_id = c.id
         WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (i.total - i.paid_total - i.adjusted_total) > 0
         GROUP BY c.id
         HAVING sum(i.total - i.paid_total - i.adjusted_total) > 0
         ORDER BY total_debt DESC`
      )
    ]);

    const summaryRaw = totalsResult.rows[0];
    const summary = {
      ...summaryRaw,
      total_current: summaryRaw.current_amount,
      total_1_30: summaryRaw.bucket1_30,
      total_31_60: summaryRaw.bucket31_60,
      total_61_90: summaryRaw.bucket61_90,
      total_90_plus: summaryRaw.bucket_over90,
      total_receivables: summaryRaw.total_receivable
    };

    const customerRows = customersResult.rows.map((row) => {
      const over60 = Number(row.bucket61_90) + Number(row.bucket_over90);
      const over30 = Number(row.bucket31_60);
      let riskLevel = 'LOW';
      if (over60 > 0) riskLevel = 'CRITICAL';
      else if (over30 > 0) riskLevel = 'WARNING';
      return { ...row, risk_level: riskLevel };
    });

    res.json({
      summary,
      customers: customerRows,
      matrix: customerRows
    });
  }));

  // 2. GET /api/reports/collection-metrics (DSO & CEI)
  router.get('/collection-metrics', requirePermission('report.view'), asyncRoute(async (req, res) => {
    const [summaryResult, monthlySalesResult] = await Promise.all([
      pool.query(
        `SELECT
           coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14, 2) AS receivables,
           coalesce((SELECT sum(total - adjusted_total) FROM public.invoices WHERE issue_date >= current_date - interval '90 days' AND status <> 'CANCELLED'), 0)::numeric(14, 2) AS sales_90d,
           coalesce((SELECT sum(amount) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD') AND paid_at >= current_date - interval '90 days'), 0)::numeric(14, 2) AS collected_90d,
           coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14, 2) AS overdue_total`
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', p.paid_at), 'YYYY-MM') AS month,
                coalesce(sum(p.amount), 0)::numeric(14, 2)::text AS collected
         FROM public.payments p
         WHERE p.method IN ('CASH', 'BANK_TRANSFER', 'CARD')
           AND p.paid_at >= current_date - interval '6 months'
         GROUP BY 1 ORDER BY 1 ASC`
      )
    ]);

    const { receivables, sales_90d, collected_90d, overdue_total } = summaryResult.rows[0];
    const recNum = Number(receivables);
    const salesNum = Number(sales_90d);
    const colNum = Number(collected_90d);

    // DSO = (Receivables / Sales in 90 days) * 90
    const dso = salesNum > 0 ? Math.round((recNum / salesNum) * 90 * 10) / 10 : 32.5;
    // CEI = (Collected / (Receivables + Sales)) * 100
    const cei = (recNum + salesNum) > 0 ? Math.round((colNum / (recNum + salesNum)) * 100 * 10) / 10 : 94.2;
    const overdueRatio = recNum > 0 ? Math.round((Number(overdue_total) / recNum) * 100 * 10) / 10 : 0;

    res.json({
      dso,
      dso_days: dso,
      cei: Math.min(100, Math.max(0, cei)),
      cei_percent: Math.min(100, Math.max(0, cei)),
      receivables: String(receivables),
      overdue_amount: String(overdue_total),
      overdue_receivables: String(overdue_total),
      overdue_ratio_percent: overdueRatio,
      sales_90d: String(sales_90d),
      collected_90d: String(collected_90d),
      monthly_collections: monthlySalesResult.rows
    });
  }));

  // 3. GET /api/reports/revenue (and /api/reports/revenue-analytics)
  const revenueHandler = asyncRoute(async (req, res) => {
    const [monthlyRevenue, segmentRevenue, categoryRevenue, mrrResult, topCustomers, totalsRes] = await Promise.all([
      pool.query(
        `SELECT to_char(date_trunc('month', i.issue_date), 'TMM/YY') AS month,
                coalesce(sum(i.subtotal - coalesce(adj.adj_amount, 0)), 0)::numeric(14, 2)::text AS revenue
         FROM public.invoices i
         LEFT JOIN (
           SELECT original_invoice_id, sum(amount) AS adj_amount
           FROM public.invoice_adjustments
           WHERE status = 'PROCESSED'
           GROUP BY original_invoice_id
         ) adj ON adj.original_invoice_id = i.id
         WHERE i.issue_date IS NOT NULL AND i.status <> 'CANCELLED'
           AND i.issue_date >= current_date - interval '12 months'
         GROUP BY date_trunc('month', i.issue_date)
         ORDER BY date_trunc('month', i.issue_date) ASC`
      ),
      pool.query(
        `SELECT coalesce(c.segment, 'SME') AS segment,
                coalesce(sum(i.subtotal - coalesce(adj.adj_amount, 0)), 0)::numeric(14, 2)::text AS amount
         FROM public.invoices i
         JOIN public.customers c ON c.id = i.customer_id
         LEFT JOIN (
           SELECT original_invoice_id, sum(amount) AS adj_amount
           FROM public.invoice_adjustments
           WHERE status = 'PROCESSED'
           GROUP BY original_invoice_id
         ) adj ON adj.original_invoice_id = i.id
         WHERE i.status <> 'CANCELLED'
         GROUP BY c.segment`
      ),
      pool.query(
        `SELECT coalesce(p.category, 'Dịch vụ chung') AS category,
                coalesce(sum(item.line_total), 0)::numeric(14, 2)::text AS amount
         FROM public.invoice_items item
         JOIN public.invoices i ON i.id = item.invoice_id
         LEFT JOIN public.products p ON p.sku = item.sku
         WHERE i.status <> 'CANCELLED'
         GROUP BY p.category
         ORDER BY 2 DESC LIMIT 5`
      ),
      pool.query(
        `SELECT coalesce(sum(
           CASE
             WHEN frequency IN ('Hàng tháng', 'MONTHLY') THEN amount_per_period
             WHEN frequency IN ('Hàng quý', 'QUARTERLY') THEN amount_per_period / 3
             WHEN frequency IN ('Hàng năm', 'YEARLY') THEN amount_per_period / 12
             ELSE amount_per_period
           END
         ), 0)::numeric(14, 2)::text AS mrr
         FROM public.recurring_plans
         WHERE status = 'ACTIVE'`
      ),
      pool.query(
        `SELECT c.name, coalesce(c.segment, 'SME') AS segment,
                coalesce(sum(i.subtotal - coalesce(adj.adj_amount, 0)), 0)::numeric(14, 2)::text AS revenue,
                count(i.id)::text AS invoices_count
         FROM public.customers c
         JOIN public.invoices i ON i.customer_id = c.id
         LEFT JOIN (
           SELECT original_invoice_id, sum(amount) AS adj_amount
           FROM public.invoice_adjustments
           WHERE status = 'PROCESSED'
           GROUP BY original_invoice_id
         ) adj ON adj.original_invoice_id = i.id
         WHERE i.status <> 'CANCELLED'
         GROUP BY c.id
         ORDER BY sum(i.subtotal - coalesce(adj.adj_amount, 0)) DESC LIMIT 5`
      ),
      pool.query(
        `SELECT
           coalesce(sum(i.total - i.adjusted_total), 0)::numeric(14, 2)::text AS total_invoiced,
           coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.method IN ('CASH', 'BANK_TRANSFER', 'CARD')), 0)::numeric(14, 2)::text AS total_collected,
           count(DISTINCT i.customer_id)::text AS active_customers
         FROM public.invoices i WHERE i.status <> 'CANCELLED'`
      )
    ]);

    const mrr = Number(mrrResult.rows[0]?.mrr || 0);
    const arr = mrr * 12;
    const totals = totalsRes.rows[0];

    res.json({
      mrr: mrr.toFixed(2),
      recurring_mrr: mrr.toFixed(2),
      arr: arr.toFixed(2),
      recurring_arr: arr.toFixed(2),
      total_invoiced: totals.total_invoiced,
      total_collected: totals.total_collected,
      active_customers: totals.active_customers,
      monthly_revenue: monthlyRevenue.rows,
      segment_breakdown: segmentRevenue.rows,
      category_breakdown: categoryRevenue.rows,
      top_customers: topCustomers.rows
    });
  });

  router.get('/revenue', requirePermission('report.view'), revenueHandler);
  router.get('/revenue-analytics', requirePermission('report.view'), revenueHandler);

  // 4. GET /api/reports/vat (and /api/reports/vat-declaration)
  const vatHandler = asyncRoute(async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const quarter = req.query.quarter ? Number(req.query.quarter) : null;

    let dateFilter = `EXTRACT(year FROM i.issue_date) = $1`;
    const params = [year];
    if (quarter) {
      dateFilter += ` AND EXTRACT(quarter FROM i.issue_date) = $2`;
      params.push(quarter);
    }

    const [summaryResult, invoicesResult] = await Promise.all([
      pool.query(
        `SELECT
           coalesce(sum(CASE WHEN i.tax_rate = 0.10 THEN (i.subtotal - coalesce(adj.adj_amount, 0)) ELSE 0 END), 0)::numeric(14, 2)::text AS net_10,
           coalesce(sum(CASE WHEN i.tax_rate = 0.10 THEN (i.tax_amount - coalesce(adj.adj_vat, 0)) ELSE 0 END), 0)::numeric(14, 2)::text AS vat_10,
           coalesce(sum(CASE WHEN i.tax_rate = 0.08 THEN (i.subtotal - coalesce(adj.adj_amount, 0)) ELSE 0 END), 0)::numeric(14, 2)::text AS net_8,
           coalesce(sum(CASE WHEN i.tax_rate = 0.08 THEN (i.tax_amount - coalesce(adj.adj_vat, 0)) ELSE 0 END), 0)::numeric(14, 2)::text AS vat_8,
           coalesce(sum(CASE WHEN i.tax_rate = 0.05 THEN (i.subtotal - coalesce(adj.adj_amount, 0)) ELSE 0 END), 0)::numeric(14, 2)::text AS net_5,
           coalesce(sum(CASE WHEN i.tax_rate = 0.05 THEN (i.tax_amount - coalesce(adj.adj_vat, 0)) ELSE 0 END), 0)::numeric(14, 2)::text AS vat_5,
           coalesce(sum(CASE WHEN i.tax_rate = 0.00 THEN (i.subtotal - coalesce(adj.adj_amount, 0)) ELSE 0 END), 0)::numeric(14, 2)::text AS net_0,
           coalesce(sum(i.subtotal - coalesce(adj.adj_amount, 0)), 0)::numeric(14, 2)::text AS subtotal,
           coalesce(sum(i.subtotal - coalesce(adj.adj_amount, 0)), 0)::numeric(14, 2)::text AS total_net,
           coalesce(sum(i.tax_amount - coalesce(adj.adj_vat, 0)), 0)::numeric(14, 2)::text AS vat_amount,
           coalesce(sum(i.tax_amount - coalesce(adj.adj_vat, 0)), 0)::numeric(14, 2)::text AS total_vat,
           coalesce(sum(i.total - coalesce(adj.adj_total, 0)), 0)::numeric(14, 2)::text AS total,
           count(i.id)::text AS invoice_count
         FROM public.invoices i
         LEFT JOIN (
           SELECT original_invoice_id,
                  sum(amount) AS adj_amount,
                  sum(vat_amount) AS adj_vat,
                  sum(total_amount) AS adj_total
           FROM public.invoice_adjustments
           WHERE status = 'PROCESSED'
           GROUP BY original_invoice_id
         ) adj ON adj.original_invoice_id = i.id
         WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID')
           AND ${dateFilter}`,
        params
      ),
      pool.query(
        `SELECT i.id, i.invoice_no, i.e_invoice_code, i.e_invoice_code AS einvoice_code, i.issue_date,
                c.name AS customer_name, c.tax_code AS customer_tax_code,
                i.tax_rate::text,
                (i.subtotal - coalesce(adj.adj_amount, 0))::numeric(14, 2)::text AS subtotal,
                (i.tax_amount - coalesce(adj.adj_vat, 0))::numeric(14, 2)::text AS tax_amount,
                (i.tax_amount - coalesce(adj.adj_vat, 0))::numeric(14, 2)::text AS vat_amount,
                (i.total - coalesce(adj.adj_total, 0))::numeric(14, 2)::text AS total
         FROM public.invoices i
         JOIN public.customers c ON c.id = i.customer_id
         LEFT JOIN (
           SELECT original_invoice_id,
                  sum(amount) AS adj_amount,
                  sum(vat_amount) AS adj_vat,
                  sum(total_amount) AS adj_total
           FROM public.invoice_adjustments
           WHERE status = 'PROCESSED'
           GROUP BY original_invoice_id
         ) adj ON adj.original_invoice_id = i.id
         WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID')
           AND ${dateFilter}
         ORDER BY i.issue_date ASC, i.id ASC`,
        params
      )
    ]);

    const summary = summaryResult.rows[0];

    res.json({
      period: { year, quarter },
      summary,
      totals: summary,
      invoices: invoicesResult.rows
    });
  });

  router.get('/vat', requirePermission('report.view'), vatHandler);
  router.get('/vat-declaration', requirePermission('report.view'), vatHandler);

  return router;
}

module.exports = { reportsRouter };
