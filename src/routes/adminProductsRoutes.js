// src/routes/adminProductsRoutes.js
import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generateProductMockups } from "../lib/mockupService.js";

const router = Router();
const onlyAdmin = [requireAuth, requireRole("admin")];

const uploadsDir = path.join(process.cwd(), "public", "img", "uploads");
const productosDir = path.join(process.cwd(), "public", "img", "productos");
const mockupsDir = path.join(uploadsDir, "mockups");
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(productosDir, { recursive: true });
fs.mkdirSync(mockupsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, productosDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const base = path
      .basename(file.originalname || "producto", ext)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, 60);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base || "producto"}${ext || ".jpg"}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Formato no permitido (png, jpg, webp)"), ok);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 6 * 1024 * 1024 }
});

async function removeFileIfExists(absPath) {
  try {
    await fs.promises.unlink(absPath);
  } catch {}
}

async function removeMockupsForProduct(productId) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT image_url
         FROM design_product_mockups
        WHERE product_id = $1`,
      [productId]
    );

    for (const row of rows) {
      const imageUrl = row.image_url || "";
      if (!imageUrl.startsWith("/img/uploads/mockups/")) continue;
      const filename = imageUrl.replace("/img/uploads/mockups/", "");
      if (!filename) continue;
      await removeFileIfExists(path.join(mockupsDir, filename));
    }

    await client.query(
      `DELETE FROM design_product_mockups
        WHERE product_id = $1`,
      [productId]
    );
  } catch (err) {
    console.error("removeMockupsForProduct", err?.message || err);
  } finally {
    client.release();
  }
}

const DEFAULT_MOCKUP_CONFIG = {
  width_pct: 0.45,
  height_pct: 0.45,
  top_pct: 0.18,
  left_pct: 0.5,
  blend: "multiply"
};

const normalizeConfig = (input) => {
  if (!input || typeof input !== "object") return { ...DEFAULT_MOCKUP_CONFIG };
  const width = Number.isFinite(input.width_pct) ? input.width_pct : DEFAULT_MOCKUP_CONFIG.width_pct;
  const heightRaw = Number.isFinite(input.height_pct) ? input.height_pct : width;
  const leftRaw = Number.isFinite(input.left_pct) ? input.left_pct : DEFAULT_MOCKUP_CONFIG.left_pct;
  const topRaw = Number.isFinite(input.top_pct) ? input.top_pct : DEFAULT_MOCKUP_CONFIG.top_pct;
  const blend = typeof input.blend === "string" && input.blend.trim() ? input.blend.trim() : DEFAULT_MOCKUP_CONFIG.blend;
  const angle = Number.isFinite(input.angle) ? input.angle : 0;
  const opacity = Number.isFinite(input.opacity) ? Math.min(1, Math.max(0, input.opacity)) : undefined;

  const widthClamped = Math.min(0.9, Math.max(0.05, width));
  const heightClamped = Math.min(0.9, Math.max(0.05, heightRaw));
  const leftClamped = Math.min(1, Math.max(0, leftRaw));
  const topClamped = Math.min(1, Math.max(0, topRaw));

  return {
    width_pct: widthClamped,
    height_pct: heightClamped,
    top_pct: topClamped,
    left_pct: leftClamped,
    blend,
    angle,
    ...(typeof opacity === "number" ? { opacity } : {})
  };
};

const mapRow = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description || "",
  price: row.price !== null ? Number(row.price) : 0,
  stock: row.stock ?? 0,
  image_url: row.image_url || "",
  published: row.published ?? false,
  mockup_config: normalizeConfig(row.mockup_config),
  created_at: row.created_at,
  updated_at: row.updated_at
});

const DEFAULT_MOCKUP = normalizeConfig({});

function parseMockupConfigFromBody(body, fallback) {
  const base = { ...normalizeConfig(fallback || DEFAULT_MOCKUP) };
  const maybeNumber = (key, min, max) => {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
    const parsed = Number.parseFloat(body[key]);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.min(max, Math.max(min, parsed));
  };

  const width = maybeNumber("mockup_width_pct", 0.05, 0.9);
  const height = maybeNumber("mockup_height_pct", 0.05, 0.9);
  const left = maybeNumber("mockup_left_pct", 0, 1);
  const top = maybeNumber("mockup_top_pct", 0, 1);

  if (typeof width === "number") base.width_pct = width;
  if (typeof height === "number") base.height_pct = height;
  if (typeof left === "number") base.left_pct = left;
  if (typeof top === "number") base.top_pct = top;

  return normalizeConfig(base);
}

router.get("/", ...onlyAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const published =
      typeof req.query.published === "string" ? req.query.published.trim() : "";
    const sort = (req.query.sort || "newest").toString().trim();

    const filters = [];
    const params = [];
    let idx = 0;
    const push = (value) => {
      params.push(value);
      idx += 1;
      return `$${idx}`;
    };

    if (q) {
      const p = push(`%${q}%`);
      filters.push(
        `(LOWER(name) LIKE ${p} OR LOWER(description) LIKE ${p})`
      );
    }

    if (published === "1" || published === "0") {
      const p = push(published === "1");
      filters.push(`published = ${p}`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const totalQ = await pool.query(
      `SELECT COUNT(*)::int AS total FROM products ${whereSql}`,
      params
    );
    const total = totalQ.rows[0]?.total ?? 0;

    const offset = (page - 1) * limit;

    let orderSql = "created_at DESC";
    if (sort === "oldest") orderSql = "created_at ASC";
    else if (sort === "price_asc") orderSql = "price ASC, created_at DESC";
    else if (sort === "price_desc") orderSql = "price DESC, created_at DESC";
    else if (sort === "stock_asc") orderSql = "stock ASC, created_at DESC";
    else if (sort === "stock_desc") orderSql = "stock DESC, created_at DESC";
    else if (sort === "name_asc") orderSql = "name ASC";

    const rowsQ = await pool.query(
      `SELECT id, name, description, price, stock, image_url, published, mockup_config, created_at, updated_at
       FROM products
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${idx + 1}
       OFFSET $${idx + 2}`,
      [...params, limit, offset]
    );

    res.json({
      page,
      limit,
      total,
      items: rowsQ.rows.map(mapRow)
    });
  } catch (error) {
    console.error("ADMIN products list", error);
    res.status(500).json({ error: "No se pudo obtener la lista de productos" });
  }
});

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "on", "si", "sí"].includes(v)) return true;
    if (["0", "false", "off", "no"].includes(v)) return false;
  }
  return fallback;
}

function parsePrice(value) {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Number(num.toFixed(2));
}

function parseStock(value) {
  if (value === null || typeof value === "undefined" || value === "") return null;
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

router.post(
  "/",
  ...onlyAdmin,
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err?.message || "Imagen inválida" });
      }
      next();
    });
  },
  async (req, res) => {
    const { name, description, price, stock, published } = req.body;
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) return res.status(400).json({ error: "El nombre es obligatorio" });
    if (!req.file) return res.status(400).json({ error: "La imagen es obligatoria" });
    const numericPrice = parsePrice(price);
    if (numericPrice === null) {
      return res.status(400).json({ error: "Precio inválido" });
    }
    const numericStock = parseStock(stock);
    if (numericStock === null) {
      return res.status(400).json({ error: "Stock inválido" });
    }

    const imageUrl = `/img/productos/${req.file.filename}`;
    const mockupConfig = parseMockupConfigFromBody(req.body, DEFAULT_MOCKUP);

    try {
      const insert = await pool.query(
        `INSERT INTO products (name, description, price, stock, image_url, published, mockup_config)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, description, price, stock, image_url, published, mockup_config, created_at, updated_at`,
        [
          cleanName,
          (description || "").toString().trim(),
          numericPrice,
          numericStock,
          imageUrl,
          parseBoolean(published, false),
          mockupConfig
        ]
      );
      const created = mapRow(insert.rows[0]);
      if (created.published) {
        await regenerateMockupsForProduct(created.id, { includeAllDesigns: true });
      }
      res.status(201).json(created);
    } catch (error) {
      console.error("ADMIN products create", error);
      if (req.file) {
        await removeFileIfExists(path.join(productosDir, req.file.filename));
      }
      res.status(500).json({ error: "No se pudo crear el producto" });
    }
  }
);

router.patch(
  "/:id",
  ...onlyAdmin,
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err?.message || "Imagen inválida" });
      }
      next();
    });
  },
  async (req, res) => {
    const { id } = req.params;
    try {
      const prevQ = await pool.query(
        `SELECT id, name, description, price, stock, image_url, published, mockup_config
         FROM products
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      const prev = prevQ.rows[0];
      if (!prev) {
        if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      const fields = [];
      const values = [];
      let idx = 0;
      const push = (value) => {
        values.push(value);
        idx += 1;
        return `$${idx}`;
      };

      if (typeof req.body.name === "string") {
        const cleanName = req.body.name.trim();
        if (!cleanName) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "El nombre no puede estar vacío" });
        }
        fields.push(`name = ${push(cleanName)}`);
      }
      if (typeof req.body.description === "string") {
        fields.push(`description = ${push(req.body.description.trim())}`);
      }
      if (typeof req.body.price !== "undefined") {
        const numericPrice = parsePrice(req.body.price);
        if (numericPrice === null) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "Precio inválido" });
        }
        fields.push(`price = ${push(numericPrice)}`);
      }
      if (typeof req.body.stock !== "undefined") {
        const numericStock = parseStock(req.body.stock);
        if (numericStock === null) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "Stock inválido" });
        }
        fields.push(`stock = ${push(numericStock)}`);
      }
      let nextPublishedValue = prev.published;
      let publishedChanged = false;
      if (typeof req.body.published !== "undefined") {
        nextPublishedValue = parseBoolean(req.body.published, prev.published);
        publishedChanged = nextPublishedValue !== prev.published;
        fields.push(`published = ${push(nextPublishedValue)}`);
      }

      let configChanged = false;
      if (
        Object.prototype.hasOwnProperty.call(req.body, "mockup_width_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_height_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_left_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_top_pct")
      ) {
        const newConfig = parseMockupConfigFromBody(req.body, prev.mockup_config);
        configChanged = JSON.stringify(normalizeConfig(prev.mockup_config)) !== JSON.stringify(newConfig);
        fields.push(`mockup_config = ${push(newConfig)}`);
      }

      const imageChanged = !!req.file;
      if (req.file) {
        const newImageUrl = `/img/productos/${req.file.filename}`;
        fields.push(`image_url = ${push(newImageUrl)}`);
      }

      if (!fields.length) {
        if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
        return res.status(400).json({ error: "No se enviaron cambios" });
      }

      fields.push(`updated_at = now()`);
      values.push(id);

      const updateQ = await pool.query(
        `UPDATE products
           SET ${fields.join(", ")}
         WHERE id = $${idx + 1}
        RETURNING id, name, description, price, stock, image_url, published, mockup_config, created_at, updated_at`,
        values
      );
      const updatedRow = mapRow(updateQ.rows[0]);

      if (req.file && prev.image_url && prev.image_url.startsWith("/img/productos/")) {
        const oldName = prev.image_url.replace("/img/productos/", "");
        if (oldName && oldName !== req.file.filename) {
          await removeFileIfExists(path.join(productosDir, oldName));
        }
      }

      if (publishedChanged && !nextPublishedValue) {
        await removeMockupsForProduct(id);
      }

      const shouldRebuildAll =
        (publishedChanged && nextPublishedValue) || imageChanged;

      if (shouldRebuildAll) {
        await regenerateMockupsForProduct(id, { includeAllDesigns: true });
      } else if (configChanged) {
        await regenerateMockupsForProduct(id);
      }

      res.json(updatedRow);
    } catch (error) {
      console.error("ADMIN products update", error);
      if (req.file) {
        await removeFileIfExists(path.join(productosDir, req.file.filename));
      }
      res.status(500).json({ error: "No se pudo actualizar el producto" });
    }
  }
);

router.delete("/:id", ...onlyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const productQ = await pool.query(
      `SELECT image_url
         FROM products
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!productQ.rowCount) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    await removeMockupsForProduct(id);

    const del = await pool.query(
      `DELETE FROM products
       WHERE id = $1
       RETURNING image_url`,
      [id]
    );
    if (!del.rowCount) return res.status(404).json({ error: "Producto no encontrado" });

    const imageUrl = del.rows[0]?.image_url || productQ.rows[0]?.image_url || "";
    if (imageUrl && imageUrl.startsWith("/img/productos/")) {
      const name = imageUrl.replace("/img/productos/", "");
      if (name) await removeFileIfExists(path.join(productosDir, name));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("ADMIN products delete", error);
    res.status(500).json({ error: "No se pudo eliminar el producto" });
  }
});

async function regenerateMockupsForProduct(productId, { includeAllDesigns = false } = {}) {
  const client = await pool.connect();
  try {
    let rows = [];
    if (includeAllDesigns) {
      const q = await client.query(
        `SELECT id AS design_id, image_url
           FROM designs
          WHERE image_url IS NOT NULL
            AND LENGTH(TRIM(image_url)) > 0
            AND (
              published = TRUE
              OR COALESCE(review_status, 'pending') = 'approved'
            )`
      );
      rows = q.rows;
    } else {
      const q = await client.query(
        `SELECT m.design_id, d.image_url
           FROM design_product_mockups m
           JOIN designs d ON d.id = m.design_id
          WHERE m.product_id = $1`,
        [productId]
      );
      rows = q.rows;
    }

    if (!rows.length) return;

    for (const row of rows) {
      if (!row.image_url) continue;
      const absPath = path.join(process.cwd(), "public", row.image_url.replace(/^\/+/, ""));
      try {
        await fs.promises.access(absPath);
      } catch {
        continue;
      }
      await generateProductMockups(row.design_id, absPath, client, [productId]);
    }
  } catch (err) {
    console.error("regenerateMockupsForProduct", err?.message || err);
  } finally {
    client.release();
  }
}

export default router;
