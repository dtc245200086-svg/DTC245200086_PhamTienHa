const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { AppError } = require('./errors');
const { writeLog } = require('./logger');
const { apiRouter } = require('./routes');

function createApp(pool, { sessionSecret, cookieSecure }) {
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
  }

  const app = express();
  const PgSessionStore = connectPgSimple(session);
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const fields = {
        request_id: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100
      };
      if (req.user?.username) fields.user = req.user.username;
      writeLog(res.statusCode >= 500 ? 'error' : 'info', 'http_request', fields);
    });
    next();
  });

  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(session({
    name: 'billing.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new PgSessionStore({
      pool,
      schemaName: 'public',
      tableName: 'user_sessions',
      createTableIfMissing: false,
      pruneSessionInterval: 15 * 60
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: cookieSecure,
      path: '/',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'error', db: 'unavailable' });
    }
  });

  app.use('/api', apiRouter(pool, cookieSecure));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Resource was not found.')));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500;
    let code = error.code || 'INTERNAL_ERROR';
    let message = error.message;

    if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body must be valid JSON.';
    } else if (!error.status) {
      if (error.code === '23505') {
        status = 409;
        code = 'CONFLICT';
        message = 'The request conflicts with existing data.';
      } else if (error.code === '23503') {
        status = 409;
        code = 'REFERENCE_CONFLICT';
        message = 'The request conflicts with related data.';
      } else if (error.code === '23514' || error.code === '22P02') {
        status = 400;
        code = 'VALIDATION_ERROR';
        message = 'One or more values are invalid.';
      } else {
        status = 500;
        code = 'INTERNAL_ERROR';
        message = 'An internal error occurred.';
      }
    }

    if (status >= 500) writeLog('error', 'error', { request_id: req.requestId, code });
    res.status(status).json({ error: { code, message, request_id: req.requestId } });
  });

  return app;
}

module.exports = { createApp };