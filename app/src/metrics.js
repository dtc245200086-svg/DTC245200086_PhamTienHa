const client = require('prom-client');

const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests completed by the application.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry]
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry]
});

const invoicesCreated = new client.Counter({
  name: 'billing_invoices_created_total',
  help: 'Invoices created by the billing application.',
  registers: [metricsRegistry]
});

const paymentsAmountVnd = new client.Counter({
  name: 'billing_payments_amount_vnd_total',
  help: 'Payment amount recorded in VND, sourced from PostgreSQL NUMERIC values.',
  registers: [metricsRegistry]
});

const routeTemplates = [
  ['GET', /^\/health\/?$/, '/health'],
  ['GET', /^\/metrics\/?$/, '/metrics'],
  ['GET', /^\/api\/auth\/me\/?$/, '/api/auth/me'],
  ['POST', /^\/api\/auth\/(?:login|logout)\/?$/, null],
  ['GET', /^\/api\/customers\/?$/, '/api/customers/'],
  ['POST', /^\/api\/customers\/?$/, '/api/customers/'],
  ['GET', /^\/api\/customers\/\d+\/?$/, '/api/customers/:id'],
  ['PUT', /^\/api\/customers\/\d+\/?$/, '/api/customers/:id'],
  ['DELETE', /^\/api\/customers\/\d+\/?$/, '/api/customers/:id'],
  ['GET', /^\/api\/invoices\/?$/, '/api/invoices/'],
  ['POST', /^\/api\/invoices\/?$/, '/api/invoices/'],
  ['GET', /^\/api\/invoices\/\d+\/?$/, '/api/invoices/:id'],
  ['PUT', /^\/api\/invoices\/\d+\/?$/, '/api/invoices/:id'],
  ['POST', /^\/api\/invoices\/\d+\/(?:issue|cancel)\/?$/, null],
  ['POST', /^\/api\/invoices\/\d+\/payments\/?$/, '/api/invoices/:id/payments'],
  ['GET', /^\/api\/payments\/?$/, '/api/payments'],
  ['POST', /^\/api\/payments\/allocate\/?$/, '/api/payments/allocate'],
  ['GET', /^\/api\/dashboard\/summary\/?$/, '/api/dashboard/summary'],
  ['GET', /^\/api\/products\/?$/, '/api/products/'],
  ['POST', /^\/api\/products\/?$/, '/api/products/'],
  ['GET', /^\/api\/products\/\d+\/?$/, '/api/products/:id'],
  ['PUT', /^\/api\/products\/\d+\/?$/, '/api/products/:id'],
  ['DELETE', /^\/api\/products\/\d+\/?$/, '/api/products/:id'],
  ['GET', /^\/api\/payment-terms\/?$/, '/api/payment-terms'],
  ['POST', /^\/api\/payment-terms\/?$/, '/api/payment-terms'],
  ['GET', /^\/api\/payment-terms\/\d+\/?$/, '/api/payment-terms/:id'],
  ['PUT', /^\/api\/payment-terms\/\d+\/?$/, '/api/payment-terms/:id'],
  ['POST', /^\/api\/payment-terms\/\d+\/default\/?$/, '/api/payment-terms/:id/default'],
  ['DELETE', /^\/api\/payment-terms\/\d+\/?$/, '/api/payment-terms/:id'],
  ['GET', /^\/api\/reports\/(?:aging|collection-metrics|revenue|vat)\/?$/, null],
  ['GET', /^\/api\/adjustments\/?$/, '/api/adjustments'],
  ['POST', /^\/api\/adjustments\/?$/, '/api/adjustments'],
  ['GET', /^\/api\/adjustments\/\d+\/?$/, '/api/adjustments/:id'],
  ['POST', /^\/api\/adjustments\/\d+\/(?:approve|process)\/?$/, null],
  ['GET', /^\/api\/recurring-plans\/?$/, '/api/recurring-plans'],
  ['POST', /^\/api\/recurring-plans\/?$/, '/api/recurring-plans'],
  ['GET', /^\/api\/recurring-plans\/\d+\/?$/, '/api/recurring-plans/:id'],
  ['POST', /^\/api\/recurring-plans\/\d+\/(?:trigger|toggle-status)\/?$/, null],
  ['GET', /^\/api\/bank-transactions\/?$/, '/api/bank-transactions'],
  ['POST', /^\/api\/bank-transactions\/?$/, '/api/bank-transactions'],
  ['POST', /^\/api\/reconciliation\/(?:auto-match|manual-match)\/?$/, null],
  ['GET', /^\/api\/rbac\/(?:roles|permissions)\/?$/, null],
  ['GET', /^\/api\/audit-logs\/?$/, '/api/audit-logs'],
  ['POST', /^\/api\/audit-logs\/verify\/?$/, '/api/audit-logs/verify'],
  ['GET', /^\/api\/settings\/?$/, '/api/settings'],
  ['PUT', /^\/api\/settings\/?$/, '/api/settings']
];

function getRouteTemplate(method, originalUrl) {
  const pathname = originalUrl.split('?', 1)[0];
  const match = routeTemplates.find(([routeMethod, pattern]) => routeMethod === method && pattern.test(pathname));
  if (!match) return 'unmatched';
  if (match[2]) return match[2];
  return pathname.replace(/\/\d+/g, '/:id');
}

module.exports = {
  metricsRegistry,
  httpRequests,
  httpRequestDuration,
  invoicesCreated,
  paymentsAmountVnd,
  getRouteTemplate
};