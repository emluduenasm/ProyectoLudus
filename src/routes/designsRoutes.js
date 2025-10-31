// src/routes/designsRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureDesigner } from "../lib/designerService.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const router = Router();

/* ---------- Paths y helpers ---------- */
const uploadsDir = path.join(process.cwd(), "public", "img", "uploads");
const thumbsDir  = path.join(uploadsDir, "thumbs");
const mockupsDir = path.join(uploadsDir, "mockups");
const productosDir = path.join(process.cwd(), "public", "img", "productos");
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(thumbsDir,  { recursive: true });
fs.mkdirSync(mockupsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext)
      .toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 40);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${base}${ext}`);
  }
});
const fileFilter = (_req, file, cb) => {
  const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Formato no permitido (png, jpg, webp)"), ok);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 8 * 1024 * 1024 } }); // 8MB
const previewUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
});

async function resolveCategoryId(category_id, { strict = false } = {}) {
  // Si viene un UUID válido y existe/activa, úsalo; si no, usar “otros”
  if (category_id) {
    const r = await pool.query(`SELECT id FROM categories WHERE id=$1 AND active=TRUE`, [category_id]);
    if (r.rowCount) return r.rows[0].id;
  }
  if (strict) return null;
  const otros = await pool.query(`SELECT id FROM categories WHERE slug='otros'`);
  return otros.rows[0]?.id;
}

async function removeFileIfExists(filePathAbs) {
  try {
    await fs.promises.unlink(filePathAbs);
  } catch {}
}

const remeraTemplatePath = path.join(productosDir, "producto-remera.jpg");

async function removeRemeraMockup(designId) {
  const filename = `${designId}-remera.jpg`;
  await removeFileIfExists(path.join(mockupsDir, filename));
}

async function getRemeraMockupUrl(designId) {
  const filename = `${designId}-remera.jpg`;
  try {
    await fs.promises.access(path.join(mockupsDir, filename));
    return `/img/uploads/mockups/${filename}`;
  } catch {
    return null;
  }
}

async function buildRemeraMockupBuffer(source) {
  try {
    await fs.promises.access(remeraTemplatePath);
    const templateMeta = await sharp(remeraTemplatePath).metadata();
    const tplWidth = templateMeta.width || 1000;
    const tplHeight = templateMeta.height || 1000;
    const scaleRatio = 0.32;
    const targetWidth = Math.round(tplWidth * scaleRatio);
    const overlayBuffer = await sharp(source)
      .resize({
        width: targetWidth,
        fit: "inside",
      })
      .png()
      .toBuffer();

    const overlayMeta = await sharp(overlayBuffer).metadata();
    const ovWidth = overlayMeta.width || 0;
    const ovHeight = overlayMeta.height || 0;
    const centeredLeft = Math.max(0, Math.round((tplWidth - ovWidth) / 2));
    const centeredTop = Math.max(0, Math.round((tplHeight - ovHeight) / 2));
    const upwardOffset = Math.round(tplHeight * 0.1);
    const top = Math.max(0, centeredTop - upwardOffset);

    return await sharp(remeraTemplatePath)
      .composite([{ input: overlayBuffer, left: centeredLeft, top, blend: "multiply" }])
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (err) {
    throw err;
  }
}

async function generateRemeraMockup(designId, designPath) {
  try {
    const buffer = await buildRemeraMockupBuffer(designPath);
    const outputFilename = `${designId}-remera.jpg`;
    const outputPath = path.join(mockupsDir, outputFilename);

    await fs.promises.writeFile(outputPath, buffer);

    return `/img/uploads/mockups/${outputFilename}`;
  } catch (err) {
    console.error("Mockup remera error", err?.message || err);
    return null;
  }
}

/* ---------- Endpoints públicos ---------- */

router.get("/", async (req, res) => {
  try {
    const searchRaw =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const orderRaw =
      typeof req.query.order === "string"
        ? req.query.order.trim().toLowerCase()
        : "popular";
    const categoryRaw =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    const designerRaw =
      typeof req.query.designer === "string" ? req.query.designer.trim() : "";
    const minLikesRaw =
      req.query.min_likes ?? req.query.minLikes ?? req.query.likes;

    const parsePositiveInt = (value, fallback) => {
      const num = Number.parseInt(value, 10);
      return Number.isFinite(num) && num >= 0 ? num : fallback;
    };

    const limit = Math.max(
      1,
      Math.min(parsePositiveInt(req.query.limit, 12), 60)
    );
    const page = Math.max(1, parsePositiveInt(req.query.page, 1));
    const offset = (page - 1) * limit;
    const minLikes = parsePositiveInt(minLikesRaw, 0);

    let categoryId = "";
    if (categoryRaw) {
      if (/^[0-9a-fA-F-]{32,36}$/.test(categoryRaw)) {
        categoryId = categoryRaw;
      } else {
        const lookup = await pool.query(
          `SELECT id
             FROM categories
            WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
            LIMIT 1`,
          [categoryRaw]
        );
        categoryId = lookup.rows[0]?.id ?? "";
      }
    }

    const filters = [
      "(d.published = TRUE OR COALESCE(d.review_status, 'pending') = 'approved')"
    ];
    const params = [];
    const pushParam = (value) => {
      params.push(value);
      return params.length;
    };

    if (searchRaw) {
      const idx = pushParam(`%${searchRaw.toLowerCase()}%`);
      filters.push(
        `(
          LOWER(d.title) LIKE $${idx}
          OR LOWER(COALESCE(d.description, '')) LIKE $${idx}
          OR LOWER(COALESCE(NULLIF(TRIM(g.display_name), ''), u.username, u.name, '')) LIKE $${idx}
        )`
      );
    }

    if (categoryId) {
      const idx = pushParam(categoryId);
      filters.push(`d.category_id = $${idx}`);
    }

    if (designerRaw) {
      const idx = pushParam(designerRaw.toLowerCase());
      filters.push(
        `(LOWER(u.username) = $${idx} OR LOWER(g.display_name) = $${idx} OR LOWER(u.name) = $${idx})`
      );
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    let havingClause = "";
    if (minLikes > 0) {
      const idx = pushParam(minLikes);
      havingClause = `HAVING COUNT(l.user_id)::int >= $${idx}`;
    }

    let orderClause;
    switch (orderRaw) {
      case "newest":
      case "recent":
        orderClause = "ORDER BY d.created_at DESC";
        break;
      case "oldest":
        orderClause = "ORDER BY d.created_at ASC";
        break;
      case "alpha":
      case "alphabetical":
      case "title":
        orderClause = "ORDER BY d.title ASC";
        break;
      case "likes":
      case "popular":
      default:
        orderClause =
          "ORDER BY likes DESC, d.created_at DESC, d.title ASC";
        break;
    }

    const baseQuery = `
      FROM designs d
      JOIN designers g ON g.id = d.designer_id
      JOIN users u ON u.id = g.user_id
      LEFT JOIN categories c ON c.id = d.category_id
      LEFT JOIN design_likes l ON l.design_id = d.id
      ${whereClause}
      GROUP BY d.id, c.id, c.name, g.id, g.display_name, u.username, u.name
      ${havingClause}
    `;

    const countQuery = `SELECT COUNT(*)::int AS total FROM (
      SELECT d.id ${baseQuery}
    ) AS counted`;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const dataQuery = `
      SELECT
        d.id,
        d.title,
        d.description,
        d.image_url,
        COALESCE(d.thumbnail_url, d.image_url) AS thumbnail_url,
        d.created_at,
        COALESCE(c.name, '') AS category_name,
        c.id AS category_id,
        COALESCE(NULLIF(TRIM(g.display_name), ''), u.username, u.name, 'Anónimo') AS designer_name,
        u.username AS designer_username,
        COUNT(l.user_id)::int AS likes
      ${baseQuery}
      ${orderClause}
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(dataQuery, dataParams);

    const designs = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        title: row.title,
        description: row.description || "",
        image_url: row.image_url,
        thumbnail_url: row.thumbnail_url || row.image_url,
        created_at: row.created_at,
        category: {
          id: row.category_id,
          name: row.category_name || ""
        },
        designer: {
          name: row.designer_name,
          username: row.designer_username
        },
        likes: row.likes,
        mockup_remera: await getRemeraMockupUrl(row.id)
      }))
    );

    res.json({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      designs
    });
  } catch (error) {
    console.error("GET /designs", error);
    res.status(500).json({ error: "No se pudieron obtener los diseños." });
  }
});

// Diseños destacados por likes (incluye categoría)
router.get("/featured", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "6", 10), 24));
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.image_url, d.thumbnail_url, d.created_at,
              COALESCE(u.username, u.name, 'Anónimo') AS designer_name,
              COUNT(l.user_id)::int AS likes,
              c.name AS category_name
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       JOIN users u ON u.id = g.user_id
       JOIN categories c ON c.id = d.category_id
       LEFT JOIN design_likes l ON l.design_id = d.id
       WHERE d.published = true
       GROUP BY d.id, u.username, u.name, c.name
       ORDER BY likes DESC, d.created_at DESC
       LIMIT $1`,
      [limit]
    );
    const withMockup = await Promise.all(rows.map(async (row) => ({
      ...row,
      mockup_remera: await getRemeraMockupUrl(row.id)
    })));
    res.json(withMockup);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar los diseños destacados" });
  }
});

/* ---------- Endpoints autenticados ---------- */

router.post(
  "/mockup-preview",
  requireAuth,
  (req, res, next) => {
    previewUpload.single("image")(req, res, (err) => {
      if (err) {
        const message = err?.message || "Archivo inválido";
        return res.status(400).json({ error: message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Imagen requerida" });
      const buffer = await buildRemeraMockupBuffer(req.file.buffer);
      const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      res.json({ mockup: dataUrl });
    } catch (e) {
      console.error("POST /designs/mockup-preview", e);
      const msg = e?.message?.toLowerCase().includes("unsupported")
        ? "Imagen inválida. Usá JPG, PNG o WEBP."
        : "No se pudo generar el mockup";
      const status = msg.startsWith("Imagen inválida") ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  }
);

// Mis diseños (del usuario logueado)
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.description, d.image_url, d.thumbnail_url,
              d.published,
              COALESCE(d.review_status, CASE WHEN d.published = TRUE THEN 'approved' ELSE 'pending' END) AS review_status,
              d.created_at, COUNT(l.user_id)::int AS likes,
              c.name AS category_name, d.category_id
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       JOIN categories c ON c.id = d.category_id
       LEFT JOIN design_likes l ON l.design_id = d.id
       WHERE g.user_id = $1
       GROUP BY d.id, c.name
       ORDER BY d.created_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar tus diseños" });
  }
});

// Crear diseño (queda pendiente hasta que un admin lo publique)
router.post("/", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const { title, description, category_id: bodyCat } = req.body;
    if (!title || title.trim().length < 3)
      return res.status(400).json({ error: "Título requerido (mín 3 caracteres)" });
    if (!req.file) return res.status(400).json({ error: "Imagen requerida" });

    // Generar thumbnail 600px
    const srcPath   = req.file.path;
    const ext       = path.extname(srcPath).toLowerCase();
    const thumbName = req.file.filename.replace(ext, `.thumb${ext || ".jpg"}`);
    const thumbPath = path.join(thumbsDir, thumbName);
    await sharp(srcPath).resize({ width: 600, withoutEnlargement: true }).toFile(thumbPath);

    const designer = await ensureDesigner(req.user.id);
    const designerId = designer.id;
    const imageUrl = `/img/uploads/${req.file.filename}`;
    const thumbUrl = `/img/uploads/thumbs/${thumbName}`;

    const category_id = await resolveCategoryId(bodyCat);

    const ins = await pool.query(
      `INSERT INTO designs (designer_id, title, description, image_url, thumbnail_url, published, review_status, category_id)
       VALUES ($1,$2,$3,$4,$5, FALSE, 'pending', $6)
       RETURNING id, title, description, image_url, thumbnail_url, published, review_status, category_id, created_at`,
      [designerId, title.trim(), (description || "").trim(), imageUrl, thumbUrl, category_id]
    );
    const design = ins.rows[0];
    const mockup = await generateRemeraMockup(design.id, srcPath);
    res.status(201).json({
      ...design,
      mockup_remera: mockup,
      message: "Diseño recibido. Quedó en revisión del equipo antes de publicarse."
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo crear el diseño" });
  }
});

// Actualizar diseño propio (solo datos básicos)
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, description, category_id } = req.body ?? {};

    const currentQ = await pool.query(
      `SELECT d.id, d.title, d.description, d.category_id,
              COALESCE(d.review_status, CASE WHEN d.published = TRUE THEN 'approved' ELSE 'pending' END) AS review_status,
              d.published,
              d.image_url,
              d.thumbnail_url
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       WHERE d.id = $1 AND g.user_id = $2`,
      [id, userId]
    );
    if (!currentQ.rowCount) return res.status(404).json({ error: "Diseño no encontrado" });
    const current = currentQ.rows[0];

    const fields = [];
    const values = [];
    let idx = 1;
    let contentChanged = false;

    if (typeof title === "string") {
      const clean = title.trim();
      if (clean.length < 3) return res.status(400).json({ error: "Título muy corto" });
      if (clean !== (current.title || "")) {
        fields.push(`title = $${idx++}`);
        values.push(clean);
        contentChanged = true;
      }
    }
    if (typeof description === "string") {
      const cleanDesc = description.trim();
      if (cleanDesc !== (current.description || "")) {
        fields.push(`description = $${idx++}`);
        values.push(cleanDesc);
        contentChanged = true;
      }
    }
    if (typeof category_id !== "undefined") {
      const cat = await resolveCategoryId(category_id, { strict: true });
      if (!cat) return res.status(400).json({ error: "Categoría inválida" });
      if (String(cat) !== String(current.category_id || "")) {
        fields.push(`category_id = $${idx++}`);
        values.push(cat);
        contentChanged = true;
      }
    }

    let nextStatus = current.review_status || "pending";
    let nextPublished = current.published;

    if (contentChanged) {
      nextStatus = "pending";
      nextPublished = false;
    }

    if (nextStatus !== current.review_status) {
      fields.push(`review_status = $${idx++}`);
      values.push(nextStatus);
    }
    if (nextPublished !== current.published) {
      fields.push(`published = $${idx++}`);
      values.push(nextPublished);
    }

    if (!fields.length) {
      return res.json({
        id,
        title: current.title,
        description: current.description,
        category_id: current.category_id,
        review_status: current.review_status,
        published: current.published,
        image_url: current.image_url,
        thumbnail_url: current.thumbnail_url,
        mockup_remera: await getRemeraMockupUrl(id)
      });
    }

    fields.push("updated_at = NOW()");
    values.push(id);
    const updated = await pool.query(
      `UPDATE designs
         SET ${fields.join(", ")}
       WHERE id = $${idx}
       RETURNING id, title, description, category_id, review_status, published, image_url, thumbnail_url, created_at`,
      values
    );
    const updatedDesign = updated.rows[0];
    res.json({ ...updatedDesign, mockup_remera: await getRemeraMockupUrl(id) });
  } catch (e) {
    console.error("PATCH /designs/:id", e);
    res.status(500).json({ error: "No se pudo actualizar el diseño" });
  }
});

// Reemplazar imagen del diseño
router.put("/:id/image", requireAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Imagen requerida" });

    const { id } = req.params;
    const userId = req.user.id;
    const currentQ = await pool.query(
      `SELECT d.image_url, d.thumbnail_url
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       WHERE d.id = $1 AND g.user_id = $2`,
      [id, userId]
    );
    if (!currentQ.rowCount) return res.status(404).json({ error: "Diseño no encontrado" });
    const current = currentQ.rows[0];

    for (const url of [current.image_url, current.thumbnail_url]) {
      if (!url) continue;
      const abs = path.join(process.cwd(), "public", url);
      await removeFileIfExists(abs);
    }

    const srcPath = req.file.path;
    const ext = path.extname(srcPath).toLowerCase();
    const thumbName = req.file.filename.replace(ext, `.thumb${ext || ".jpg"}`);
    const thumbPath = path.join(thumbsDir, thumbName);
    await sharp(srcPath).resize({ width: 600, withoutEnlargement: true }).toFile(thumbPath);

    const imageUrl = `/img/uploads/${req.file.filename}`;
    const thumbUrl = `/img/uploads/thumbs/${thumbName}`;

    const upd = await pool.query(
      `UPDATE designs
         SET image_url=$1,
             thumbnail_url=$2,
             review_status='pending',
             published=FALSE,
             updated_at = NOW()
       WHERE id=$3
       RETURNING id, image_url, thumbnail_url, review_status, published, title, description, category_id, created_at`,
      [imageUrl, thumbUrl, id]
    );
    await removeRemeraMockup(id);
    const mockup = await generateRemeraMockup(id, srcPath);

    res.json({ ...upd.rows[0], mockup_remera: mockup });
  } catch (e) {
    console.error("PUT /designs/:id/image", e);
    res.status(500).json({ error: "No se pudo reemplazar la imagen" });
  }
});

// Eliminar diseño propio
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const find = await pool.query(
      `SELECT d.image_url, d.thumbnail_url
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       WHERE d.id = $1 AND g.user_id = $2`,
      [id, userId]
    );
    if (!find.rowCount) return res.status(404).json({ error: "Diseño no encontrado" });

    await pool.query(`DELETE FROM design_likes WHERE design_id=$1`, [id]);
    await pool.query(`DELETE FROM designs WHERE id=$1`, [id]);
    await removeRemeraMockup(id);

    for (const url of [find.rows[0].image_url, find.rows[0].thumbnail_url]) {
      if (!url) continue;
      const abs = path.join(process.cwd(), "public", url);
      await removeFileIfExists(abs);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /designs/:id", e);
    res.status(500).json({ error: "No se pudo eliminar el diseño" });
  }
});

/* ---------- Detalle por ID (público) ---------- */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const q = await pool.query(
      `SELECT d.id, d.title, d.description, d.image_url, d.thumbnail_url,
              d.created_at, COUNT(l.user_id)::int AS likes,
              COALESCE(u.username, u.name, 'Anónimo') AS designer_name,
              c.name AS category_name, d.category_id,
              COALESCE(d.review_status, CASE WHEN d.published = TRUE THEN 'approved' ELSE 'pending' END) AS review_status,
              d.published
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       JOIN users u ON u.id = g.user_id
       JOIN categories c ON c.id = d.category_id
       LEFT JOIN design_likes l ON l.design_id = d.id
       WHERE d.id = $1
       GROUP BY d.id, u.username, u.name, c.name`,
      [id]
    );
    if (!q.rows.length) return res.status(404).json({ error: "Diseño no encontrado" });
    res.json({ ...q.rows[0], mockup_remera: await getRemeraMockupUrl(id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al obtener el diseño" });
  }
});

/* ---------- Likes (requiere login) ---------- */
router.get("/:id/like", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const r = await pool.query(
      `SELECT 1 FROM design_likes WHERE user_id=$1 AND design_id=$2 LIMIT 1`,
      [userId, id]
    );
    res.json({ liked: !!r.rowCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo obtener el estado de like" });
  }
});

router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const exists = await pool.query(
      `SELECT 1 FROM design_likes WHERE user_id=$1 AND design_id=$2 LIMIT 1`,
      [userId, id]
    );

    if (exists.rowCount) {
      await pool.query(
        `DELETE FROM design_likes WHERE user_id=$1 AND design_id=$2`,
        [userId, id]
      );
    } else {
      await pool.query(
        `INSERT INTO design_likes (user_id, design_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, id]
      );
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int AS likes FROM design_likes WHERE design_id=$1`,
      [id]
    );

    res.json({ liked: !exists.rowCount, likes: count.rows[0].likes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo actualizar el like" });
  }
});

export default router;
