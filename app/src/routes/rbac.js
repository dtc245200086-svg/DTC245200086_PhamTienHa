const express = require('express');
const { AppError, asyncRoute } = require('../errors');
const { parseId } = require('../validation');
const { inTransaction } = require('../db');
const { requireAuth, requireRole } = require('./auth');
const { recordAudit } = require('../audit');

async function queryRoles(pool) {
  const rolesRes = await pool.query(
    `SELECT r.id, r.code, r.title, r.description, r.is_system,
            count(u.id)::text AS user_count,
            (SELECT count(*)::text FROM public.permissions) AS total_permissions
     FROM public.roles r
     LEFT JOIN public.users u ON (
       u.role = r.code 
       OR (r.code = 'ROLE_BILLING_MANAGER' AND LOWER(u.role) = 'director')
       OR (r.code = 'admin' AND LOWER(u.role) = 'admin')
       OR (r.code = 'staff' AND LOWER(u.role) = 'staff')
     )
     GROUP BY r.id
     ORDER BY r.id ASC`
  );
  return rolesRes.rows;
}

async function queryPermissions(pool) {
  const permsRes = await pool.query('SELECT id, code, module, description FROM public.permissions ORDER BY module, id');
  return permsRes.rows;
}

async function getRolePermissionsData(pool, roleId) {
  const roleRes = await pool.query('SELECT id, code, title, description, is_system FROM public.roles WHERE id = $1', [roleId]);
  if (!roleRes.rowCount) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found.');
  }
  const role = roleRes.rows[0];

  const permsRes = await pool.query(
    `SELECT p.id, p.code, p.module, p.description
     FROM public.role_permissions rp
     JOIN public.permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.module, p.id`,
    [roleId]
  );

  return {
    role,
    permissions: permsRes.rows.map(p => p.code),
    permission_ids: permsRes.rows.map(p => p.id),
    items: permsRes.rows
  };
}

async function updateRolePermissionsData(pool, roleId, body, req) {
  const roleRes = await pool.query('SELECT id, code, title, is_system FROM public.roles WHERE id = $1', [roleId]);
  if (!roleRes.rowCount) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found.');
  }
  const role = roleRes.rows[0];

  let targetPermissionIds = [];
  if (Array.isArray(body.permission_ids)) {
    targetPermissionIds = body.permission_ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0);
  } else if (Array.isArray(body.permissions) || Array.isArray(body.permission_codes)) {
    const codes = (body.permissions || body.permission_codes).map(c => String(c).trim());
    if (codes.length > 0) {
      const idRes = await pool.query('SELECT id FROM public.permissions WHERE code = ANY($1)', [codes]);
      targetPermissionIds = idRes.rows.map(r => r.id);
    }
  }

  if (role.code === 'admin' && targetPermissionIds.length === 0) {
    throw new AppError(400, 'CANNOT_CLEAR_ADMIN_PERMISSIONS', 'Cannot remove all permissions from admin role.');
  }

  const updated = await inTransaction(async (client) => {
    await client.query('DELETE FROM public.role_permissions WHERE role_id = $1', [roleId]);

    if (targetPermissionIds.length > 0) {
      for (const permId of targetPermissionIds) {
        await client.query(
          'INSERT INTO public.role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [roleId, permId]
        );
      }
    }

    const assignedRes = await client.query(
      `SELECT p.id, p.code, p.module, p.description
       FROM public.role_permissions rp
       JOIN public.permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.module, p.id`,
      [roleId]
    );

    await recordAudit(client, {
      user: req.user,
      ip: req.ip,
      module: 'rbac',
      action: 'ROLE_PERMISSIONS_UPDATED',
      targetRef: role.code,
      severity: 'WARNING',
      summary: `Cập nhật quyền cho vai trò ${role.title || role.code} (${assignedRes.rows.length} quyền)`,
      metadata: {
        role_id: roleId,
        role_code: role.code,
        assigned_count: assignedRes.rows.length,
        permissions: assignedRes.rows.map(p => p.code)
      },
      throwOnError: true
    });

    return assignedRes.rows;
  });

  return {
    role,
    permissions: updated.map(p => p.code),
    permission_ids: updated.map(p => p.id),
    items: updated
  };
}

function rbacRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/roles', asyncRoute(async (req, res) => {
    const items = await queryRoles(pool);
    res.json({ items });
  }));

  router.get('/permissions', asyncRoute(async (req, res) => {
    const items = await queryPermissions(pool);
    res.json({ items });
  }));

  router.get('/roles/:id/permissions', requireRole('admin'), asyncRoute(async (req, res) => {
    const roleId = parseId(req.params.id, 'role_id');
    const result = await getRolePermissionsData(pool, roleId);
    res.json(result);
  }));

  router.put('/roles/:id/permissions', requireRole('admin'), asyncRoute(async (req, res) => {
    const roleId = parseId(req.params.id, 'role_id');
    const result = await updateRolePermissionsData(pool, roleId, req.body || {}, req);
    res.json(result);
  }));

  return router;
}

function rolesRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    const items = await queryRoles(pool);
    res.json({ items, roles: items });
  }));

  router.get('/:id/permissions', requireRole('admin'), asyncRoute(async (req, res) => {
    const roleId = parseId(req.params.id, 'role_id');
    const result = await getRolePermissionsData(pool, roleId);
    res.json(result);
  }));

  router.put('/:id/permissions', requireRole('admin'), asyncRoute(async (req, res) => {
    const roleId = parseId(req.params.id, 'role_id');
    const result = await updateRolePermissionsData(pool, roleId, req.body || {}, req);
    res.json(result);
  }));

  // Disallow non-admin modification of roles
  router.post('/', requireRole('admin'), asyncRoute(async () => {
    throw new AppError(400, 'ROLE_CREATION_RESTRICTED', 'Role modification is restricted to canonical roles.');
  }));

  return router;
}

function permissionsRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    const items = await queryPermissions(pool);
    res.json({ items, permissions: items });
  }));

  return router;
}

module.exports = { rbacRouter, rolesRouter, permissionsRouter };
