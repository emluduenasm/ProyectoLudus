// src/routes/designersRoutes.js
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureDesigner, DEFAULT_AVATAR, getDesignerByUser } from "../lib/designerService.js";

const router = Router();
const uploadsDir = path.join(process.cwd(), "public", "img", "uploads");
const avatarsDir = path.join(uploadsDir, "avatars");
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(avatarsDir, { recursive: true });

const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_AVATAR_TYPES.includes(file.mimetype);
    cb(ok ? null : new Error("Formato no permitido (png, jpg, webp)"), ok);
  },
  limits: { fileSize: 4 * 1024 * 1024 }
});

async function removeFileIfExists(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch {}
}

const normalizeAvatar = (url) => (url && url.trim() ? url : DEFAULT_AVATAR);

async function getDesignerStats(designerId) {
  if (!designerId) return { designs: 0, likes: 0 };
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS designs,
            COALESCE(SUM(likes), 0)::int AS likes
     FROM (
       SELECT d.id, COUNT(l.user_id)::int AS likes
       FROM designs d
       LEFT JOIN design_likes l ON l.design_id = d.id
       WHERE d.designer_id = $1
       GROUP BY d.id
     ) AS per_design`,
    [designerId]
  );
  return {
    designs: rows[0]?.designs ?? 0,
    likes: rows[0]?.likes ?? 0
  };
}

async function buildProfile(userId) {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id,
            u.email,
            u.username,
            u.role,
            u.use_preference,
            u.persona_id,
            p.first_name,
            p.last_name,
            p.dni,
            d.id AS designer_id,
            d.display_name,
            d.avatar_url
     FROM users u
     LEFT JOIN personas p ON p.id = u.persona_id
     LEFT JOIN designers d ON d.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;

  const stats = await getDesignerStats(row.designer_id);

  return {
    user: {
      id: row.user_id,
      email: row.email,
      username: row.username,
      role: row.role,
      use_preference: row.use_preference
    },
    persona: {
      first_name: row.first_name || "",
      last_name: row.last_name || "",
      dni: row.dni || ""
    },
    designer: {
      id: row.designer_id,
      display_name: row.display_name || row.username || row.email,
      avatar_url: normalizeAvatar(row.avatar_url),
      stats
    }
  };
}

router.get("/", async (req, res) => {
  try {
    const categoryRaw =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    let categoryId = "";
    if (categoryRaw) {
      if (/^[0-9a-fA-F-]{32,36}$/.test(categoryRaw)) {
        categoryId = categoryRaw;
      } else {
        const categoryLookup = await pool.query(
          `SELECT id FROM categories
           WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
           LIMIT 1`,
          [categoryRaw]
        );
        categoryId = categoryLookup.rows[0]?.id ?? "";
      }
    }

    const searchRaw =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const orderRaw =
      typeof req.query.order === "string"
        ? req.query.order.trim().toLowerCase()
        : "popular";
    const minDesignsInput =
      req.query.min_designs ?? req.query.minDesigns ?? req.query.min;
    const minLikesInput =
      req.query.min_likes ?? req.query.minLikes ?? req.query.likes;
    const includeEmptyParam =
      req.query.include_empty ?? req.query.includeEmpty ?? "false";

    const parsePositiveInt = (value, fallback) => {
      const num = Number.parseInt(value, 10);
      return Number.isFinite(num) && num >= 0 ? num : fallback;
    };

    const minDesigns = parsePositiveInt(minDesignsInput, 0);
    const minLikes = parsePositiveInt(minLikesInput, 0);
    const limit = Math.max(
      1,
      Math.min(parsePositiveInt(req.query.limit, 12), 60)
    );
    const page = Math.max(1, parsePositiveInt(req.query.page, 1));
    const offset = (page - 1) * limit;
    const includeEmpty = String(includeEmptyParam).toLowerCase() === "true";

    const filters = [];
    const params = [];
    const pushParam = (value) => {
      params.push(value);
      return params.length;
    };

    if (searchRaw) {
      const idx = pushParam(`%${searchRaw.toLowerCase()}%`);
      filters.push(
        `(
          LOWER(COALESCE(NULLIF(TRIM(g.display_name), ''), u.username, u.name, '')) LIKE $${idx}
          OR LOWER(COALESCE(NULLIF(TRIM(u.username), ''), '')) LIKE $${idx}
          OR LOWER(COALESCE(NULLIF(TRIM(u.name), ''), '')) LIKE $${idx}
        )`
      );
    }

    let categoryClause = "";
    if (categoryId) {
      const idx = pushParam(categoryId);
      categoryClause = ` AND d.category_id = $${idx}`;
    }

    if (!includeEmpty || categoryId) {
      filters.push("COALESCE(s.designs_count, 0) > 0");
    }

    if (minDesigns > 0) {
      const idx = pushParam(minDesigns);
      filters.push(`COALESCE(s.designs_count, 0) >= $${idx}`);
    }

    if (minLikes > 0) {
      const idx = pushParam(minLikes);
      filters.push(`COALESCE(s.likes_count, 0) >= $${idx}`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const baseQuery = `
      FROM designers g
      JOIN users u ON u.id = g.user_id
      LEFT JOIN (
        SELECT d.designer_id,
               COUNT(*)::int AS designs_count,
               COUNT(l.user_id)::int AS likes_count,
               MAX(d.created_at) AS last_design_at
        FROM designs d
        LEFT JOIN design_likes l ON l.design_id = d.id
        WHERE (d.published = TRUE OR COALESCE(d.review_status, 'pending') = 'approved')
          ${categoryClause}
        GROUP BY d.designer_id
      ) s ON s.designer_id = g.id
      ${whereClause}
    `;

    const countQuery = `SELECT COUNT(*)::int AS total ${baseQuery}`;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    const limitParamIndex = params.length + 1;
    const offsetParamIndex = params.length + 2;

    let orderClause;
    switch (orderRaw) {
      case "name":
      case "alphabetical":
        orderClause = "ORDER BY display_name ASC";
        break;
      case "newest":
      case "recent":
        orderClause = "ORDER BY g.created_at DESC";
        break;
      case "active":
      case "recent_activity":
        orderClause =
          "ORDER BY s.last_design_at DESC NULLS LAST, g.created_at DESC";
        break;
      case "likes":
      case "popular":
      default:
        orderClause =
          "ORDER BY COALESCE(s.likes_count, 0) DESC, COALESCE(s.designs_count, 0) DESC, display_name ASC";
        break;
    }

    const dataQuery = `
      SELECT
        g.id,
        u.username,
        u.name,
        COALESCE(NULLIF(TRIM(g.display_name), ''), u.username, u.name, 'Anónimo') AS display_name,
        g.avatar_url,
        COALESCE(s.designs_count, 0)::int AS designs_count,
        COALESCE(s.likes_count, 0)::int AS likes_count,
        COALESCE(s.last_design_at, g.created_at) AS last_design_at,
        g.created_at
      ${baseQuery}
      ${orderClause}
      LIMIT $${limitParamIndex}
      OFFSET $${offsetParamIndex}
    `;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(dataQuery, dataParams);

    const designers = rows.map((row) => ({
      id: row.id,
      username: row.username,
      display_name: row.display_name || row.username || row.name || "Anónimo",
      avatar_url: normalizeAvatar(row.avatar_url),
      stats: {
        designs: row.designs_count ?? 0,
        likes: row.likes_count ?? 0
      },
      created_at: row.created_at,
      last_design_at: row.last_design_at
    }));

    res.json({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      designers
    });
  } catch (e) {
    console.error("GET /designers", e);
    res
      .status(500)
      .json({ error: "No se pudieron obtener los perfiles de diseñadores." });
  }
});

const titleCase = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/(^|\s|['-])([\p{L}ÁÉÍÓÚáéíóúÑñÜü])/gu, (m, pre, ch) => pre + ch.toUpperCase());

/**
 * Diseñadores destacados por suma de likes de sus diseños publicados.
 * Devuelve: id, name (display_name/username/name), avatar_url, likes
 */
router.get("/featured", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "6", 10), 24));
    const { rows } = await pool.query(
      `WITH agg AS (
         SELECT d.designer_id,
                COUNT(*)::int              AS designs_count,
                COUNT(l.user_id)::int      AS likes
         FROM designs d
         LEFT JOIN design_likes l ON l.design_id = d.id
         GROUP BY d.designer_id
       )
       SELECT g.id,
              COALESCE(NULLIF(TRIM(g.display_name), ''), u.username, u.name, 'Anónimo') AS display_name,
              u.username,
              COALESCE(NULLIF(TRIM(g.avatar_url), ''), '/img/uploads/avatars/default.png')           AS avatar_url,
              COALESCE(agg.likes, 0)::int                                              AS likes,
              COALESCE(agg.designs_count, 0)::int                                       AS designs_count
       FROM designers g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN agg ON agg.designer_id = g.id
       WHERE COALESCE(agg.likes, 0) > 0
       ORDER BY COALESCE(agg.likes, 0) DESC,
                COALESCE(agg.designs_count, 0) DESC,
                display_name ASC
       LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /designers/featured", e);
    res.status(500).json({ error: "No se pudieron cargar los diseñadores destacados" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureDesigner(userId);
    const profile = await buildProfile(userId);
    if (!profile) return res.status(404).json({ error: "Perfil no encontrado" });
    res.json(profile);
  } catch (e) {
    console.error("GET /designers/me", e);
    res.status(500).json({ error: "No se pudo obtener el perfil" });
  }
});

router.get("/profile/:username", async (req, res) => {
  try {
    const username = (req.params.username || "").trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ error: "Alias requerido" });
    }

    const infoQ = await pool.query(
      `WITH stats AS (
         SELECT d.designer_id,
                COUNT(*)::int AS designs,
                COUNT(l.user_id)::int AS likes
         FROM designs d
         LEFT JOIN design_likes l ON l.design_id = d.id
         GROUP BY d.designer_id
       )
       SELECT g.id   AS designer_id,
              COALESCE(NULLIF(TRIM(g.display_name), ''), u.username, u.name, 'Anónimo') AS display_name,
              u.username,
              COALESCE(s.designs, 0)::int AS designs_count,
              COALESCE(s.likes, 0)::int   AS likes_count,
              COALESCE(NULLIF(TRIM(g.avatar_url), ''), $1) AS avatar_url,
              u.created_at
       FROM users u
       JOIN designers g ON g.user_id = u.id
       LEFT JOIN stats s ON s.designer_id = g.id
       WHERE LOWER(u.username) = $2
       LIMIT 1`,
      [DEFAULT_AVATAR, username]
    );

    const info = infoQ.rows[0];
    if (!info) return res.status(404).json({ error: "Diseñador no encontrado" });

    const designsQ = await pool.query(
      `SELECT d.id,
              d.title,
              d.description,
              d.image_url,
              d.thumbnail_url,
              d.created_at,
              COALESCE(c.name, '') AS category_name,
              COUNT(l.user_id)::int AS likes
       FROM designs d
       LEFT JOIN design_likes l ON l.design_id = d.id
       LEFT JOIN categories c ON c.id = d.category_id
       WHERE d.designer_id = $1
         AND (d.published = TRUE OR COALESCE(d.review_status, 'pending') = 'approved')
       GROUP BY d.id, c.name
       ORDER BY likes DESC, d.created_at DESC`,
      [info.designer_id]
    );

    const designs = designsQ.rows.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description || "",
      image_url: d.image_url,
      thumbnail_url: d.thumbnail_url || d.image_url,
      created_at: d.created_at,
      likes: d.likes,
      category_name: d.category_name || ""
    }));

    res.json({
      designer: {
        id: info.designer_id,
        username: info.username,
        display_name: info.display_name,
        avatar_url: info.avatar_url,
        stats: {
          designs_total: info.designs_count,
          likes_total: info.likes_count,
          designs_published: designs.length,
          likes_published: designs.reduce((acc, d) => acc + (d.likes || 0), 0)
        },
        member_since: info.created_at
      },
      designs
    });
  } catch (e) {
    console.error("GET /designers/profile/:username", e);
    res.status(500).json({ error: "No se pudo cargar el perfil público" });
  }
});

router.patch("/me", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const {
    first_name,
    last_name,
    dni,
    username,
    display_name
  } = req.body ?? {};

  let aliasInput = null;
  if (typeof username === "string") {
    aliasInput = username.trim();
  } else if (typeof display_name === "string") {
    aliasInput = display_name.trim();
  }

  const firstInput =
    typeof first_name === "string" ? first_name.trim() : null;
  const lastInput =
    typeof last_name === "string" ? last_name.trim() : null;
  const dniInput =
    typeof dni !== "undefined" ? String(dni).replace(/\D/g, "") : null;

  if (aliasInput !== null) {
    if (!aliasInput) return res.status(400).json({ error: "El alias no puede estar vacío." });
    if (aliasInput.length < 3) return res.status(400).json({ error: "El alias es muy corto (mínimo 3 caracteres)." });
    if (aliasInput.length > 32) return res.status(400).json({ error: "El alias es muy largo (máximo 32 caracteres)." });
    if (!/^[A-Za-z0-9._-]+$/.test(aliasInput)) {
      return res.status(400).json({ error: "El alias solo puede contener letras, números, punto o guion (medio o bajo)." });
    }
  }
  if (firstInput !== null && !firstInput) return res.status(400).json({ error: "Los nombres no pueden quedar vacíos." });
  if (lastInput !== null && !lastInput) return res.status(400).json({ error: "Los apellidos no pueden quedar vacíos." });
  if (dniInput !== null && !/^\d{8}$/.test(dniInput)) {
    return res.status(400).json({ error: "DNI inválido (8 dígitos)." });
  }

  const wantsPersonaUpdate =
    firstInput !== null || lastInput !== null || dniInput !== null;

  if (wantsPersonaUpdate) {
    if (!firstInput || !lastInput || !dniInput) {
      return res.status(400).json({ error: "Completá nombre, apellido y DNI para guardar tus datos." });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const designer = await ensureDesigner(userId, client);

    const userRowQ = await client.query(
      `SELECT id, persona_id, username, name
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );
    if (!userRowQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const userRow = userRowQ.rows[0];

    let personaRow = null;
    if (userRow.persona_id) {
      const personaQ = await client.query(
        `SELECT id, first_name, last_name, dni
         FROM personas
         WHERE id = $1
         FOR UPDATE`,
        [userRow.persona_id]
      );
      personaRow = personaQ.rows[0] || null;
    }

    let personaId = userRow.persona_id;
    let finalFirst = personaRow?.first_name || "";
    let finalLast = personaRow?.last_name || "";
    let finalDni = personaRow?.dni || "";

    if (personaId) {
      if (wantsPersonaUpdate) {
        finalFirst = titleCase(firstInput ?? personaRow?.first_name ?? "");
        finalLast = titleCase(lastInput ?? personaRow?.last_name ?? "");
        finalDni = dniInput ?? personaRow?.dni ?? "";

        if (finalDni !== (personaRow?.dni || "")) {
          const dup = await client.query(
            `SELECT 1 FROM personas WHERE dni=$1 AND id<>$2 LIMIT 1`,
            [finalDni, personaId]
          );
          if (dup.rowCount) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "El DNI ya está registrado." });
          }
        }

        await client.query(
          `UPDATE personas
             SET first_name = $1,
                 last_name  = $2,
                 dni        = $3
           WHERE id = $4`,
          [finalFirst, finalLast, finalDni, personaId]
        );
      }
    } else if (wantsPersonaUpdate) {
      finalFirst = titleCase(firstInput || "");
      finalLast = titleCase(lastInput || "");
      finalDni = dniInput || "";

      const dup = await client.query(
        `SELECT 1 FROM personas WHERE dni=$1 LIMIT 1`,
        [finalDni]
      );
      if (dup.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El DNI ya está registrado." });
      }
      const persona = await client.query(
        `INSERT INTO personas (first_name, last_name, dni)
         VALUES ($1,$2,$3)
         RETURNING id`,
        [finalFirst, finalLast, finalDni]
      );
      personaId = persona.rows[0].id;
      await client.query(
        `UPDATE users
           SET persona_id=$1,
               name=$2
         WHERE id=$3`,
        [personaId, `${finalFirst} ${finalLast}`.trim(), userId]
      );
    } else if (personaId) {
      // No cambios solicitados, pero aseguramos valores actuales para sincronizar nombre
      finalFirst = personaRow?.first_name || finalFirst;
      finalLast = personaRow?.last_name || finalLast;
      finalDni = personaRow?.dni || finalDni;
    }

    if (personaId) {
      const fullName = `${finalFirst} ${finalLast}`.trim();
      await client.query(
        `UPDATE users SET name=$1 WHERE id=$2`,
        [fullName || userRow.name || "", userId]
      );
    }

    if (wantsPersonaUpdate && !personaId) {
      // Safeguard: shouldn't happen, but rollback if personaId is missing
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "No se pudo asociar la información personal." });
    }

    if (aliasInput !== null && aliasInput.toLowerCase() !== (userRow.username || "").toLowerCase()) {
      const dupAlias = await client.query(
        `SELECT 1 FROM users WHERE LOWER(username)=LOWER($1) AND id<>$2 LIMIT 1`,
        [aliasInput, userId]
      );
      if (dupAlias.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El alias ya está en uso." });
      }
      await client.query(
        `UPDATE users SET username=$1 WHERE id=$2`,
        [aliasInput, userId]
      );
      await client.query(
        `UPDATE designers SET display_name=$1 WHERE id=$2`,
        [aliasInput, designer.id]
      );
    }

    await client.query("COMMIT");
    const profile = await buildProfile(userId);
    res.json(profile);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PATCH /designers/me", e);
    res.status(500).json({ error: "No se pudieron actualizar tus datos" });
  } finally {
    client.release();
  }
});

router.put(
  "/me/avatar",
  requireAuth,
  (req, res, next) => {
    avatarUpload.single("avatar")(req, res, (err) => {
      if (err) {
        return res
          .status(400)
          .json({ error: err?.message || "Archivo inválido" });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Imagen requerida" });
      const userId = req.user.id;
      const designer = await ensureDesigner(userId);
      const current = await getDesignerByUser(userId);
      const prevUrl = current?.avatar_url || "";

      const outputName = `${designer.id}-${Date.now()}.jpg`;
      const outputPath = path.join(avatarsDir, outputName);
      const buffer = await sharp(req.file.buffer)
        .resize({ width: 512, height: 512, fit: "cover" })
        .jpeg({ quality: 90 })
        .toBuffer();
      await fs.promises.writeFile(outputPath, buffer);
      const url = `/img/uploads/avatars/${outputName}`;

      await pool.query(
        `UPDATE designers SET avatar_url=$1 WHERE id=$2`,
        [url, designer.id]
      );

      if (
        prevUrl &&
        prevUrl !== url &&
        prevUrl.startsWith("/img/uploads/avatars/")
      ) {
        await removeFileIfExists(path.join(process.cwd(), "public", prevUrl));
      }

      res.json({ avatar_url: url });
    } catch (e) {
      console.error("PUT /designers/me/avatar", e);
      res.status(500).json({ error: "No se pudo actualizar el avatar" });
    }
  }
);

export default router;
