const express = require('express');
const { asyncRoute } = require('../errors');
const { requireAuth, requirePermission } = require('./auth');
const { sendCsvResponse, UTF8_BOM } = require('../csv');

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

  // GET /api/reports/aging/export.csv (Server-side unpaginated Aging Report CSV export)
  router.get('/aging/export.csv', requirePermission('report.view'), asyncRoute(async (req, res) => {
    const riskFilter = req.query.risk ? req.query.risk.toUpperCase() : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const customersResult = await pool.query(
      `SELECT
         c.id, c.code, c.name, c.name AS customer_name, c.segment, c.tax_code,
         coalesce(sum(CASE WHEN i.due_date >= current_date THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS current_amount,
         coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 1 AND 30 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_1_30,
         coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 31 AND 60 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_31_60,
         coalesce(sum(CASE WHEN current_date - i.due_date BETWEEN 61 AND 90 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_61_90,
         coalesce(sum(CASE WHEN current_date - i.due_date > 90 THEN i.total - i.paid_total - i.adjusted_total ELSE 0 END), 0)::numeric(14, 2)::text AS days_90_plus,
         coalesce(sum(i.total - i.paid_total - i.adjusted_total), 0)::numeric(14, 2)::text AS total_debt
       FROM public.customers c
       JOIN public.invoices i ON i.customer_id = c.id
       WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (i.total - i.paid_total - i.adjusted_total) > 0
       GROUP BY c.id
       HAVING sum(i.total - i.paid_total - i.adjusted_total) > 0
       ORDER BY total_debt DESC`
    );

    let customerRows = customersResult.rows.map((row) => {
      const over60 = Number(row.days_61_90) + Number(row.days_90_plus);
      const over30 = Number(row.days_31_60);
      let riskLevel = 'LOW';
      if (over60 > 0) riskLevel = 'CRITICAL';
      else if (over30 > 0) riskLevel = 'WARNING';
      return { ...row, risk_level: riskLevel };
    });

    if (riskFilter) {
      customerRows = customerRows.filter(c => c.risk_level === riskFilter);
    }
    if (search) {
      const s = search.toLowerCase();
      customerRows = customerRows.filter(c => (c.name || '').toLowerCase().includes(s) || (c.code || '').toLowerCase().includes(s) || (c.tax_code || '').toLowerCase().includes(s));
    }

    const headers = ['Khách hàng', 'Mã KH', 'MST', 'Trong hạn (VND)', 'Quá hạn 1-30d (VND)', 'Quá hạn 31-60d (VND)', 'Quá hạn 61-90d (VND)', 'Nợ xấu >90d (VND)', 'Tổng nợ (VND)', 'Mức độ rủi ro'];
    const rows = customerRows.map(c => [
      c.customer_name || '',
      c.code || '',
      c.tax_code || '',
      c.current_amount || '0',
      c.days_1_30 || '0',
      c.days_31_60 || '0',
      c.days_61_90 || '0',
      c.days_90_plus || '0',
      c.total_debt || '0',
      c.risk_level || 'LOW'
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `bao_cao_tuoi_no_${dateStr}.csv`,
      headers,
      rows
    });
  }));

  // 2. GET /api/reports/collection-metrics (DSO & CEI)
  router.get('/collection-metrics', requirePermission('report.view'), asyncRoute(async (req, res) => {
    const [summaryResult, monthlySalesResult] = await Promise.all([
      pool.query(
        `SELECT
           -- Ending total open receivables (E)
           coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14, 2) AS receivables,
           -- Credit sales in past 90 days (S)
           coalesce((SELECT sum(total - adjusted_total) FROM public.invoices WHERE issue_date >= current_date - interval '90 days' AND status <> 'CANCELLED'), 0)::numeric(14, 2) AS sales_90d,
           -- Cash collected in past 90 days (C)
           coalesce((SELECT sum(amount) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD') AND paid_at >= current_date - interval '90 days'), 0)::numeric(14, 2) AS collected_90d,
           -- Overdue receivables at end of period (E_overdue)
           coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14, 2) AS overdue_total,
           -- Current (not-overdue) receivables at end of period (E_current)
           coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices WHERE due_date >= current_date AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND (total - paid_total - adjusted_total) > 0), 0)::numeric(14, 2) AS current_total,
           -- Beginning receivables at T - 90d (B)
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
             WHERE i.issue_date < current_date - interval '90 days'
               AND i.status <> 'CANCELLED'
           ), 0)::numeric(14, 2) AS beginning_receivables`
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

    const { receivables, sales_90d, collected_90d, overdue_total, current_total, beginning_receivables } = summaryResult.rows[0];
    const recNum = Number(receivables);
    const salesNum = Number(sales_90d);
    const colNum = Number(collected_90d);
    const begRecNum = Number(beginning_receivables);
    const currentRecNum = Number(current_total);
    const overdueNum = Number(overdue_total);

    // DSO = (Receivables / Sales in 90 days) * 90
    // Explicit documented zero-denominator handling: null when sales is 0 and receivables exist, or 0 if no receivables
    let dso = null;
    if (salesNum > 0) {
      dso = Math.round((recNum / salesNum) * 90 * 10) / 10;
    } else if (recNum === 0) {
      dso = 0;
    }

    // CEI = (Collected / (Beginning Receivables + Credit Sales - Ending Current Receivables)) * 100
    // Canonical CRF (Credit Research Foundation) formula
    const eligibleDebt = Math.round((begRecNum + salesNum - currentRecNum) * 100) / 100;
    let cei = null;
    if (eligibleDebt > 0) {
      const ceiRaw = (colNum / eligibleDebt) * 100;
      cei = Math.round(Math.min(100, Math.max(0, ceiRaw)) * 10) / 10;
    }

    const overdueRatio = recNum > 0 ? Math.round((overdueNum / recNum) * 100 * 10) / 10 : 0;

    res.json({
      dso,
      dso_days: dso,
      cei,
      cei_percent: cei,
      receivables: String(receivables),
      overdue_amount: String(overdue_total),
      overdue_receivables: String(overdue_total),
      overdue_ratio_percent: overdueRatio,
      sales_90d: String(sales_90d),
      collected_90d: String(collected_90d),
      beginning_receivables: String(beginning_receivables),
      current_receivables: String(current_total),
      cei_eligible_amount: eligibleDebt > 0 ? eligibleDebt.toFixed(2) : '0.00',
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
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;

    let dateFilter = '';
    const params = [];
    let year = null;
    let quarter = null;

    if (from && to) {
      params.push(from, to);
      dateFilter = `i.issue_date >= $1 AND i.issue_date <= $2`;
    } else if (from) {
      params.push(from);
      dateFilter = `i.issue_date >= $1`;
    } else if (to) {
      params.push(to);
      dateFilter = `i.issue_date <= $1`;
    } else {
      year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      quarter = req.query.quarter ? Number(req.query.quarter) : null;
      params.push(year);
      dateFilter = `EXTRACT(year FROM i.issue_date) = $1`;
      if (quarter) {
        params.push(quarter);
        dateFilter += ` AND EXTRACT(quarter FROM i.issue_date) = $2`;
      }
    }

    const [summaryResult, invoicesResult, breakdownResult] = await Promise.all([
      pool.query(
        `WITH eligible_invoices AS (
           SELECT i.id, i.issue_date, i.status
           FROM public.invoices i
           WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID')
             AND ${dateFilter}
         ),
         item_stats AS (
           SELECT
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.10 THEN item.line_total ELSE 0 END), 0)::numeric(14, 2) AS net_10,
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.10 THEN item.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS vat_10,
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.08 THEN item.line_total ELSE 0 END), 0)::numeric(14, 2) AS net_8,
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.08 THEN item.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS vat_8,
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.05 THEN item.line_total ELSE 0 END), 0)::numeric(14, 2) AS net_5,
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.05 THEN item.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS vat_5,
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.00 THEN item.line_total ELSE 0 END), 0)::numeric(14, 2) AS net_0,
             coalesce(sum(CASE WHEN round(item.vat_rate, 2) = 0.00 THEN item.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS vat_0,
             coalesce(sum(item.line_total), 0)::numeric(14, 2) AS total_net,
             coalesce(sum(item.vat_amount), 0)::numeric(14, 2) AS total_vat,
             count(DISTINCT item.invoice_id) AS inv_count
           FROM public.invoice_items item
           JOIN eligible_invoices ei ON ei.id = item.invoice_id
         ),
         adj_stats AS (
           SELECT
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.10 THEN adj.amount ELSE 0 END), 0)::numeric(14, 2) AS adj_net_10,
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.10 THEN adj.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS adj_vat_10,
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.08 THEN adj.amount ELSE 0 END), 0)::numeric(14, 2) AS adj_net_8,
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.08 THEN adj.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS adj_vat_8,
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.05 THEN adj.amount ELSE 0 END), 0)::numeric(14, 2) AS adj_net_5,
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.05 THEN adj.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS adj_vat_5,
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.00 THEN adj.amount ELSE 0 END), 0)::numeric(14, 2) AS adj_net_0,
             coalesce(sum(CASE WHEN round(adj.vat_rate, 2) = 0.00 THEN adj.vat_amount ELSE 0 END), 0)::numeric(14, 2) AS adj_vat_0,
             coalesce(sum(adj.amount), 0)::numeric(14, 2) AS total_adj_net,
             coalesce(sum(adj.vat_amount), 0)::numeric(14, 2) AS total_adj_vat
           FROM public.invoice_adjustments adj
           JOIN eligible_invoices ei ON ei.id = adj.original_invoice_id
           WHERE adj.status = 'PROCESSED'
         )
         SELECT
           (it.net_10 - a.adj_net_10)::numeric(14, 2)::text AS net_10,
           (it.vat_10 - a.adj_vat_10)::numeric(14, 2)::text AS vat_10,
           (it.net_8 - a.adj_net_8)::numeric(14, 2)::text AS net_8,
           (it.vat_8 - a.adj_vat_8)::numeric(14, 2)::text AS vat_8,
           (it.net_5 - a.adj_net_5)::numeric(14, 2)::text AS net_5,
           (it.vat_5 - a.adj_vat_5)::numeric(14, 2)::text AS vat_5,
           (it.net_0 - a.adj_net_0)::numeric(14, 2)::text AS net_0,
           (it.vat_0 - a.adj_vat_0)::numeric(14, 2)::text AS vat_0,
           (it.total_net - a.total_adj_net)::numeric(14, 2)::text AS subtotal,
           (it.total_net - a.total_adj_net)::numeric(14, 2)::text AS total_net,
           (it.total_vat - a.total_adj_vat)::numeric(14, 2)::text AS vat_amount,
           (it.total_vat - a.total_adj_vat)::numeric(14, 2)::text AS total_vat,
           ((it.total_net - a.total_adj_net) + (it.total_vat - a.total_adj_vat))::numeric(14, 2)::text AS total,
           it.inv_count::text AS invoice_count
         FROM item_stats it, adj_stats a`,
        params
      ),
      pool.query(
        `SELECT i.id, i.invoice_no, i.e_invoice_code, i.e_invoice_code AS einvoice_code, i.issue_date,
                c.name AS customer_name, c.tax_code AS customer_tax_code,
                i.tax_rate::text,
                (i.subtotal - coalesce(adj.adj_amount, 0))::numeric(14, 2)::text AS subtotal,
                (i.tax_amount - coalesce(adj.adj_vat, 0))::numeric(14, 2)::text AS tax_amount,
                (i.tax_amount - coalesce(adj.adj_vat, 0))::numeric(14, 2)::text AS vat_amount,
                (i.total - coalesce(adj.adj_total, 0))::numeric(14, 2)::text AS total,
                coalesce((
                  SELECT json_agg(json_build_object(
                    'vat_rate', sub.vat_rate::text,
                    'line_net', sub.line_net::text,
                    'line_vat', sub.line_vat::text,
                    'line_total', sub.line_total::text
                  ))
                  FROM (
                    SELECT it.vat_rate,
                           sum(it.line_total)::numeric(14, 2) AS line_net,
                           sum(it.vat_amount)::numeric(14, 2) AS line_vat,
                           sum(it.total_amount)::numeric(14, 2) AS line_total
                    FROM public.invoice_items it
                    WHERE it.invoice_id = i.id
                    GROUP BY it.vat_rate
                    ORDER BY it.vat_rate DESC
                  ) sub
                ), '[]'::json) AS item_vat_breakdown
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
      ),
      pool.query(
        `WITH eligible_invoices AS (
           SELECT i.id
           FROM public.invoices i
           WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID')
             AND ${dateFilter}
         ),
         item_rates AS (
           SELECT
             round(item.vat_rate, 4) AS vat_rate,
             coalesce(sum(item.line_total), 0)::numeric(14, 2) AS net,
             coalesce(sum(item.vat_amount), 0)::numeric(14, 2) AS vat
           FROM public.invoice_items item
           JOIN eligible_invoices ei ON ei.id = item.invoice_id
           GROUP BY round(item.vat_rate, 4)
         ),
         adj_rates AS (
           SELECT
             round(adj.vat_rate, 4) AS vat_rate,
             coalesce(sum(adj.amount), 0)::numeric(14, 2) AS adj_net,
             coalesce(sum(adj.vat_amount), 0)::numeric(14, 2) AS adj_vat
           FROM public.invoice_adjustments adj
           JOIN eligible_invoices ei ON ei.id = adj.original_invoice_id
           WHERE adj.status = 'PROCESSED'
           GROUP BY round(adj.vat_rate, 4)
         ),
         all_rates AS (
           SELECT vat_rate FROM item_rates
           UNION
           SELECT vat_rate FROM adj_rates
         )
         SELECT
           ar.vat_rate::numeric(5, 4)::text AS vat_rate,
           round(ar.vat_rate * 100, 2)::text AS rate_percent,
           (coalesce(ir.net, 0) - coalesce(aj.adj_net, 0))::numeric(14, 2)::text AS net_amount,
           (coalesce(ir.vat, 0) - coalesce(aj.adj_vat, 0))::numeric(14, 2)::text AS vat_amount,
           ((coalesce(ir.net, 0) - coalesce(aj.adj_net, 0)) + (coalesce(ir.vat, 0) - coalesce(aj.adj_vat, 0)))::numeric(14, 2)::text AS total_amount
         FROM all_rates ar
         LEFT JOIN item_rates ir ON ir.vat_rate = ar.vat_rate
         LEFT JOIN adj_rates aj ON aj.vat_rate = ar.vat_rate
         ORDER BY ar.vat_rate DESC`,
        params
      )
    ]);

    const summary = summaryResult.rows[0] || {
      net_10: '0.00',
      vat_10: '0.00',
      net_8: '0.00',
      vat_8: '0.00',
      net_5: '0.00',
      vat_5: '0.00',
      net_0: '0.00',
      vat_0: '0.00',
      subtotal: '0.00',
      total_net: '0.00',
      vat_amount: '0.00',
      total_vat: '0.00',
      total: '0.00',
      invoice_count: '0'
    };

    // CSV export format support
    if (req.query.format === 'csv' || req.query.export === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bang_ke_thue_gtgt_${year || 'custom'}.csv"`);
      let csv = UTF8_BOM + 'Số HĐ,Ngày lập,Tên người mua,Mã số thuế,Thuế suất,Doanh số chưa thuế,Thuế GTGT,Tổng thanh toán\r\n';
      for (const inv of invoicesResult.rows) {
        let rateText;
        if (Array.isArray(inv.item_vat_breakdown) && inv.item_vat_breakdown.length > 1) {
          rateText = `Mixed (${inv.item_vat_breakdown.map(b => `${Number(b.vat_rate) * 100}%`).join('/')})`;
        } else if (Array.isArray(inv.item_vat_breakdown) && inv.item_vat_breakdown.length === 1) {
          rateText = `${Number(inv.item_vat_breakdown[0].vat_rate) * 100}%`;
        } else if (inv.tax_rate !== null && inv.tax_rate !== undefined) {
          rateText = `${Number(inv.tax_rate) * 100}%`;
        } else {
          rateText = '0%';
        }
        csv += `"${inv.invoice_no}","${inv.issue_date}","${inv.customer_name}","${inv.customer_tax_code || ''}","${rateText}",${inv.subtotal},${inv.vat_amount},${inv.total}\r\n`;
      }
      return res.send(csv);
    }

    res.json({
      period: { year, quarter, from, to },
      summary,
      totals: summary,
      rate_breakdown: breakdownResult.rows,
      invoices: invoicesResult.rows
    });
  });

  const vatExportHandler = asyncRoute(async (req, res) => {
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let dateFilter = '';
    const params = [];
    let year = null;
    let quarter = null;

    if (from && to) {
      params.push(from, to);
      dateFilter = `i.issue_date >= $1 AND i.issue_date <= $2`;
    } else if (from) {
      params.push(from);
      dateFilter = `i.issue_date >= $1`;
    } else if (to) {
      params.push(to);
      dateFilter = `i.issue_date <= $1`;
    } else {
      year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      quarter = req.query.quarter ? Number(req.query.quarter) : null;
      params.push(year);
      dateFilter = `EXTRACT(year FROM i.issue_date) = $1`;
      if (quarter) {
        params.push(quarter);
        dateFilter += ` AND EXTRACT(quarter FROM i.issue_date) = $2`;
      }
    }

    const invoicesResult = await pool.query(
      `SELECT i.id, i.invoice_no, i.issue_date,
              c.name AS customer_name, c.tax_code AS customer_tax_code,
              i.tax_rate::text,
              (i.subtotal - coalesce(adj.adj_amount, 0))::numeric(14, 2)::text AS subtotal,
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
    );

    let rows = invoicesResult.rows;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r => (r.invoice_no || '').toLowerCase().includes(s) || (r.customer_name || '').toLowerCase().includes(s) || (r.customer_tax_code || '').includes(s));
    }

    const headers = ['Số HĐ', 'Ngày lập', 'Tên người mua', 'Mã số thuế', 'Thuế suất', 'Doanh số chưa thuế (VND)', 'Thuế GTGT (VND)', 'Tổng thanh toán (VND)'];
    const csvRows = rows.map(inv => [
      inv.invoice_no || '',
      inv.issue_date ? new Date(inv.issue_date).toISOString().slice(0, 10) : '',
      inv.customer_name || '',
      inv.customer_tax_code || '',
      inv.tax_rate ? `${Number(inv.tax_rate) * 100}%` : '0%',
      inv.subtotal || '0',
      inv.vat_amount || '0',
      inv.total || '0'
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `bang_ke_thue_gtgt_${dateStr}.csv`,
      headers,
      rows: csvRows
    });
  });

  router.get('/vat/export.csv', requirePermission('report.view'), vatExportHandler);
  router.get('/vat-declaration/export.csv', requirePermission('report.view'), vatExportHandler);
  router.get('/vat', requirePermission('report.view'), vatHandler);
  router.get('/vat-declaration', requirePermission('report.view'), vatHandler);

  return router;
}

module.exports = { reportsRouter };
