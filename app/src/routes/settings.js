const express = require('express');
const { inTransaction } = require('../db');
const { AppError, asyncRoute } = require('../errors');
const { requireObject, requireText } = require('../validation');
const { requireAuth, requireRole, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');

function settingsRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/settings
  router.get('/', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT id, company_name, tax_code, address, bank_name, bank_account, tax_provider, hsm_serial, updated_at
       FROM public.company_settings WHERE id = 1`
    );
    if (!result.rowCount) {
      // Default fallback
      return res.json({
        settings: {
          id: 1,
          company_name: 'Công ty Cổ phần Công nghệ Tài chính Billing One',
          tax_code: '0109887766',
          address: 'Tòa nhà Keangnam Landmark 72, Đường Phạm Hùng, Hà Nội',
          bank_name: 'Techcombank - Chi nhánh Thăng Long',
          bank_account: '19036788889999',
          tax_provider: 'VNPT-CA Cloud HSM Level 3',
          hsm_serial: '5404-98AF-2025-E81D'
        }
      });
    }
    res.json({ settings: result.rows[0] });
  }));

  // PUT /api/settings
  router.put('/', requirePermission('settings.manage'), asyncRoute(async (req, res) => {
    requireObject(req.body);
    const companyName = requireText(req.body.company_name, 'company_name', 255);
    const taxCode = requireText(req.body.tax_code, 'tax_code', 32);
    const address = requireText(req.body.address, 'address', 1000);
    const bankName = requireText(req.body.bank_name, 'bank_name', 100);
    const bankAccount = requireText(req.body.bank_account, 'bank_account', 50);
    const taxProvider = requireText(req.body.tax_provider, 'tax_provider', 100, { optional: true });
    const hsmSerial = requireText(req.body.hsm_serial, 'hsm_serial', 100, { optional: true });

    const settings = await inTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO public.company_settings
          (id, company_name, tax_code, address, bank_name, bank_account, tax_provider, hsm_serial, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (id) DO UPDATE
         SET company_name = EXCLUDED.company_name,
             tax_code = EXCLUDED.tax_code,
             address = EXCLUDED.address,
             bank_name = EXCLUDED.bank_name,
             bank_account = EXCLUDED.bank_account,
             tax_provider = EXCLUDED.tax_provider,
             hsm_serial = EXCLUDED.hsm_serial,
             updated_at = now()
         RETURNING id, company_name, tax_code, address, bank_name, bank_account, tax_provider, hsm_serial, updated_at`,
        [companyName, taxCode, address, bankName, bankAccount, taxProvider, hsmSerial]
      );

      const saved = result.rows[0];

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'settings',
        action: 'SETTINGS_UPDATED',
        targetRef: 'COMPANY_SETTINGS',
        severity: 'WARNING',
        summary: `Cập nhật thông tin pháp nhân doanh nghiệp: ${saved.company_name}`,
        metadata: saved,
        throwOnError: true
      });

      return saved;
    });

    res.json({ settings });
  }));

  return router;
}

module.exports = { settingsRouter };
