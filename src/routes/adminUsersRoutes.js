// src/routes/adminUsersRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const onlyAdmin = [requireAuth, requireRole("admin")];

/* ===== LISTAR ===== */
router.get("/", ...onlyAdmin, async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const q     = (req.query.q || "").trim().toLowerCase();
    const role  = (req.query.role || "").trim();
    const sort  = (req.query.sort || "newest").trim();

    const where = [];
    const params = [];
    let i = 0;
    const add = (v) => { params.push(v); return `$${++i}`; };

    if (q) {
      const t = `%${q}%`;
      const p1 = add(t), p2 = add(t), p3 = add(t), p4 = add(t);
      where.push(`(LOWER(u.email) LIKE ${p1} OR LOWER(u.username) LIKE ${p2} OR LOWER(u.name) LIKE ${p3} OR p.dni LIKE ${p4})`);
    }
    if (role) where.push(`u.role = ${add(role)}`);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Orden: usar full_name (alias) para los casos por nombre
    let orderSql = "u.created_at DESC";
    if (sort === "oldest")     orderSql = "u.created_at ASC";
    if (sort === "name_asc")   orderSql = "full_name ASC, u.created_at DESC";
    if (sort === "name_desc")  orderSql = "full_name DESC, u.created_at DESC";

    const countQ = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       LEFT JOIN personas p ON p.id = u.persona_id
       ${whereSql}`, params);
    const total = countQ.rows[0]?.total ?? 0;

    const offset = (page - 1) * limit;

    const rowsQ = await pool.query(
  `SELECT
     u.id,
     u.email,
     u.username,
     u.role,
     u.created_at,
     u.banned,
     u.banned_reason,
     u.banned_at,
     p.dni AS persona_dni,
     (COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS full_name,
     COALESCE(dp.designs_published, 0) AS designs_published
   FROM users u
   LEFT JOIN personas p ON p.id = u.persona_id
   /* pre-aggregate: diseños publicados por usuario */
   LEFT JOIN (
     SELECT d2.user_id, COUNT(*) AS designs_published
     FROM designers d2
     JOIN designs z ON z.designer_id = d2.id
     WHERE z.published IS TRUE
     GROUP BY d2.user_id
   ) dp ON dp.user_id = u.id
   ${whereSql}
   ORDER BY ${orderSql}
   LIMIT $${i + 1} OFFSET $${i + 2}`,
  [...params, limit, offset]
);



    res.json({ page, limit, total, items: rowsQ.rows });
  } catch (e) {
    console.error("ADMIN users list", e);
    res.status(500).json({ error: "No se pudo obtener la lista" });
  }
});

/* ===== EDITAR ===== */
router.patch("/:id", ...onlyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, role, banned, banned_reason } = req.body;

    const fields = [];
    const values = [];
    let i = 1;

    if (typeof username === "string") {
      fields.push(`username = $${i++}`);
      values.push(username.trim());
    }
    if (typeof role === "string") {
      fields.push(`role = $${i++}`);
      values.push(role);
    }

    if (typeof banned !== "undefined") {
      fields.push(`banned = $${i++}`);
      values.push(!!banned);

      if (banned) {
        fields.push(`banned_reason = $${i++}`);
        values.push(typeof banned_reason === "string" ? (banned_reason.trim() || null) : null);
        fields.push(`banned_at = now()`);
      } else {
        fields.push(`banned_reason = NULL`);
        fields.push(`banned_at = NULL`);
      }
    }

    if (!fields.length) return res.status(400).json({ error: "Sin cambios" });

    values.push(id);
    const upd = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id=$${i}
       RETURNING id, email, username, role, banned, banned_reason, banned_at`,
      values
    );
    if (!upd.rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(upd.rows[0]);
  } catch (e) {
    console.error("ADMIN users patch", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

/* ===== BANEAR ===== */
router.patch("/:id/ban", ...onlyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = (req.body?.reason || "").trim() || "Cuenta baneada por infringir las reglas.";
    const upd = await pool.query(
      `UPDATE users
         SET banned = TRUE,
             banned_reason = $1,
             banned_at = NOW()
       WHERE id = $2
       RETURNING id, email, username, role, banned, banned_reason, banned_at`,
      [reason, id]
    );
    if (!upd.rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(upd.rows[0]);
  } catch (e) {
    console.error("ADMIN users ban", e);
    res.status(500).json({ error: "No se pudo banear" });
  }
});

/* ===== DESBANEAR ===== */
router.patch("/:id/unban", ...onlyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const upd = await pool.query(
      `UPDATE users
         SET banned = FALSE,
             banned_reason = NULL,
             banned_at = NULL
       WHERE id = $1
       RETURNING id, email, username, role, banned`,
      [id]
    );
    if (!upd.rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(upd.rows[0]);
  } catch (e) {
    console.error("ADMIN users unban", e);
    res.status(500).json({ error: "No se pudo desbanear" });
  }
});

/* ===== DELETE deshabilitado ===== */
router.delete("/:id", ...onlyAdmin, async (_req, res) => {
  res.status(405).json({ error: "Eliminar deshabilitado. Use /:id/ban." });
});

export default router;
