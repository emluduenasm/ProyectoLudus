// /src/routes/adminUsersRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const onlyAdmin = [requireAuth, requireRole("admin")];

/**
 * GET /api/admin/users
 * Query: page, limit, q, role, sort
 *  - q busca en email, username, nombre (users.name), first/last de personas y DNI
 *  - role: admin|designer|buyer
 *  - sort: newest|oldest|name_asc|name_desc
 */
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
    const add = (val) => { params.push(val); return `$${++i}`; };

    if (q) {
      const p1 = add(`%${q}%`);
      const p2 = add(`%${q}%`);
      const p3 = add(`%${q}%`);
      const p4 = add(`%${q}%`);
      const p5 = add(`%${q}%`);
      where.push(`(
        LOWER(u.email) LIKE ${p1}
        OR LOWER(u.username) LIKE ${p2}
        OR LOWER(u.name) LIKE ${p3}
        OR LOWER(p.first_name) LIKE ${p4}
        OR LOWER(p.last_name) LIKE ${p5}
        OR p.dni LIKE '%${q.replace(/[^0-9]/g,"")}%'
      )`);
    }
    if (role) {
      const pr = add(role);
      where.push(`u.role = ${pr}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // total
    const totalQ = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       LEFT JOIN personas p ON p.id = u.persona_id
       ${whereSql}`, params
    );
    const total = totalQ.rows[0]?.total ?? 0;

    const offset = (page - 1) * limit;

    let orderSql = "u.created_at DESC";
    if (sort === "oldest")    orderSql = "u.created_at ASC";
    else if (sort === "name_asc")  orderSql = "COALESCE(NULLIF(u.name,''), p.first_name || ' ' || p.last_name) ASC, u.created_at DESC";
    else if (sort === "name_desc") orderSql = "COALESCE(NULLIF(u.name,''), p.first_name || ' ' || p.last_name) DESC, u.created_at DESC";

    const rowsQ = await pool.query(
      `SELECT
         u.id, u.email, u.username, u.role, u.created_at,
         COALESCE(NULLIF(u.name,''), trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))) AS full_name,
         p.dni AS persona_dni
       FROM users u
       LEFT JOIN personas p ON p.id = u.persona_id
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${i+1} OFFSET $${i+2}`,
      [...params, limit, offset]
    );

    res.json({ page, limit, total, items: rowsQ.rows });
  } catch (e) {
    console.error("ADMIN users list", e);
    res.status(500).json({ error: "No se pudo obtener la lista" });
  }
});

/**
 * PATCH /api/admin/users/:id
 * body: { username?, role? }
 * - valida unicidad de username (case-insensitive)
 * - role ∈ {'admin','designer','buyer'}
 */
router.patch("/:id", ...onlyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let { username, role } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (typeof username === "string") {
      username = username.trim();
      if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username))
        return res.status(400).json({ error: "Alias inválido (3–30: letras, números, . _ -)" });

      const dupe = await pool.query(
        `SELECT 1 FROM users WHERE id<>$1 AND LOWER(username)=LOWER($2) LIMIT 1`,
        [id, username]
      );
      if (dupe.rowCount) return res.status(409).json({ error: "El alias ya está en uso." });

      fields.push(`username = $${idx++}`); values.push(username);
    }

    if (typeof role === "string") {
      role = role.trim();
      if (!["admin", "designer", "buyer"].includes(role))
        return res.status(400).json({ error: "Rol inválido" });
      fields.push(`role = $${idx++}`); values.push(role);
    }

    if (!fields.length) return res.status(400).json({ error: "Sin cambios" });

    values.push(id);
    const upd = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id=$${idx} RETURNING id, email, username, role, created_at`,
      values
    );
    if (!upd.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json(upd.rows[0]);
  } catch (e) {
    console.error("ADMIN users patch", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Reglas:
 *  - Si el usuario tiene diseñador asociado con diseños, evitar borrar (409).
 *  - Si no, borra el user y luego limpia persona si quedó huérfana.
 */
router.delete("/:id", ...onlyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    // ¿Tiene diseñador con diseños?
    const blockQ = await pool.query(
      `SELECT 1
         FROM designers d
         LEFT JOIN designs z ON z.designer_id = d.id
        WHERE d.user_id = $1
        LIMIT 1`,
      [id]
    );
    if (blockQ.rowCount) {
      return res.status(409).json({
        error: "No se puede eliminar: el usuario tiene actividad de diseñador."
      });
    }

    await client.query("BEGIN");

    // Traigo persona_id para limpiar luego
    const uQ = await client.query(`SELECT persona_id FROM users WHERE id=$1`, [id]);
    if (!uQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const personaId = uQ.rows[0].persona_id;

    await client.query(`DELETE FROM users WHERE id=$1`, [id]);

    // Limpio persona si no está vinculada a más usuarios
    if (personaId) {
      await client.query(
        `DELETE FROM personas p
          WHERE p.id = $1
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.persona_id = p.id)`,
        [personaId]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await (async () => { try { await client.query("ROLLBACK"); } catch {} })();
    console.error("ADMIN users delete", e);
    res.status(500).json({ error: "No se pudo eliminar" });
  } finally {
    client.release();
  }
});

export default router;
