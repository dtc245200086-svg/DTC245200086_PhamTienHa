const express = require('express');
const bcrypt = require('bcryptjs');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
  }
  req.user = req.session.user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    if (req.user.role !== role) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    next();
  };
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function authRouter(pool, cookieSecure) {
  const router = express.Router();

  router.post('/login', asyncRoute(async (req, res) => {
    const body = req.body;
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username || !body.password) {
      throw new AppError(400, 'VALIDATION_ERROR', 'username and password are required.');
    }

    const result = await pool.query(
      'SELECT id, username, password_hash, role, is_active FROM public.users WHERE username = $1 LIMIT 1',
      [body.username.trim()]
    );
    const account = result.rows[0];
    const valid = account?.is_active && await bcrypt.compare(body.password, account.password_hash);
    if (!valid) {
      writeLog('warn', 'auth.login_failed', { request_id: req.requestId });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    await regenerateSession(req);
    req.session.user = { id: account.id, username: account.username, role: account.role };
    await saveSession(req);
    writeLog('info', 'auth.login_success', { request_id: req.requestId, user: account.username });
    res.status(200).json({ user: req.session.user });
  }));

  router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
    const username = req.user.username;
    await new Promise((resolve, reject) => {
      req.session.destroy((error) => error ? reject(error) : resolve());
    });
    res.clearCookie('billing.sid', {
      httpOnly: true,
      sameSite: 'strict',
      secure: cookieSecure,
      path: '/'
    });
    writeLog('info', 'auth.logout', { request_id: req.requestId, user: username });
    res.status(204).end();
  }));

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.user);
  });

  return router;
}

module.exports = { authRouter, requireAuth, requireRole };