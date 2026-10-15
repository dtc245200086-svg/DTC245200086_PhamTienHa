const express = require('express');
const { asyncRoute } = require('../errors');
const { parsePage, requireDate } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { computeAuditHash } = require('../audit');
const { sendCsvResponse } = require('../csv');

function auditRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/audit-logs (or /api/audit)
  router.get('/', requirePermission('audit.view'), asyncRoute(async (req, res) => {
    const { page, limit, page_size, offset } = parsePage(req.query);
    const severity = req.query.severity ? req.query.severity : null;
    const moduleName = req.query.module ? req.query.module : null;
    const action = req.query.action ? req.query.action : null;
    const username = req.query.username || req.query.actor_name || null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT id, timestamp, actor_id, actor_name, actor_role, ip_address,
                module, action, target_ref, severity, summary, metadata,
                prev_hash, hash, created_at
         FROM public.audit_logs
         WHERE ($1::text IS NULL OR severity = $1)
           AND ($2::text IS NULL OR module = $2)
           AND ($3::text IS NULL OR action = $3)
           AND ($4::text IS NULL OR actor_name ILIKE $4)
           AND ($5::date IS NULL OR timestamp::date >= $5)
           AND ($6::date IS NULL OR timestamp::date <= $6)
           AND ($7::text IS NULL OR actor_name ILIKE $7 OR action ILIKE $7 OR summary ILIKE $7 OR target_ref ILIKE $7 OR module ILIKE $7)
         ORDER BY id DESC LIMIT $8 OFFSET $9`,
        [severity, moduleName, action, username ? `%${username}%` : null, from, to, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.audit_logs
         WHERE ($1::text IS NULL OR severity = $1)
           AND ($2::text IS NULL OR module = $2)
           AND ($3::text IS NULL OR action = $3)
           AND ($4::text IS NULL OR actor_name ILIKE $4)
           AND ($5::date IS NULL OR timestamp::date >= $5)
           AND ($6::date IS NULL OR timestamp::date <= $6)
           AND ($7::text IS NULL OR actor_name ILIKE $7 OR action ILIKE $7 OR summary ILIKE $7 OR target_ref ILIKE $7 OR module ILIKE $7)`,
        [severity, moduleName, action, username ? `%${username}%` : null, from, to, pattern]
      )
    ]);

    const enriched = items.rows.map((row) => ({
      ...row,
      verified: Boolean(row.hash && row.prev_hash),
      hash_preview: row.hash ? `${row.hash.slice(0, 16)}...${row.hash.slice(-8)}` : null,
      prev_hash_preview: row.prev_hash ? `${row.prev_hash.slice(0, 16)}...${row.prev_hash.slice(-8)}` : null
    }));

    res.json({ items: enriched, total: Number(count.rows[0].total), page, limit, page_size: limit });
  }));

  // GET /api/audit/export.csv (Server-side unpaginated Audit Logs CSV export)
  router.get('/export.csv', requirePermission('audit.view'), asyncRoute(async (req, res) => {
    const severity = req.query.severity ? req.query.severity : null;
    const moduleName = req.query.module ? req.query.module : null;
    const action = req.query.action ? req.query.action : null;
    const username = req.query.username || req.query.actor_name || null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const items = await pool.query(
      `SELECT id, timestamp, actor_id, actor_name, actor_role, ip_address,
              module, action, target_ref, severity, summary, hash, created_at
       FROM public.audit_logs
       WHERE ($1::text IS NULL OR severity = $1)
         AND ($2::text IS NULL OR module = $2)
         AND ($3::text IS NULL OR action = $3)
         AND ($4::text IS NULL OR actor_name ILIKE $4)
         AND ($5::date IS NULL OR timestamp::date >= $5)
         AND ($6::date IS NULL OR timestamp::date <= $6)
         AND ($7::text IS NULL OR actor_name ILIKE $7 OR action ILIKE $7 OR summary ILIKE $7 OR target_ref ILIKE $7 OR module ILIKE $7)
       ORDER BY id DESC`,
      [severity, moduleName, action, username ? `%${username}%` : null, from, to, pattern]
    );

    const headers = ['Thời điểm', 'Người thực hiện', 'Vai trò', 'Hành động', 'Phân hệ', 'Đối tượng', 'Mã băm SHA-256', 'Mức độ', 'Địa chỉ IP'];
    const rows = items.rows.map(log => [
      log.timestamp ? new Date(log.timestamp).toLocaleString('vi-VN') : '',
      log.actor_name || `User #${log.actor_id || ''}`,
      log.actor_role || '',
      log.action || '',
      log.module || '',
      log.target_ref || '',
      log.hash || '',
      log.severity || 'INFO',
      log.ip_address || ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `nhat_ky_kiem_toan_${dateStr}.csv`,
      headers,
      rows
    });
  }));

  // Cryptographic Chain Verification Handler (Supports both GET and POST)
  const verifyHandler = asyncRoute(async (req, res) => {
    const rows = (await pool.query('SELECT * FROM public.audit_logs ORDER BY id ASC')).rows;
    let expectedPrevHash = '0'.repeat(64);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      // 1. Check prev_hash linkage
      if (r.prev_hash !== expectedPrevHash) {
        return res.status(200).json({
          verified: false,
          valid: false,
          tampered_record_id: r.id,
          reason: 'PREV_HASH_CHAIN_BROKEN',
          message: `Phát hiện chuỗi băm bị đứt gãy tại bản ghi ID ${r.id}! (prev_hash thực tế không khớp với bản ghi trước)`
        });
      }

      // 2. Recompute hash
      const canonicalData = r.canonical_data !== null && r.canonical_data !== undefined
        ? r.canonical_data
        : (r.metadata ? JSON.stringify(r.metadata) : '');

      const calculatedHash = computeAuditHash({
        prevHash: r.prev_hash,
        timestamp: r.timestamp,
        actorId: r.actor_id,
        actorName: r.actor_name,
        module: r.module,
        action: r.action,
        targetRef: r.target_ref,
        severity: r.severity,
        summary: r.summary,
        canonicalData
      });

      // 3. Verify current hash against calculated hash
      if (r.hash !== calculatedHash) {
        return res.status(200).json({
          verified: false,
          valid: false,
          tampered_record_id: r.id,
          reason: 'HASH_TAMPERED',
          message: `Phát hiện sai lệch mã băm tại bản ghi ID ${r.id}! Nội dung bản ghi đã bị can thiệp trái phép.`
        });
      }

      expectedPrevHash = r.hash;
    }

    res.json({
      verified: true,
      valid: true,
      verified_count: rows.length,
      total_records: rows.length,
      message: `Toàn vẹn chuỗi kiểm toán SHA-256: 100% bản ghi (${rows.length}) đã được xác thực an toàn tuyệt đối.`
    });
  });

  router.get('/verify', requirePermission('audit.view'), verifyHandler);
  router.post('/verify', requirePermission('audit.view'), verifyHandler);

  return router;
}

module.exports = { auditRouter };
