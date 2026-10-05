const express = require('express');
const { authRouter } = require('./auth');
const { customerRouter } = require('./customers');
const { invoiceRouter } = require('./invoices');
const { paymentsRouter } = require('./payments');
const { dashboardRouter } = require('./dashboard');

function apiRouter(pool, cookieSecure) {
  const router = express.Router();
  router.use('/auth', authRouter(pool, cookieSecure));
  router.use('/customers', customerRouter(pool));
  router.use('/invoices', invoiceRouter(pool));
  router.use(paymentsRouter(pool));
  router.use(dashboardRouter(pool));
  return router;
}

module.exports = { apiRouter };