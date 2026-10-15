const express = require('express');
const { authRouter } = require('./auth');
const { customerRouter } = require('./customers');
const { invoiceRouter } = require('./invoices');
const { paymentsRouter } = require('./payments');
const { dashboardRouter } = require('./dashboard');
const { productRouter } = require('./products');
const { paymentTermsRouter } = require('./payment-terms');
const { reportsRouter } = require('./reports');
const { adjustmentsRouter } = require('./adjustments');
const { refundsRouter } = require('./refunds');
const { recurringRouter } = require('./recurring');
const { reconciliationRouter } = require('./reconciliation');
const { rbacRouter, rolesRouter, permissionsRouter } = require('./rbac');
const { auditRouter } = require('./audit');
const { settingsRouter } = require('./settings');
const { usersRouter } = require('./users');

function apiRouter(pool, cookieSecure) {
  const router = express.Router();
  router.use('/auth', authRouter(pool, cookieSecure));
  router.use('/customers', customerRouter(pool));
  router.use('/invoices', invoiceRouter(pool));
  router.use(paymentsRouter(pool));
  router.use(dashboardRouter(pool));
  router.use('/refunds', refundsRouter(pool));
  router.use('/refund-payables', refundsRouter(pool));

  // Enterprise Modules from LedgerFlow (with full frontend & API contract compatibility)
  router.use('/products', productRouter(pool));
  router.use('/payment-terms', paymentTermsRouter(pool));
  router.use('/reports', reportsRouter(pool));

  // Dual mounting for Adjustments / Credit Notes
  router.use('/adjustments', adjustmentsRouter(pool));
  router.use('/credit-notes', adjustmentsRouter(pool));

  // Dual mounting for Recurring
  router.use('/recurring', recurringRouter(pool));
  router.use('/recurring-plans', recurringRouter(pool));

  // Reconciliation & Bank Transactions
  router.use('/reconciliation', reconciliationRouter(pool));
  router.use(reconciliationRouter(pool));

  // RBAC, Roles, and Permissions
  router.use('/rbac', rbacRouter(pool));
  router.use('/roles', rolesRouter(pool));
  router.use('/permissions', permissionsRouter(pool));

  // User Management (Admin only)
  router.use('/users', usersRouter(pool));

  // Dual mounting for Audit
  router.use('/audit', auditRouter(pool));
  router.use('/audit-logs', auditRouter(pool));

  router.use('/settings', settingsRouter(pool));

  return router;
}

module.exports = { apiRouter };