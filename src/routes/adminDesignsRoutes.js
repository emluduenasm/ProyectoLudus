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

async function removeFileIfExists(filePathAbs) { try { await fs.promises.unlink(filePathAbs); } catch {} }

/* ------- LIST (búsqueda + filtros + orden + paginación) ------- */
router.get("/", ...onlyAdmin, async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);

    const q         = (req.query.q || "").trim().toLowerCase();
    const category  = (req.query.category || "").trim();           // category_id
    const published = (req.query.published ?? "").toString().trim(); // "", "1", "0"
    const from      = (req.query.from || "").trim();               // YYYY-MM-DD
    const to        = (req.query.to || "").trim();                 // YYYY-MM-DD
    const sort      = (req.query.sort || "newest").trim();

    const where = [];
    const params = [];
    let i = 0;
    const add = (val) => { params.push(val); return `$${++i}`; };

    // Búsqueda por título / username / nombre
    if (q) {
      const p1 = add(`%${q}%`);
      const p2 = add(`%${q}%`);
      const p3 = add(`%${q}%`);
      where.push(`(LOWER(d.title) LIKE ${p1} OR LOWER(u.username) LIKE ${p2} OR LOWER(u.name) LIKE ${p3})`);
    }
    if (category) {
      const p = add(category);
      where.push(`d.category_id = ${p}`);
    }
    if (published === "1" || published === "0") {
      const p = add(published === "1");
      where.push(`d.published = ${p}`);
    }
    if (from) {
      const p = add(from); // ISO yyyy-mm-dd
      where.push(`DATE(d.created_at) >= ${p}`);
    }
    if (to) {
      const p = add(to);   // ISO yyyy-mm-dd
      where.push(`DATE(d.created_at) <= ${p}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const offset = (page - 1) * limit;

    // Total
    const countQ = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM designs d
       JOIN designers g ON g.id = d.designer_id
       JOIN users u ON u.id = g.user_id
       ${whereSql}`,
      params
    );
    const total = countQ.rows[0]?.total ?? 0;

    // Orden (el SELECT exterior usa alias "b" para la tabla base)
    let orderSql = "b.created_at DESC";
    if (sort === "oldest")       orderSql = "b.created_at ASC";
    else if (sort === "likes_desc") orderSql = "likes DESC, b.created_at DESC";
    else if (sort === "likes_asc")  orderSql = "likes ASC,  b.created_at DESC";
    else if (sort === "title_asc")  orderSql = "b.title ASC, b.created_at DESC";

    // Datos
    const rowsQ = await pool.query(
      `WITH base AS (
         SELECT d.id, d.title, d.description, d.published, d.created_at,
                d.image_url, d.thumbnail_url, d.category_id,
                COALESCE(u.username, u.name, 'Anónimo') AS designer_name
         FROM designs d
         JOIN designers g ON g.id = d.designer_id
         JOIN users u ON u.id = g.user_id
         ${whereSql}
       ),
       likes AS (
         SELECT design_id, COUNT(*)::int AS likes
         FROM design_likes
         GROUP BY design_id
       )
       SELECT b.*,
              COALESCE(l.likes, 0) AS likes,
              c.name AS category_name
       FROM base b
       LEFT JOIN likes      l ON l.design_id = b.id
       LEFT JOIN categories c ON c.id = b.category_id
       ORDER BY ${orderSql}
       LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...params, limit, offset]
    );

    res.json({ page, limit, total, items: rowsQ.rows });
  } catch (e) {
    console.error("ADMIN designs list", e?.stack || e);
    res.status(500).json({ error: "No se pudo obtener la lista" });
  }
});


/* ------- UPDATE: título, descripción, publicado, category_id ------- */
router.patch("/:id", ...onlyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let { title, description, published, category_id } = req.body;

    if (typeof category_id !== "undefined") {
      const vr = await pool.query(`SELECT id FROM categories WHERE id=$1 AND active=TRUE`, [category_id]);
      if (!vr.rowCount) return res.status(400).json({ error: "Categoría inválida" });
    }

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
    if (typeof category_id !== "undefined") {
      fields.push(`category_id = $${idx++}`); values.push(category_id);
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

/* ------- REPLACE IMAGE (se mantiene por si lo usas luego) ------- */
router.put("/:id/image", ...onlyAdmin, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Imagen requerida" });

    const { id } = req.params;
    const find = await pool.query(`SELECT image_url, thumbnail_url FROM designs WHERE id=$1`, [id]);
    if (!find.rows.length) return res.status(404).json({ error: "Diseño no encontrado" });

    for (const url of [find.rows[0].image_url, find.rows[0].thumbnail_url]) {
      if (!url) continue;
      const abs = path.join(process.cwd(), "public", url);
      await removeFileIfExists(abs);
    }

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

/* ------- DELETE ------- */
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
