// src/routes/designsRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

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

async function ensureDesignerId(userId) {
  const q = await pool.query(`SELECT id FROM designers WHERE user_id=$1 LIMIT 1`, [userId]);
  if (q.rows[0]) return q.rows[0].id;

  const info = await pool.query(`SELECT username, name FROM users WHERE id=$1`, [userId]);
  const display = info.rows[0]?.username || info.rows[0]?.name || `Designer-${String(userId).slice(0,8)}`;
  const ins = await pool.query(
    `INSERT INTO designers (user_id, display_name, avatar_url)
     VALUES ($1,$2,$3) RETURNING id`,
    [userId, display, "/img/disenador1.jpg"]
  );
  return ins.rows[0].id;
}

async function resolveCategoryId(category_id) {
  // Si viene un UUID válido y existe/activa, úsalo; si no, usar “otros”
  if (category_id) {
    const r = await pool.query(`SELECT id FROM categories WHERE id=$1 AND active=TRUE`, [category_id]);
    if (r.rowCount) return r.rows[0].id;
  }
  const otros = await pool.query(`SELECT id FROM categories WHERE slug='otros'`);
  return otros.rows[0]?.id;
}

/* ---------- Endpoints públicos ---------- */

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
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar los diseños destacados" });
  }
});

/* ---------- Endpoints autenticados ---------- */

// Mis diseños (del usuario logueado)
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.description, d.image_url, d.thumbnail_url,
              d.published, d.created_at, COUNT(l.user_id)::int AS likes,
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

// Crear diseño (publicado automáticamente + genera miniatura + categoría obligatoria/por defecto)
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

    const designerId = await ensureDesignerId(req.user.id);
    const imageUrl = `/img/uploads/${req.file.filename}`;
    const thumbUrl = `/img/uploads/thumbs/${thumbName}`;

    const category_id = await resolveCategoryId(bodyCat);

    const ins = await pool.query(
      `INSERT INTO designs (designer_id, title, description, image_url, thumbnail_url, published, category_id)
       VALUES ($1,$2,$3,$4,$5, true, $6)
       RETURNING id, title, description, image_url, thumbnail_url, published, category_id, created_at`,
      [designerId, title.trim(), (description || "").trim(), imageUrl, thumbUrl, category_id]
    );
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo crear el diseño" });
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
              c.name AS category_name, d.category_id
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
    res.json(q.rows[0]);
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
