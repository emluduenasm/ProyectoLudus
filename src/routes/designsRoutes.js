// src/routes/designsRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureDesigner } from "../lib/designerService.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import {
  generateProductMockups,
  previewProductMockups,
  getDesignMockups,
  deleteDesignMockups
} from "../lib/mockupService.js";

const router = Router();

/* ---------- Paths y helpers ---------- */
const uploadsDir = path.join(process.cwd(), "public", "img", "uploads");
const thumbsDir  = path.join(uploadsDir, "thumbs");
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(thumbsDir,  { recursive: true });

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

function normalizeTags(input) {
  const raw = Array.isArray(input) ? input.join(",") : String(input || "");
  const seen = new Set();
  return raw
    .split(",")
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((tag) => tag.slice(0, 32))
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function sameTags(a = [], b = []) {
  return JSON.stringify(normalizeTags(a)) === JSON.stringify(normalizeTags(b));
}

async function getImageQualityReport(source) {
  const metadata = await sharp(source).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const density = Number(metadata.density || 0);
  const alerts = [];

  if (width && height) {
    if (Math.min(width, height) < 1200) {
      alerts.push({
        code: "low_pixel_size",
        severity: "warning",
        message: `La imagen mide ${width}x${height}px. Para impresiones nítidas recomendamos al menos 1200px en el lado más corto.`
      });
    } else if (Math.min(width, height) < 2000) {
      alerts.push({
        code: "medium_pixel_size",
        severity: "info",
        message: `La imagen mide ${width}x${height}px. Puede funcionar en productos chicos, pero 2000px o más mejora el resultado.`
      });
    }
  }

  if (density) {
    if (density < 150) {
      alerts.push({
        code: "low_dpi",
        severity: "warning",
        message: `El archivo declara ${density} DPI. Para impresión recomendamos 150 DPI como mínimo y 300 DPI como ideal.`
      });
    } else if (density < 300) {
      alerts.push({
        code: "medium_dpi",
        severity: "info",
        message: `El archivo declara ${density} DPI. Es aceptable, aunque 300 DPI suele dar mejor definición.`
      });
    }
  } else {
    alerts.push({
      code: "missing_dpi",
      severity: "info",
      message: "No encontramos DPI embebido en el archivo. Revisá que el original tenga buena resolución antes de publicarlo."
    });
  }

  return {
    width,
    height,
    density: density || null,
    format: metadata.format || "",
    alerts
  };
}

async function removeFileIfExists(filePathAbs) {
  try {
    await fs.promises.unlink(filePathAbs);
  } catch {}
}

async function resolveDesignAssetPath(row) {
  if (!row) return null;
  const sources = [row.image_url, row.thumbnail_url];
  for (const source of sources) {
    if (!source) continue;
    const abs = path.join(process.cwd(), "public", source.replace(/^\/+/, ""));
    try {
      await fs.promises.access(abs);
      return abs;
    } catch {
      continue;
    }
  }
  return null;
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

    const filters = ["d.published = TRUE"];
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
          OR EXISTS (
            SELECT 1
              FROM unnest(COALESCE(d.tags, '{}'::text[])) AS tag
             WHERE LOWER(tag) LIKE $${idx}
          )
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
        COALESCE(d.tags, '{}'::text[]) AS tags,
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

    const ids = rows.map((row) => row.id);
    const mockupMap = await getDesignMockups(ids);

    const designs = rows.map((row) => {
      const mockups = mockupMap.get(row.id) || [];
      const remera = mockups.find((m) =>
        (m.product_name || "").toLowerCase().includes("remera")
      );
      return {
        id: row.id,
        title: row.title,
        description: row.description || "",
        tags: row.tags || [],
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
        mockups,
        mockup_remera: (remera || mockups[0] || {}).image_url || null
      };
    });

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
      `SELECT d.id, d.title, d.tags, d.image_url, d.thumbnail_url, d.created_at,
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
    const mockupMap = await getDesignMockups(rows.map((row) => row.id));
    const withMockup = rows.map((row) => {
      const mockups = mockupMap.get(row.id) || [];
      const remera = mockups.find((m) =>
        (m.product_name || "").toLowerCase().includes("remera")
      );
      return {
        ...row,
        mockups,
        mockup_remera: (remera || mockups[0] || {}).image_url || null
      };
    });
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
      const quality = await getImageQualityReport(req.file.buffer);
      const previews = await previewProductMockups(req.file.buffer);
      res.json({
        mockup: previews[0]?.image ?? null,
        mockups: previews,
        quality,
        quality_alerts: quality.alerts
      });
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
              d.created_at, COALESCE(d.tags, '{}'::text[]) AS tags, COUNT(l.user_id)::int AS likes,
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
    const ids = rows.map((row) => row.id);
    const mockupMap = await getDesignMockups(ids);
    const enriched = rows.map((row) => {
      const mockups = mockupMap.get(row.id) || [];
      const remera =
        mockups.find((m) => (m.product_name || "").toLowerCase().includes("remera")) ||
        mockups[0] ||
        null;
      return {
        ...row,
        mockups,
        mockup_remera: remera ? remera.image_url : null
      };
    });
    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar tus diseños" });
  }
});

// Crear diseño (queda pendiente hasta que un admin lo publique)
router.post("/", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const { title, description, category_id: bodyCat, tags: bodyTags } = req.body;
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
    const tags = normalizeTags(bodyTags);
    const quality = await getImageQualityReport(srcPath);

    const ins = await pool.query(
      `INSERT INTO designs (designer_id, title, description, tags, image_url, thumbnail_url, published, review_status, category_id)
       VALUES ($1,$2,$3,$4,$5,$6, FALSE, 'pending', $7)
       RETURNING id, title, description, tags, image_url, thumbnail_url, published, review_status, category_id, created_at`,
      [designerId, title.trim(), (description || "").trim(), tags, imageUrl, thumbUrl, category_id]
    );
    const design = ins.rows[0];
    const mockups = await generateProductMockups(design.id, srcPath);
    const mockupRemera =
      mockups.find((m) => (m.product_name || "").toLowerCase().includes("remera")) ||
      mockups[0] ||
      null;
    res.status(201).json({
      ...design,
      mockups,
      mockup_remera: mockupRemera ? mockupRemera.image_url : null,
      quality,
      quality_alerts: quality.alerts,
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
    const { title, description, category_id, tags, published } = req.body ?? {};

    const currentQ = await pool.query(
      `SELECT d.id, d.title, d.description, d.tags, d.category_id,
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
    if (typeof tags !== "undefined") {
      const cleanTags = normalizeTags(tags);
      if (!sameTags(cleanTags, current.tags || [])) {
        fields.push(`tags = $${idx++}`);
        values.push(cleanTags);
        contentChanged = true;
      }
    }

    let nextStatus = current.review_status || "pending";
    let nextPublished = current.published;

    if (contentChanged) {
      nextStatus = "pending";
      nextPublished = false;
    }

    if (!contentChanged && typeof published !== "undefined") {
      const requestedPublished = !!published;
      if (requestedPublished && nextStatus !== "approved") {
        return res.status(400).json({
          error: "El diseño debe estar aprobado por un administrador antes de publicarse."
        });
      }
      nextPublished = requestedPublished;
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
      const mockupsMap = await getDesignMockups([id]);
      const mockups = mockupsMap.get(id) || [];
      const remera =
        mockups.find((m) => (m.product_name || "").toLowerCase().includes("remera")) ||
        mockups[0] ||
        null;
      return res.json({
        id,
        title: current.title,
        description: current.description,
        tags: current.tags || [],
        category_id: current.category_id,
        review_status: current.review_status,
        published: current.published,
        image_url: current.image_url,
        thumbnail_url: current.thumbnail_url,
        mockups,
        mockup_remera: remera ? remera.image_url : null
      });
    }

    fields.push("updated_at = NOW()");
    values.push(id);
    const updated = await pool.query(
      `UPDATE designs
         SET ${fields.join(", ")}
       WHERE id = $${idx}
       RETURNING id, title, description, tags, category_id, review_status, published, image_url, thumbnail_url, created_at`,
      values
    );
    const updatedDesign = updated.rows[0];
    const mockupsMap = await getDesignMockups([id]);
    const mockups = mockupsMap.get(id) || [];
    const remera =
      mockups.find((m) => (m.product_name || "").toLowerCase().includes("remera")) ||
      mockups[0] ||
      null;
    res.json({
      ...updatedDesign,
      mockups,
      mockup_remera: remera ? remera.image_url : null
    });
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
       RETURNING id, image_url, thumbnail_url, review_status, published, title, description, tags, category_id, created_at`,
      [imageUrl, thumbUrl, id]
    );
    const mockups = await generateProductMockups(id, srcPath);
    const remera =
      mockups.find((m) => (m.product_name || "").toLowerCase().includes("remera")) ||
      mockups[0] ||
      null;

    const legacyPath = path.join(process.cwd(), "public", "img", "uploads", "mockups", `${id}-remera.jpg`);
    await removeFileIfExists(legacyPath);

    res.json({
      ...upd.rows[0],
      mockups,
      mockup_remera: remera ? remera.image_url : null
    });
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
    await deleteDesignMockups(id);
    await pool.query(`DELETE FROM designs WHERE id=$1`, [id]);
    const legacyPath = path.join(process.cwd(), "public", "img", "uploads", "mockups", `${id}-remera.jpg`);
    await removeFileIfExists(legacyPath);

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
      `SELECT d.id, d.title, d.description, COALESCE(d.tags, '{}'::text[]) AS tags, d.image_url, d.thumbnail_url,
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
    const designRow = q.rows[0];
    const productsQ = await pool.query(
      `SELECT id
         FROM products
        WHERE published = TRUE
          AND image_url IS NOT NULL
          AND LENGTH(TRIM(image_url)) > 0`
    );
    const publishedProductIds = productsQ.rows.map((row) => String(row.id));

    const mockupsMap = await getDesignMockups([id]);
    let mockups = mockupsMap.get(id) || [];
    const mockupProductIds = mockups
      .map((m) => (m.product_id ? String(m.product_id) : null))
      .filter(Boolean);
    const missingProductIds = publishedProductIds.filter(
      (prodId) => !mockupProductIds.includes(prodId)
    );

    const needsFullRegen = mockups.length === 0;
    const needsMissing = missingProductIds.length > 0;

    if ((needsFullRegen || needsMissing)) {
      const assetPath = await resolveDesignAssetPath(designRow);
      if (assetPath) {
        await generateProductMockups(
          id,
          assetPath,
          undefined,
          needsMissing && !needsFullRegen ? missingProductIds : null
        );
        const refreshed = await getDesignMockups([id]);
        mockups = refreshed.get(id) || [];
      } else {
        console.warn("design detail mockup regen: no asset found for design", id);
      }
    }
    const remera =
      mockups.find((m) => (m.product_name || "").toLowerCase().includes("remera")) ||
      mockups[0] ||
      null;
    res.json({
      ...designRow,
      mockups,
      mockup_remera: remera ? remera.image_url : null
    });
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
