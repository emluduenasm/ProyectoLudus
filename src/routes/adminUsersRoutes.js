// src/routes/adminUsersRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const onlyAdmin = [requireAuth, requireRole("admin")];
const cleanText = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const cleanDigits = (value, max = 40) => String(value ?? "").replace(/\D/g, "").slice(0, max);
const ARG_PROVINCES = new Set([
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autonoma de Buenos Aires",
  "Cordoba",
  "Corrientes",
  "Entre Rios",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquen",
  "Rio Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucuman"
]);
const normalizePostalCodeAR = (value) => cleanText(value, 12).toUpperCase().replace(/\s+/g, "");
const validPostalCodeAR = (value) => /^\d{4}$/.test(value) || /^[A-Z]\d{4}[A-Z]{3}$/.test(value);

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
      u.use_preference,
      u.banned,
      u.banned_reason,
      u.created_at,
      p.dni AS persona_dni,
      p.first_name AS first_name,         -- ⬅️ NUEVO
      p.last_name  AS last_name,          -- ⬅️ NUEVO
      a.phone,
      a.country,
      a.province,
      a.city,
      a.street,
      a.street_number,
      a.floor_apartment,
      a.postal_code,
      a.notes AS address_notes,
      dpay.payout_alias,
      dpay.payout_cbu,
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
    LEFT JOIN LATERAL (
      SELECT phone, country, province, city, street, street_number, floor_apartment, postal_code, notes
      FROM user_addresses ua
      WHERE ua.user_id = u.id
      ORDER BY ua.is_default DESC, ua.created_at DESC
      LIMIT 1
    ) a ON TRUE
    LEFT JOIN designers dpay ON dpay.user_id = u.id
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
    const {
      username,
      role,
      use_preference,
      banned,
      banned_reason,
      first_name,
      last_name,
      dni,
      email,
      phone,
      country,
      province,
      city,
      street,
      street_number,
      floor_apartment,
      postal_code,
      notes,
      payout_alias,
      payout_cbu
    } = req.body;

    // Sin campos => 400
    if (
      typeof username === "undefined" &&
      typeof role === "undefined" &&
      typeof banned === "undefined" &&
      typeof banned_reason === "undefined" &&
      typeof first_name === "undefined" &&
      typeof last_name === "undefined" &&
      typeof dni === "undefined" &&
      typeof email === "undefined" &&
      typeof use_preference === "undefined" &&
      typeof phone === "undefined" &&
      typeof country === "undefined" &&
      typeof province === "undefined" &&
      typeof city === "undefined" &&
      typeof street === "undefined" &&
      typeof street_number === "undefined" &&
      typeof floor_apartment === "undefined" &&
      typeof postal_code === "undefined" &&
      typeof notes === "undefined" &&
      typeof payout_alias === "undefined" &&
      typeof payout_cbu === "undefined"
    ) {
      return res.status(400).json({ error: "Sin cambios" });
    }

    await client.query("BEGIN");

    // 1) Actualización sobre USERS
    const uFields = [];
    const uVals = [];
    let i = 1;

    if (typeof username === "string") { uFields.push(`username = $${i++}`); uVals.push(cleanText(username, 30)); }
    if (typeof role === "string") {
      if (!["buyer", "designer", "admin"].includes(role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Rol invalido" });
      }
      uFields.push(`role = $${i++}`);
      uVals.push(role);
    }
    if (typeof use_preference === "string") {
      if (!["buy", "upload"].includes(use_preference)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Preferencia invalida" });
      }
      uFields.push(`use_preference = $${i++}`);
      uVals.push(use_preference);
    }
    if (typeof email === "string")    { uFields.push(`email = $${i++}`);    uVals.push(cleanText(email, 120).toLowerCase()); }

    // Manejo de banned/banned_reason en users
    let toggledBanToTrue  = false;
    let toggledBanToFalse = false;

    if (typeof banned !== "undefined") {
      const currentBanQ = await client.query(`SELECT banned FROM users WHERE id=$1`, [id]);
      const currentBanned = currentBanQ.rows[0]?.banned === true;
      const nextBanned = !!banned;
      uFields.push(`banned = $${i++}`); uVals.push(!!banned);
      if (banned) {
        toggledBanToTrue = !currentBanned && nextBanned;
        uFields.push(`banned_reason = $${i++}`); uVals.push(typeof banned_reason === "string" ? banned_reason.trim() || null : null);
        uFields.push(toggledBanToTrue ? `banned_at = NOW()` : `banned_at = banned_at`);
      } else {
        toggledBanToFalse = currentBanned && !nextBanned;
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
      const userQ = await client.query(
        `SELECT persona_id, name FROM users WHERE id=$1 FOR UPDATE`,
        [id]
      );
      const userRow = userQ.rows[0];
      if (!userRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      let personaId = userRow.persona_id || null;
      let current = { first_name: "", last_name: "", dni: "" };
      if (personaId) {
        const currentQ = await client.query(
          `SELECT first_name, last_name, dni FROM personas WHERE id=$1 FOR UPDATE`,
          [personaId]
        );
        current = currentQ.rows[0] || current;
      }

      const nextFirst = typeof first_name === "string" ? cleanText(first_name, 80) : current.first_name;
      const nextLast = typeof last_name === "string" ? cleanText(last_name, 80) : current.last_name;
      const nextDni = typeof dni !== "undefined" ? cleanDigits(dni, 20) : current.dni;

      if (!nextFirst || !nextLast || !nextDni) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Nombre, apellido y DNI son requeridos" });
      }
      if (!/^\d{7,20}$/.test(nextDni)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "DNI invalido" });
      }

      const dupDni = await client.query(
        `SELECT 1 FROM personas WHERE dni=$1 AND ($2::uuid IS NULL OR id<>$2) LIMIT 1`,
        [nextDni, personaId]
      );
      if (dupDni.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El DNI ya esta registrado" });
      }

      if (personaId) {
        await client.query(
          `UPDATE personas SET first_name=$1, last_name=$2, dni=$3 WHERE id=$4`,
          [nextFirst, nextLast, nextDni, personaId]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO personas (first_name, last_name, dni)
           VALUES ($1,$2,$3)
           RETURNING id`,
          [nextFirst, nextLast, nextDni]
        );
        personaId = inserted.rows[0].id;
        await client.query(`UPDATE users SET persona_id=$1 WHERE id=$2`, [personaId, id]);
      }

      await client.query(
        `UPDATE users SET name=$1 WHERE id=$2`,
        [`${nextFirst} ${nextLast}`.trim(), id]
      );
    }

    // 3) Side-effects sobre DESIGNS si se cambió banned
    const addressTouched =
      typeof phone !== "undefined" ||
      typeof country !== "undefined" ||
      typeof province !== "undefined" ||
      typeof city !== "undefined" ||
      typeof street !== "undefined" ||
      typeof street_number !== "undefined" ||
      typeof floor_apartment !== "undefined" ||
      typeof postal_code !== "undefined" ||
      typeof notes !== "undefined";

    if (addressTouched) {
      const currentAddressQ = await client.query(
        `SELECT id, phone, country, province, city, street, street_number, floor_apartment, postal_code, notes
         FROM user_addresses
         WHERE user_id=$1
         ORDER BY is_default DESC, created_at DESC
         LIMIT 1`,
        [id]
      );
      const currentAddress = currentAddressQ.rows[0] || {};
      const nextAddress = {
        phone: typeof phone === "string" ? cleanDigits(phone, 10) : currentAddress.phone,
        country: typeof country === "string" ? cleanText(country, 80) : currentAddress.country,
        province: typeof province === "string" ? cleanText(province, 80) : currentAddress.province,
        city: typeof city === "string" ? cleanText(city, 80) : currentAddress.city,
        street: typeof street === "string" ? cleanText(street, 120) : currentAddress.street,
        street_number: typeof street_number === "string" ? cleanText(street_number, 20) : currentAddress.street_number,
        floor_apartment: typeof floor_apartment === "string" ? cleanText(floor_apartment, 80) : currentAddress.floor_apartment,
        postal_code: typeof postal_code === "string" ? normalizePostalCodeAR(postal_code) : currentAddress.postal_code,
        notes: typeof notes === "string" ? cleanText(notes, 240) : currentAddress.notes
      };

      if (!nextAddress.phone || !nextAddress.country || !nextAddress.province || !nextAddress.city || !nextAddress.street || !nextAddress.street_number || !nextAddress.postal_code) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "La direccion debe incluir telefono, pais, provincia, ciudad, calle, altura y codigo postal" });
      }
      if (nextAddress.phone.length !== 10) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Telefono argentino invalido: debe tener 10 digitos" });
      }
      if (nextAddress.country !== "Argentina") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Por ahora solo se admiten direcciones de Argentina" });
      }
      if (!ARG_PROVINCES.has(nextAddress.province)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Provincia invalida" });
      }
      if (!validPostalCodeAR(nextAddress.postal_code)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Codigo postal invalido" });
      }

      if (currentAddress.id) {
        await client.query(
          `UPDATE user_addresses
             SET phone=$1,
                 country=$2,
                 province=$3,
                 city=$4,
                 street=$5,
                 street_number=$6,
                 floor_apartment=$7,
                 postal_code=$8,
                 notes=$9,
                 is_default=TRUE,
                 updated_at=now()
           WHERE id=$10`,
          [
            nextAddress.phone,
            nextAddress.country,
            nextAddress.province,
            nextAddress.city,
            nextAddress.street,
            nextAddress.street_number,
            nextAddress.floor_apartment || null,
            nextAddress.postal_code,
            nextAddress.notes || null,
            currentAddress.id
          ]
        );
      } else {
        await client.query(
          `INSERT INTO user_addresses (
             user_id, phone, country, province, city, street, street_number,
             floor_apartment, postal_code, notes, is_default
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)`,
          [
            id,
            nextAddress.phone,
            nextAddress.country,
            nextAddress.province,
            nextAddress.city,
            nextAddress.street,
            nextAddress.street_number,
            nextAddress.floor_apartment || null,
            nextAddress.postal_code,
            nextAddress.notes || null
          ]
        );
      }
    }

    if (typeof payout_alias !== "undefined" || typeof payout_cbu !== "undefined") {
      const currentPayoutQ = await client.query(
        `SELECT d.id, d.payout_alias, d.payout_cbu, u.username, u.name, u.email, u.avatar_url
         FROM users u
         LEFT JOIN designers d ON d.user_id = u.id
         WHERE u.id=$1`,
        [id]
      );
      const payoutRow = currentPayoutQ.rows[0];
      if (!payoutRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const nextAlias = typeof payout_alias === "string" ? cleanText(payout_alias, 30) : payoutRow.payout_alias;
      const nextCbu = typeof payout_cbu !== "undefined" ? cleanDigits(payout_cbu, 22) : payoutRow.payout_cbu;
      if (role === "designer" && !nextAlias && !nextCbu) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "El diseñador debe tener alias o CBU/CVU para cobrar comisiones" });
      }
      if (nextAlias && !/^[A-Za-z0-9._-]{6,30}$/.test(nextAlias)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Alias de cobro invalido" });
      }
      if (nextCbu && !/^\d{22}$/.test(nextCbu)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "CBU/CVU invalido" });
      }

      const displayName = payoutRow.username || payoutRow.name || payoutRow.email || "Diseñador";
      await client.query(
        `INSERT INTO designers (user_id, display_name, avatar_url, payout_alias, payout_cbu)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id)
         DO UPDATE SET payout_alias=EXCLUDED.payout_alias,
                       payout_cbu=EXCLUDED.payout_cbu,
                       display_name=COALESCE(NULLIF(designers.display_name, ''), EXCLUDED.display_name),
                       avatar_url=COALESCE(designers.avatar_url, EXCLUDED.avatar_url)`,
        [id, displayName, payoutRow.avatar_url, nextAlias || null, nextCbu || null]
      );
    }

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
