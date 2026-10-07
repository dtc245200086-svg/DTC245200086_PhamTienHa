const express = require('express');
const { asyncRoute } = require('../errors');
const { requireAuth } = require('./auth');

function rbacRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/rbac/roles
  router.get('/roles', asyncRoute(async (req, res) => {
    const rolesRes = await pool.query(
      `SELECT r.id, r.code, r.title, r.description, r.is_system,
              count(u.id)::text AS user_count,
              (SELECT count(*)::text FROM public.permissions) AS total_permissions
       FROM public.roles r
       LEFT JOIN public.users u ON u.role = r.code
       GROUP BY r.id
       ORDER BY r.id ASC`
    );
    res.json({ items: rolesRes.rows });
  }));

  // GET /api/rbac/permissions
  router.get('/permissions', asyncRoute(async (req, res) => {
    const permsRes = await pool.query('SELECT id, code, module, description FROM public.permissions ORDER BY module, id');
    res.json({ items: permsRes.rows });
  }));

  return router;
}

module.exports = { rbacRouter };
