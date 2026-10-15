const express = require('express');
const bcrypt = require('bcryptjs');
const { AppError, asyncRoute } = require('../errors');
const { parseId, parsePage, requireText } = require('../validation');
const { requireAuth, requireRole } = require('./auth');
const { recordAudit } = require('../audit');
const { sendCsvResponse } = require('../csv');

function usersRouter(pool) {
  const router = express.Router();

  // Strict Admin-only guard on entire user management router
  router.use(requireAuth);
  router.use(requireRole('admin'));

  // GET /api/users - List all users
  router.get('/', asyncRoute(async (req, res) => {
    const { page, limit, page_size, offset } = parsePage(req.query);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;
    const roleFilter = typeof req.query.role === 'string' && req.query.role.trim() ? req.query.role.trim().toLowerCase() : null;
    const statusFilter = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim().toUpperCase() : null;

    let isActiveFilter = null;
    if (statusFilter === 'ACTIVE') isActiveFilter = true;
    if (statusFilter === 'INACTIVE' || statusFilter === 'LOCKED') isActiveFilter = false;

    const [itemsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_active,
                CASE WHEN u.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
                NULL::timestamptz AS last_login,
                now() AS created_at
         FROM public.users u
         WHERE ($1::text IS NULL OR u.username ILIKE $1 OR u.full_name ILIKE $1 OR u.email ILIKE $1)
           AND ($2::text IS NULL OR LOWER(u.role) = $2 OR (LOWER(u.role) = 'role_billing_manager' AND $2 = 'director'))
           AND ($3::boolean IS NULL OR u.is_active = $3)
         ORDER BY u.id ASC
         LIMIT $4 OFFSET $5`,
        [pattern, roleFilter, isActiveFilter, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.users u
         WHERE ($1::text IS NULL OR u.username ILIKE $1 OR u.full_name ILIKE $1 OR u.email ILIKE $1)
           AND ($2::text IS NULL OR LOWER(u.role) = $2 OR (LOWER(u.role) = 'role_billing_manager' AND $2 = 'director'))
           AND ($3::boolean IS NULL OR u.is_active = $3)`,
        [pattern, roleFilter, isActiveFilter]
      )
    ]);

    const total = Number(countRes.rows[0]?.total || 0);
    const users = itemsRes.rows.map(row => ({
      ...row,
      display_role: normalizeDisplayRole(row.role)
    }));

    res.json({
      items: users,
      users,
      total,
      page,
      limit,
      page_size: limit
    });
  }));

  // GET /api/users/export.csv (Server-side unpaginated Users CSV export - STRICT SECURITY: NEVER leak password_hash/tokens)
  router.get('/export.csv', asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;
    const roleFilter = typeof req.query.role === 'string' && req.query.role.trim() ? req.query.role.trim().toLowerCase() : null;
    const statusFilter = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim().toUpperCase() : null;

    let isActiveFilter = null;
    if (statusFilter === 'ACTIVE') isActiveFilter = true;
    if (statusFilter === 'INACTIVE' || statusFilter === 'LOCKED') isActiveFilter = false;

    // Strict column selection: NEVER query password_hash or sensitive secrets
    const itemsRes = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_active,
              CASE WHEN u.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
              u.created_at
       FROM public.users u
       WHERE ($1::text IS NULL OR u.username ILIKE $1 OR u.full_name ILIKE $1 OR u.email ILIKE $1)
         AND ($2::text IS NULL OR LOWER(u.role) = $2 OR (LOWER(u.role) = 'role_billing_manager' AND $2 = 'director'))
         AND ($3::boolean IS NULL OR u.is_active = $3)
       ORDER BY u.id ASC`,
      [pattern, roleFilter, isActiveFilter]
    );

    const headers = ['ID', 'Tên đăng nhập', 'Họ và tên', 'Email', 'Vai trò', 'Trạng thái', 'Ngày tạo'];
    const rows = itemsRes.rows.map(u => [
      u.id,
      u.username || '',
      u.full_name || '',
      u.email || '',
      normalizeDisplayRole(u.role),
      u.status,
      u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `danh_sach_nguoi_dung_${dateStr}.csv`,
      headers,
      rows
    });
  }));

  // GET /api/users/:id - Get user by ID
  router.get('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, 'user_id');
    const result = await pool.query(
      `SELECT id, username, full_name, email, role, is_active,
              CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
       FROM public.users
       WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!result.rowCount) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    const user = {
      ...result.rows[0],
      display_role: normalizeDisplayRole(result.rows[0].role)
    };

    res.json({ user });
  }));

  // POST /api/users - Create new user (ADMIN, DIRECTOR, STAFF)
  router.post('/', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const username = requireText(body.username, 'username', 32).toLowerCase();
    const password = requireText(body.password, 'password', 128);

    if (!/^[a-z0-9_]{3,32}$/.test(username)) {
      throw new AppError(400, 'INVALID_USERNAME', 'Username must be 3-32 characters of lowercase alphanumeric or underscores.');
    }

    if (password.length < 6) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Password must be at least 6 characters.');
    }

    const rawRole = String(body.role || 'staff').trim().toLowerCase();
    let canonicalDbRole = 'staff';
    if (rawRole === 'admin') canonicalDbRole = 'admin';
    else if (rawRole === 'director' || rawRole === 'role_billing_manager') canonicalDbRole = 'ROLE_BILLING_MANAGER';
    else if (rawRole === 'staff') canonicalDbRole = 'staff';
    else {
      throw new AppError(400, 'INVALID_ROLE', 'Role must be one of: ADMIN, DIRECTOR, STAFF.');
    }

    const fullName = typeof body.full_name === 'string' ? body.full_name.trim().slice(0, 128) : null;
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 128) : null;
    const isActive = body.is_active !== undefined ? Boolean(body.is_active) : (body.status !== 'INACTIVE');

    // Check duplicate username
    const dupCheck = await pool.query('SELECT id FROM public.users WHERE username = $1 LIMIT 1', [username]);
    if (dupCheck.rowCount) {
      throw new AppError(409, 'USERNAME_ALREADY_EXISTS', `Username '${username}' is already in use.`);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const insertRes = await pool.query(
      `INSERT INTO public.users (username, password_hash, role, is_active, full_name, email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, full_name, email, role, is_active,
                 CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status`,
      [username, passwordHash, canonicalDbRole, isActive, fullName, email]
    );

    const newUser = {
      ...insertRes.rows[0],
      display_role: normalizeDisplayRole(insertRes.rows[0].role)
    };

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'users',
      action: 'USER_CREATED',
      targetRef: username,
      severity: 'INFO',
      summary: `Tạo tài khoản mới: ${username} (Role: ${newUser.display_role})`,
      metadata: { user_id: newUser.id, username, role: canonicalDbRole, is_active: isActive },
      throwOnError: false
    });

    res.status(201).json({ user: newUser });
  }));

  // PUT /api/users/:id - Update user details
  router.put('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, 'user_id');
    const body = req.body || {};

    const existingRes = await pool.query('SELECT id, username, role, is_active FROM public.users WHERE id = $1 LIMIT 1', [id]);
    if (!existingRes.rowCount) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const existing = existingRes.rows[0];

    // Protect primary root admin
    if (existing.username === 'admin') {
      if (body.is_active === false || body.status === 'INACTIVE') {
        throw new AppError(400, 'CANNOT_DEACTIVATE_ROOT_ADMIN', 'Cannot deactivate the root admin account.');
      }
      if (body.role && String(body.role).toLowerCase() !== 'admin') {
        throw new AppError(400, 'CANNOT_DEMOTE_ROOT_ADMIN', 'Cannot change the role of the root admin account.');
      }
    }

    let role = existing.role;
    if (body.role !== undefined) {
      const r = String(body.role).trim().toLowerCase();
      if (r === 'admin') role = 'admin';
      else if (r === 'director' || r === 'role_billing_manager') role = 'ROLE_BILLING_MANAGER';
      else if (r === 'staff') role = 'staff';
      else throw new AppError(400, 'INVALID_ROLE', 'Role must be one of: ADMIN, DIRECTOR, STAFF.');
    }

    let isActive = existing.is_active;
    if (body.is_active !== undefined) {
      isActive = Boolean(body.is_active);
    } else if (body.status !== undefined) {
      isActive = (body.status === 'ACTIVE');
    }

    const fullName = body.full_name !== undefined
      ? (body.full_name ? String(body.full_name).trim().slice(0, 128) : null)
      : null;
    const email = body.email !== undefined
      ? (body.email ? String(body.email).trim().slice(0, 128) : null)
      : null;

    const updateRes = await pool.query(
      `UPDATE public.users
       SET role = $1,
           is_active = $2,
           full_name = COALESCE($3, full_name),
           email = COALESCE($4, email)
       WHERE id = $5
       RETURNING id, username, full_name, email, role, is_active,
                 CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status`,
      [role, isActive, fullName, email, id]
    );

    const updatedUser = {
      ...updateRes.rows[0],
      display_role: normalizeDisplayRole(updateRes.rows[0].role)
    };

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'users',
      action: 'USER_UPDATED',
      targetRef: existing.username,
      severity: 'INFO',
      summary: `Cập nhật thông tin tài khoản: ${existing.username}`,
      metadata: { user_id: id, username: existing.username, changes: { role, is_active: isActive } },
      throwOnError: false
    });

    res.json({ user: updatedUser });
  }));

  // POST /api/users/:id/reset-password - Reset password
  router.post('/:id/reset-password', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, 'user_id');
    const body = req.body || {};
    const newPassword = requireText(body.password || body.new_password, 'password', 128);

    if (newPassword.length < 6) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Password must be at least 6 characters.');
    }

    const existingRes = await pool.query('SELECT id, username FROM public.users WHERE id = $1 LIMIT 1', [id]);
    if (!existingRes.rowCount) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const targetUser = existingRes.rows[0];

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE public.users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'users',
      action: 'USER_PASSWORD_RESET',
      targetRef: targetUser.username,
      severity: 'WARNING',
      summary: `Đặt lại mật khẩu cho tài khoản: ${targetUser.username}`,
      metadata: { user_id: id, username: targetUser.username },
      throwOnError: false
    });

    res.json({ success: true, message: `Mật khẩu của tài khoản ${targetUser.username} đã được đặt lại thành công.` });
  }));

  // POST /api/users/:id/toggle-status - Lock or Unlock account
  router.post('/:id/toggle-status', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, 'user_id');
    const body = req.body || {};

    const existingRes = await pool.query('SELECT id, username, is_active FROM public.users WHERE id = $1 LIMIT 1', [id]);
    if (!existingRes.rowCount) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const existing = existingRes.rows[0];

    if (existing.username === 'admin' || existing.id === req.user.id) {
      throw new AppError(400, 'CANNOT_LOCK_SELF', 'Cannot lock your own account or root admin.');
    }

    let nextStatus = !existing.is_active;
    if (body.is_active !== undefined) nextStatus = Boolean(body.is_active);
    else if (body.status !== undefined) nextStatus = (body.status === 'ACTIVE');

    const updateRes = await pool.query(
      `UPDATE public.users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, username, full_name, email, role, is_active,
                 CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status`,
      [nextStatus, id]
    );

    const updatedUser = {
      ...updateRes.rows[0],
      display_role: normalizeDisplayRole(updateRes.rows[0].role)
    };

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'users',
      action: nextStatus ? 'USER_UNLOCKED' : 'USER_LOCKED',
      targetRef: existing.username,
      severity: 'WARNING',
      summary: `${nextStatus ? 'Mở khóa' : 'Khóa'} tài khoản: ${existing.username}`,
      metadata: { user_id: id, username: existing.username, is_active: nextStatus },
      throwOnError: false
    });

    res.json({ user: updatedUser });
  }));

  // DELETE /api/users/:id - Deactivate user
  router.delete('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, 'user_id');
    const existingRes = await pool.query('SELECT id, username FROM public.users WHERE id = $1 LIMIT 1', [id]);
    if (!existingRes.rowCount) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const existing = existingRes.rows[0];

    if (existing.username === 'admin' || existing.id === req.user.id) {
      throw new AppError(400, 'CANNOT_DELETE_SELF', 'Cannot delete or disable your own account or root admin.');
    }

    try {
      await pool.query('DELETE FROM public.users WHERE id = $1', [id]);
    } catch {
      await pool.query('UPDATE public.users SET is_active = false WHERE id = $1', [id]);
    }

    await recordAudit(pool, {
      user: req.user,
      ip: req.ip,
      module: 'users',
      action: 'USER_DEACTIVATED',
      targetRef: existing.username,
      severity: 'WARNING',
      summary: `Vô hiệu hóa tài khoản: ${existing.username}`,
      metadata: { user_id: id, username: existing.username },
      throwOnError: false
    });

    res.json({ success: true, message: `Tài khoản ${existing.username} đã được vô hiệu hóa.` });
  }));

  return router;
}

function normalizeDisplayRole(role) {
  const r = String(role || '').toUpperCase();
  if (r === 'ADMIN') return 'ADMIN';
  if (r === 'DIRECTOR' || r === 'ROLE_BILLING_MANAGER') return 'DIRECTOR';
  if (r === 'ROLE_ACCOUNTANT') return 'ACCOUNTANT';
  if (r === 'ROLE_AUDITOR') return 'AUDITOR';
  return 'STAFF';
}

module.exports = { usersRouter, normalizeDisplayRole };
