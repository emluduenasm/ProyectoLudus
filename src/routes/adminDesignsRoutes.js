// src/routes/adminDesignsRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const router = Router();
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
const upload = multer({ storage, fileFilter, limits: { fileSize: 8 * 1024 * 1024 } });

const onlyAdmin = [requireAuth, requireRole("admin")];

/* Helpers */
async function removeFileIfExists(filePathAbs) {
  try { await fs.promises.unlink(filePathAbs); } catch {}
}

/* ------- LIST (con búsqueda & paginación) ------- */
router.get("/", ...onlyAdmin, async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const q     = (req.query.q || "").trim();

    const where = [];
    const params = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where.push(`(LOWER(d.title) LIKE $${params.length} OR LOWER(u.username) LIKE $${params.length} OR LOWER(u.name) LIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countQ = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       JOIN users u ON u.id = g.user_id
       ${whereSql}`, params
    );
    const total = countQ.rows[0].total;
    const offset = (page - 1) * limit;

    const rowsQ = await pool.query(
      `SELECT d.id, d.title, d.description, d.published, d.created_at,
              d.image_url, d.thumbnail_url,
              COALESCE(u.username, u.name, 'Anónimo') AS designer_name,
              COUNT(l.user_id)::int AS likes
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       JOIN users u ON u.id = g.user_id
       LEFT JOIN design_likes l ON l.design_id = d.id
       ${whereSql}
       GROUP BY d.id, u.username, u.name
       ORDER BY d.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
       [...params, limit, offset]
    );

    res.json({
      page, limit, total,
      items: rowsQ.rows
    });
  } catch (e) {
    console.error("ADMIN designs list", e);
    res.status(500).json({ error: "No se pudo obtener la lista" });
  }
});

/* ------- UPDATE: título, descripción, publicado ------- */
router.patch("/:id", ...onlyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let { title, description, published } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (typeof title === "string") {
      title = title.trim();
      if (title.length < 3) return res.status(400).json({ error: "Título muy corto" });
      fields.push(`title = $${idx++}`); values.push(title);
    }
    if (typeof description === "string") {
      fields.push(`description = $${idx++}`); values.push(description.trim());
    }
    if (typeof published !== "undefined") {
      fields.push(`published = $${idx++}`); values.push(!!published);
    }
    if (!fields.length) return res.status(400).json({ error: "Sin cambios" });

    values.push(id);
    const upd = await pool.query(
      `UPDATE designs SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`,
      values
    );
    if (!upd.rows.length) return res.status(404).json({ error: "Diseño no encontrado" });
    res.json(upd.rows[0]);
  } catch (e) {
    console.error("ADMIN designs patch", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

/* ------- REPLACE IMAGE (regenera thumbnail) ------- */
router.put("/:id/image", ...onlyAdmin, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Imagen requerida" });

    const { id } = req.params;
    const find = await pool.query(`SELECT image_url, thumbnail_url FROM designs WHERE id=$1`, [id]);
    if (!find.rows.length) return res.status(404).json({ error: "Diseño no encontrado" });

    // Borrar archivos anteriores
    for (const url of [find.rows[0].image_url, find.rows[0].thumbnail_url]) {
      if (!url) continue;
      const abs = path.join(process.cwd(), "public", url);
      await removeFileIfExists(abs);
    }

    // Guardar nueva + thumb
    const srcPath   = req.file.path;
    const ext       = path.extname(srcPath).toLowerCase();
    const thumbName = req.file.filename.replace(ext, `.thumb${ext || ".jpg"}`);
    const thumbPath = path.join(thumbsDir, thumbName);
    await sharp(srcPath).resize({ width: 600, withoutEnlargement: true }).toFile(thumbPath);

    const imageUrl = `/img/uploads/${req.file.filename}`;
    const thumbUrl = `/img/uploads/thumbs/${thumbName}`;

    const upd = await pool.query(
      `UPDATE designs SET image_url=$1, thumbnail_url=$2 WHERE id=$3 RETURNING *`,
      [imageUrl, thumbUrl, id]
    );
    res.json(upd.rows[0]);
  } catch (e) {
    console.error("ADMIN designs replace image", e);
    res.status(500).json({ error: "No se pudo reemplazar la imagen" });
  }
});

/* ------- DELETE (y borra likes + archivos) ------- */
router.delete("/:id", ...onlyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const find = await pool.query(`SELECT image_url, thumbnail_url FROM designs WHERE id=$1`, [id]);
    if (!find.rows.length) return res.status(404).json({ error: "Diseño no encontrado" });

    await pool.query(`DELETE FROM design_likes WHERE design_id=$1`, [id]);
    await pool.query(`DELETE FROM designs WHERE id=$1`, [id]);

    for (const url of [find.rows[0].image_url, find.rows[0].thumbnail_url]) {
      if (!url) continue;
      const abs = path.join(process.cwd(), "public", url);
      await removeFileIfExists(abs);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN designs delete", e);
    res.status(500).json({ error: "No se pudo eliminar" });
  }
});

export default router;
