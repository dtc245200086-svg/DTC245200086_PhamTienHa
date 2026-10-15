const express = require('express');
const bcrypt = require('bcryptjs');
const { AppError, asyncRoute } = require('../errors');
const { writeLog } = require('../logger');

const DEFAULT_STAFF_PERMISSIONS = [
  'invoice.create', 'invoice.read', 'invoice.update', 'invoice.issue',
  'customer.create', 'customer.read', 'customer.update',
  'payment.create', 'payment.read',
  'adjustment.create',
  'product.manage',
  'report.view'
];

const CANONICAL_PERMISSION_ALIASES = {
  'company_settings.update': 'settings.manage',
  'settings.read': 'settings.manage',
  'audit.read': 'audit.view',
  'reports.read': 'report.view',
  'reports.export': 'report.view',
  'approval.read': 'adjustment.approve',
  'approval.manage': 'adjustment.approve',
  'invoices.read': 'invoice.read',
  'invoices.create': 'invoice.create',
  'invoices.update': 'invoice.update',
  'invoices.delete': 'invoice.cancel',
  'customers.read': 'customer.read',
  'customers.create': 'customer.create',
  'customers.update': 'customer.update',
  'payments.read': 'payment.read',
  'payments.create': 'payment.create',
  'payments.update': 'payment.create'
};

let authPool = null;

function setAuthPool(pool) {
  authPool = pool;
}

function getAuthPool() {
  return authPool;
}

function isRoleMatch(userRole, targetRole) {
  const normUser = String(userRole || '').trim().toLowerCase();
  const normTarget = String(targetRole || '').trim().toLowerCase();
  if (normUser === normTarget) return true;
  if ((normUser === 'role_billing_manager' || normUser === 'director') &&
      (normTarget === 'role_billing_manager' || normTarget === 'director')) {
    return true;
  }
  return false;
}

async function resolveUserAndPermissions(pool, userId) {
  if (!pool || !userId) return null;

  const userRes = await pool.query(
    `SELECT u.id, u.username, u.role, u.full_name, u.email, u.is_active, r.id AS role_id
     FROM public.users u
     LEFT JOIN public.roles r ON (
       r.code = u.role
       OR (LOWER(u.role) = 'director' AND r.code = 'ROLE_BILLING_MANAGER')
       OR (LOWER(u.role) = 'admin' AND r.code = 'admin')
       OR (LOWER(u.role) = 'staff' AND r.code = 'staff')
     )
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );

  if (!userRes.rowCount) return null;
  const user = userRes.rows[0];
  if (!user.is_active) {
    return { ...user, isInactive: true };
  }

  let permissions = [];
  const normalizedRole = String(user.role || '').toLowerCase();
  if (normalizedRole === 'admin') {
    permissions = ['*'];
  } else if (user.role_id) {
    const permsRes = await pool.query(
      `SELECT p.code
       FROM public.role_permissions rp
       JOIN public.permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.id ASC`,
      [user.role_id]
    );
    permissions = permsRes.rows.map(r => r.code);
  } else {
    // Unknown or unmapped role: zero permissions (fail closed)
    permissions = [];
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name || null,
    email: user.email || null,
    permissions
  };
}

async function requireAuth(req, res, next) {
  try {
    if (!req.session?.user?.id) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    }

    const pool = req.app?.locals?.pool || getAuthPool();
    if (!pool) {
      return next(new AppError(500, 'DATABASE_UNAVAILABLE', 'Database connection unavailable.'));
    }

    const userProfile = await resolveUserAndPermissions(pool, req.session.user.id);

    if (!userProfile) {
      req.session?.destroy?.(() => {});
      return next(new AppError(401, 'UNAUTHENTICATED', 'User account not found.'));
    }

    if (userProfile.isInactive) {
      req.session?.destroy?.(() => {});
      return next(new AppError(401, 'UNAUTHENTICATED', 'User account is inactive.'));
    }

    req.user = userProfile;
    // Keep session user synchronized with live PostgreSQL state
    req.session.user = {
      id: userProfile.id,
      username: userProfile.username,
      role: userProfile.role,
      full_name: userProfile.full_name,
      email: userProfile.email,
      permissions: userProfile.permissions
    };

    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();
  return async (req, res, next) => {
    try {
      if (!req.user) {
        if (!req.session?.user?.id) {
          return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
        }
        const pool = req.app?.locals?.pool || getAuthPool();
        const userProfile = await resolveUserAndPermissions(pool, req.session.user.id);
        if (!userProfile || userProfile.isInactive) {
          req.session?.destroy?.(() => {});
          return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
        }
        req.user = userProfile;
      }

      const userRole = req.user.role;
      const hasMatch = roles.some(target => isRoleMatch(userRole, target));
      if (!hasMatch) {
        return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        if (!req.session?.user?.id) {
          return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
        }
        const pool = req.app?.locals?.pool || getAuthPool();
        const userProfile = await resolveUserAndPermissions(pool, req.session.user.id);
        if (!userProfile || userProfile.isInactive) {
          req.session?.destroy?.(() => {});
          return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
        }
        req.user = userProfile;
      }

      const pool = req.app?.locals?.pool || getAuthPool();
      if (!pool) {
        return next(new AppError(500, 'DATABASE_UNAVAILABLE', 'Database connection unavailable.'));
      }

      // Canonical name resolution (mapping legacy / aliases to canonical DB code)
      const targetCode = CANONICAL_PERMISSION_ALIASES[permissionCode] || permissionCode;

      // Check if targetCode exists in public.permissions catalog
      const permCheck = await pool.query(
        'SELECT 1 FROM public.permissions WHERE code = $1 LIMIT 1',
        [targetCode]
      );

      // Unknown or non-existent permission -> fail closed: deny by default!
      if (!permCheck.rowCount) {
        return next(new AppError(403, 'FORBIDDEN', `Unknown or invalid permission code (${permissionCode}).`));
      }

      // Admin wildcard check for valid canonical permissions
      const normalizedRole = String(req.user.role || '').toLowerCase();
      if (normalizedRole === 'admin' || (Array.isArray(req.user.permissions) && req.user.permissions.includes('*'))) {
        return next();
      }

      // Granular permission check
      const userPerms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      if (userPerms.includes(targetCode)) {
        return next();
      }

      return next(new AppError(403, 'FORBIDDEN', `You do not have permission to perform this action (${permissionCode}).`));
    } catch (err) {
      next(err);
    }
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
  setAuthPool(pool);
  const router = express.Router();

  router.post('/login', asyncRoute(async (req, res) => {
    const body = req.body;
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username || !body.password) {
      throw new AppError(400, 'VALIDATION_ERROR', 'username and password are required.');
    }

    const result = await pool.query(
      'SELECT id, username, password_hash, role, full_name, email, is_active FROM public.users WHERE username = $1 LIMIT 1',
      [body.username.trim()]
    );
    const account = result.rows[0];
    const valid = account?.is_active && await bcrypt.compare(body.password, account.password_hash);
    if (!valid) {
      writeLog('warn', 'auth.login_failed', { request_id: req.requestId });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    // Resolve permissions authoritatively from database
    let permissions = [];
    const normalizedRole = String(account.role || '').toLowerCase();
    if (normalizedRole === 'admin') {
      permissions = ['*'];
    } else {
      const permsRes = await pool.query(
        `SELECT p.code FROM public.role_permissions rp
         JOIN public.permissions p ON p.id = rp.permission_id
         JOIN public.roles r ON (
           r.id = rp.role_id AND (
             r.code = $1
             OR (LOWER($1) = 'director' AND r.code = 'ROLE_BILLING_MANAGER')
             OR (LOWER($1) = 'admin' AND r.code = 'admin')
             OR (LOWER($1) = 'staff' AND r.code = 'staff')
           )
         )
         ORDER BY p.id ASC`,
        [account.role]
      );
      permissions = permsRes.rows.map(r => r.code);
    }

    await regenerateSession(req);
    req.session.user = {
      id: account.id,
      username: account.username,
      role: account.role,
      full_name: account.full_name || null,
      email: account.email || null,
      permissions
    };
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

module.exports = {
  authRouter,
  requireAuth,
  requireRole,
  requirePermission,
  DEFAULT_STAFF_PERMISSIONS,
  CANONICAL_PERMISSION_ALIASES,
  resolveUserAndPermissions,
  setAuthPool,
  getAuthPool,
  isRoleMatch
};