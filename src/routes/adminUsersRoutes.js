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
      u.banned,
      u.created_at,
      p.dni AS persona_dni,
      p.first_name AS first_name,         -- ⬅️ NUEVO
      p.last_name  AS last_name,          -- ⬅️ NUEVO
      (COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS full_name,
      (
        SELECT COUNT(*)
        FROM designers d
        JOIN designs z ON z.designer_id = d.id
        WHERE d.user_id = u.id AND z.published = TRUE
      ) AS designs_published,
      (
        SELECT COUNT(*)
        FROM designers d
        JOIN designs z ON z.designer_id = d.id
        WHERE d.user_id = u.id AND (z.published = FALSE OR z.published IS NULL)
      ) AS designs_unpublished
    FROM users u
    LEFT JOIN personas p ON p.id = u.persona_id
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

// ===== BANEAR =====
router.patch("/:id/ban", ...onlyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const reason = (req.body?.reason || "").trim() || "Cuenta baneada por infringir las reglas.";

    await client.query("BEGIN");

    // 1) Marcar usuario como baneado
    const upd = await client.query(
      `UPDATE users
         SET banned = TRUE,
             banned_reason = $1,
             banned_at = NOW()
       WHERE id = $2
       RETURNING id, email, username, role, banned, banned_reason, banned_at`,
      [reason, id]
    );
    if (!upd.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // 2) Apagar diseños y respaldar cuáles estaban publicados
    await client.query(
      `UPDATE designs z
         SET published_backup = CASE WHEN z.published = TRUE THEN TRUE ELSE published_backup END,
             published = FALSE
       WHERE z.designer_id IN (SELECT d.id FROM designers d WHERE d.user_id = $1)`,
      [id]
    );

    await client.query("COMMIT");
    res.json(upd.rows[0]);
  } catch (e) {
    await (async () => { try { await client.query("ROLLBACK"); } catch {} })();
    console.error("ADMIN users ban", e);
    res.status(500).json({ error: "No se pudo banear" });
  } finally {
    client.release();
  }
});


// ===== DESBANEAR =====
router.patch("/:id/unban", ...onlyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query("BEGIN");

    // 1) Desbanear usuario
    const upd = await client.query(
      `UPDATE users
         SET banned = FALSE,
             banned_reason = NULL,
             banned_at = NULL
       WHERE id = $1
       RETURNING id, email, username, role, banned`,
      [id]
    );
    if (!upd.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // 2) Restaurar estado de publicación solo de los que estaban publicados antes del ban
    await client.query(
      `UPDATE designs z
         SET published = COALESCE(z.published_backup, FALSE),
             published_backup = NULL
       WHERE z.designer_id IN (SELECT d.id FROM designers d WHERE d.user_id = $1)`,
      [id]
    );

    await client.query("COMMIT");
    res.json(upd.rows[0]);
  } catch (e) {
    await (async () => { try { await client.query("ROLLBACK"); } catch {} })();
    console.error("ADMIN users unban", e);
    res.status(500).json({ error: "No se pudo desbanear" });
  } finally {
    client.release();
  }
});


/* ===== EDITAR ===== */
// PATCH /api/admin/users/:id
// ===== EDITAR (incluye ban/desban con update de designs) =====
router.patch("/:id", ...onlyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { username, role, banned, banned_reason, first_name, last_name, dni, email } = req.body;

    // Sin campos => 400
    if (
      typeof username === "undefined" &&
      typeof role === "undefined" &&
      typeof banned === "undefined" &&
      typeof banned_reason === "undefined" &&
      typeof first_name === "undefined" &&
      typeof last_name === "undefined" &&
      typeof dni === "undefined" &&
      typeof email === "undefined"
    ) {
      return res.status(400).json({ error: "Sin cambios" });
    }

    await client.query("BEGIN");

    // 1) Actualización sobre USERS
    const uFields = [];
    const uVals = [];
    let i = 1;

    if (typeof username === "string") { uFields.push(`username = $${i++}`); uVals.push(username.trim()); }
    if (typeof role === "string")     { uFields.push(`role = $${i++}`);     uVals.push(role); }
    if (typeof email === "string")    { uFields.push(`email = $${i++}`);    uVals.push(email.trim().toLowerCase()); }

    // Manejo de banned/banned_reason en users
    let toggledBanToTrue  = false;
    let toggledBanToFalse = false;

    if (typeof banned !== "undefined") {
      uFields.push(`banned = $${i++}`); uVals.push(!!banned);
      if (banned) {
        toggledBanToTrue = true;
        uFields.push(`banned_reason = $${i++}`); uVals.push(typeof banned_reason === "string" ? banned_reason.trim() || null : null);
        uFields.push(`banned_at = NOW()`);
      } else {
        toggledBanToFalse = true;
        uFields.push(`banned_reason = NULL`);
        uFields.push(`banned_at = NULL`);
      }
    }

    if (uFields.length) {
      uVals.push(id);
      const updUser = await client.query(
        `UPDATE users SET ${uFields.join(", ")} WHERE id=$${i} RETURNING id, persona_id, email, username, role, banned`,
        uVals
      );
      if (!updUser.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Usuario no encontrado" }); }
    }

    // 2) Actualización sobre PERSONAS (si vienen campos)
    if (typeof first_name !== "undefined" || typeof last_name !== "undefined" || typeof dni !== "undefined") {
      // garantizamos persona_id
      const getPid = await client.query(`SELECT persona_id FROM users WHERE id=$1`, [id]);
      const personaId = getPid.rows[0]?.persona_id || null;
      if (!personaId) { await client.query("ROLLBACK"); return res.status(400).json({ error: "El usuario no tiene persona asociada" }); }

      const pFields = [];
      const pVals = [];
      let j = 1;

      if (typeof first_name === "string") { pFields.push(`first_name = $${j++}`); pVals.push(first_name.trim()); }
      if (typeof last_name === "string")  { pFields.push(`last_name  = $${j++}`); pVals.push(last_name.trim()); }
      if (typeof dni !== "undefined")     { pFields.push(`dni        = $${j++}`); pVals.push((dni ?? "").toString().replace(/\D/g, "")); }

      if (pFields.length) {
        pVals.push(personaId);
        await client.query(`UPDATE personas SET ${pFields.join(", ")} WHERE id = $${j}`, pVals);
      }
    }

    // 3) Side-effects sobre DESIGNS si se cambió banned
    if (toggledBanToTrue) {
      // Apagar diseños y marcar backup
      await client.query(
        `UPDATE designs z
           SET published_backup = CASE WHEN z.published = TRUE THEN TRUE ELSE published_backup END,
               published = FALSE
         WHERE z.designer_id IN (SELECT d.id FROM designers d WHERE d.user_id = $1)`,
        [id]
      );
    } else if (toggledBanToFalse) {
      // Restaurar diseños publicados antes del ban y limpiar backup
      await client.query(
        `UPDATE designs z
           SET published = COALESCE(z.published_backup, FALSE),
               published_backup = NULL
         WHERE z.designer_id IN (SELECT d.id FROM designers d WHERE d.user_id = $1)`,
        [id]
      );
    }

    await client.query("COMMIT");

    // Devolvemos el user (refrescado simple)
    const out = await pool.query(
      `SELECT id, email, username, role, banned FROM users WHERE id=$1`,
      [id]
    );
    res.json(out.rows[0]);
  } catch (e) {
    await (async () => { try { await client.query("ROLLBACK"); } catch {} })();
    console.error("ADMIN users patch", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  } finally {
    client.release();
  }
});


/* ===== DELETE deshabilitado ===== */
router.delete("/:id", ...onlyAdmin, async (_req, res) => {
  res.status(405).json({ error: "Eliminar deshabilitado. Use /:id/ban." });
});

export default router;
