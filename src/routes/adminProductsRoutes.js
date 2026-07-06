// src/routes/adminProductsRoutes.js
import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generateProductMockups } from "../lib/mockupService.js";
import {
  calculateProductPricing,
  normalizeCommissionType,
  parseMoney,
  parsePercent
} from "../lib/pricingService.js";

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
  top_pct: 0.5,
  left_pct: 0.5,
  curve_top_pct: 0,
  curve_bottom_pct: 0,
  curve_left_pct: 0,
  curve_right_pct: 0,
  blend: "multiply"
};

const normalizeConfig = (input) => {
  if (!input || typeof input !== "object") return { ...DEFAULT_MOCKUP_CONFIG };
  const width = Number.isFinite(input.width_pct) ? input.width_pct : DEFAULT_MOCKUP_CONFIG.width_pct;
  const heightRaw = Number.isFinite(input.height_pct) ? input.height_pct : width;
  const leftRaw = Number.isFinite(input.left_pct) ? input.left_pct : DEFAULT_MOCKUP_CONFIG.left_pct;
  const topRaw = Number.isFinite(input.top_pct) ? input.top_pct : DEFAULT_MOCKUP_CONFIG.top_pct;
  const legacyCurveX = Number.isFinite(input.curve_x_pct) ? input.curve_x_pct : undefined;
  const legacyCurveY = Number.isFinite(input.curve_y_pct) ? input.curve_y_pct : undefined;
  const curveTopRaw = Number.isFinite(input.curve_top_pct)
    ? input.curve_top_pct
    : (Number.isFinite(legacyCurveY) ? legacyCurveY : DEFAULT_MOCKUP_CONFIG.curve_top_pct);
  const curveBottomRaw = Number.isFinite(input.curve_bottom_pct)
    ? input.curve_bottom_pct
    : (Number.isFinite(legacyCurveY) ? legacyCurveY : DEFAULT_MOCKUP_CONFIG.curve_bottom_pct);
  const curveLeftRaw = Number.isFinite(input.curve_left_pct)
    ? input.curve_left_pct
    : (Number.isFinite(legacyCurveX) ? legacyCurveX : DEFAULT_MOCKUP_CONFIG.curve_left_pct);
  const curveRightRaw = Number.isFinite(input.curve_right_pct)
    ? input.curve_right_pct
    : (Number.isFinite(legacyCurveX) ? legacyCurveX : DEFAULT_MOCKUP_CONFIG.curve_right_pct);
  const blend = typeof input.blend === "string" && input.blend.trim() ? input.blend.trim() : DEFAULT_MOCKUP_CONFIG.blend;
  const angle = Number.isFinite(input.angle) ? input.angle : 0;
  const opacity = Number.isFinite(input.opacity) ? Math.min(1, Math.max(0, input.opacity)) : undefined;

  const widthClamped = Math.min(0.9, Math.max(0.05, width));
  const heightClamped = Math.min(0.9, Math.max(0.05, heightRaw));
  const leftClamped = Math.min(1, Math.max(0, leftRaw));
  const topClamped = Math.min(1, Math.max(0, topRaw));
  const curveTopClamped = Math.min(1, Math.max(-1, curveTopRaw));
  const curveBottomClamped = Math.min(1, Math.max(-1, curveBottomRaw));
  const curveLeftClamped = Math.min(1, Math.max(-1, curveLeftRaw));
  const curveRightClamped = Math.min(1, Math.max(-1, curveRightRaw));

  return {
    width_pct: widthClamped,
    height_pct: heightClamped,
    top_pct: topClamped,
    left_pct: leftClamped,
    curve_top_pct: curveTopClamped,
    curve_bottom_pct: curveBottomClamped,
    curve_left_pct: curveLeftClamped,
    curve_right_pct: curveRightClamped,
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
  product_cost: row.product_cost !== null ? Number(row.product_cost) : 0,
  fixed_costs: row.fixed_costs !== null ? Number(row.fixed_costs) : 0,
  site_profit_percent: row.site_profit_percent !== null ? Number(row.site_profit_percent) : 0,
  designer_commission_type: row.designer_commission_type || "percent",
  designer_commission_value: row.designer_commission_value !== null ? Number(row.designer_commission_value) : 0,
  designer_base_price: row.designer_base_price !== null ? Number(row.designer_base_price) : 0,
  designer_commission_amount: row.designer_commission_amount !== null ? Number(row.designer_commission_amount) : 0,
  cost_components: Array.isArray(row.cost_components)
    ? row.cost_components.map((component) => ({
        id: component.id || null,
        name: component.name || "",
        amount: Number(component.amount ?? 0),
        sort_order: Number(component.sort_order ?? 0)
      }))
    : [],
  stock: row.stock ?? 0,
  image_url: row.image_url || "",
  published: row.published ?? false,
  mockup_config: normalizeConfig({
    ...(row.mockup_config || {}),
    curve_left_pct: Number.isFinite(Number(row?.curve_left_pct))
      ? Number(row.curve_left_pct)
      : (Number.isFinite(Number(row?.curve_x_pct)) ? Number(row.curve_x_pct) : row?.mockup_config?.curve_left_pct),
    curve_right_pct: Number.isFinite(Number(row?.curve_right_pct))
      ? Number(row.curve_right_pct)
      : (Number.isFinite(Number(row?.curve_x_pct)) ? Number(row.curve_x_pct) : row?.mockup_config?.curve_right_pct),
    curve_top_pct: Number.isFinite(Number(row?.curve_top_pct))
      ? Number(row.curve_top_pct)
      : (Number.isFinite(Number(row?.curve_y_pct)) ? Number(row.curve_y_pct) : row?.mockup_config?.curve_top_pct),
    curve_bottom_pct: Number.isFinite(Number(row?.curve_bottom_pct))
      ? Number(row.curve_bottom_pct)
      : (Number.isFinite(Number(row?.curve_y_pct)) ? Number(row.curve_y_pct) : row?.mockup_config?.curve_bottom_pct)
  }),
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
  const curveTop = maybeNumber("mockup_curve_top_pct", -1, 1);
  const curveBottom = maybeNumber("mockup_curve_bottom_pct", -1, 1);
  const curveLeft = maybeNumber("mockup_curve_left_pct", -1, 1);
  const curveRight = maybeNumber("mockup_curve_right_pct", -1, 1);
  const legacyCurveX = maybeNumber("mockup_curve_x_pct", -1, 1);
  const legacyCurveY = maybeNumber("mockup_curve_y_pct", -1, 1);

  if (typeof width === "number") base.width_pct = width;
  if (typeof height === "number") base.height_pct = height;
  if (typeof left === "number") base.left_pct = left;
  if (typeof top === "number") base.top_pct = top;
  if (typeof curveTop === "number") base.curve_top_pct = curveTop;
  if (typeof curveBottom === "number") base.curve_bottom_pct = curveBottom;
  if (typeof curveLeft === "number") base.curve_left_pct = curveLeft;
  if (typeof curveRight === "number") base.curve_right_pct = curveRight;
  if (typeof legacyCurveX === "number") {
    if (typeof curveLeft !== "number") base.curve_left_pct = legacyCurveX;
    if (typeof curveRight !== "number") base.curve_right_pct = legacyCurveX;
  }
  if (typeof legacyCurveY === "number") {
    if (typeof curveTop !== "number") base.curve_top_pct = legacyCurveY;
    if (typeof curveBottom !== "number") base.curve_bottom_pct = legacyCurveY;
  }

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
      `SELECT id, name, description, price, product_cost, fixed_costs, site_profit_percent, designer_commission_type, designer_commission_value, designer_base_price, designer_commission_amount, stock, image_url, published, curve_x_pct, curve_y_pct, curve_top_pct, curve_bottom_pct, curve_left_pct, curve_right_pct, mockup_config, created_at, updated_at
       FROM products
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${idx + 1}
       OFFSET $${idx + 2}`,
      [...params, limit, offset]
    );

    const items = await attachCostComponents(rowsQ.rows);

    res.json({
      page,
      limit,
      total,
      items: items.map(mapRow)
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

function parseStock(value) {
  if (value === null || typeof value === "undefined" || value === "") return null;
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function parsePrice(value) {
  return parseMoney(value);
}

function parseCostComponents(raw, fallbackAmount = 0) {
  let input = raw;
  if (typeof raw === "string") {
    const clean = raw.trim();
    if (!clean) input = [];
    else {
      try {
        input = JSON.parse(clean);
      } catch {
        return null;
      }
    }
  }
  if (!Array.isArray(input)) return null;
  const components = [];
  input.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const name = String(entry.name || "").trim().replace(/\s+/g, " ");
    const amount = parseMoney(entry.amount);
    if (!name && (!amount || amount === 0)) return;
    if (!name || amount === null) {
      components.push(null);
      return;
    }
    components.push({ name: name.slice(0, 80), amount, sort_order: index });
  });
  if (components.some((component) => component === null)) return null;
  if (!components.length && Number(fallbackAmount) > 0) {
    components.push({
      name: "Costos fijos",
      amount: parseMoney(fallbackAmount, 0) ?? 0,
      sort_order: 0
    });
  }
  return components;
}

function sumCostComponents(components = []) {
  return Number(
    components.reduce((sum, component) => sum + Number(component.amount || 0), 0).toFixed(2)
  );
}

async function fetchCostComponents(productIds, client = pool) {
  if (!Array.isArray(productIds) || !productIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT id, product_id, name, amount, sort_order
       FROM product_cost_components
      WHERE product_id = ANY($1::uuid[])
      ORDER BY product_id, sort_order ASC, created_at ASC`,
    [productIds]
  );
  const map = new Map();
  for (const row of rows) {
    const list = map.get(String(row.product_id)) || [];
    list.push({
      id: row.id,
      name: row.name,
      amount: Number(row.amount ?? 0),
      sort_order: row.sort_order ?? 0
    });
    map.set(String(row.product_id), list);
  }
  return map;
}

async function attachCostComponents(rows, client = pool) {
  const componentMap = await fetchCostComponents(rows.map((row) => row.id), client);
  return rows.map((row) => ({
    ...row,
    cost_components: componentMap.get(String(row.id)) || []
  }));
}

async function replaceCostComponents(productId, components = [], client = pool) {
  await client.query(`DELETE FROM product_cost_components WHERE product_id = $1`, [productId]);
  if (!components.length) return;
  const values = [];
  const params = [];
  let idx = 1;
  for (const component of components) {
    params.push(productId, component.name, component.amount, component.sort_order);
    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
    idx += 4;
  }
  await client.query(
    `INSERT INTO product_cost_components (product_id, name, amount, sort_order)
     VALUES ${values.join(", ")}`,
    params
  );
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
    const { name, description, stock, published } = req.body;
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) return res.status(400).json({ error: "El nombre es obligatorio" });
    if (!req.file) return res.status(400).json({ error: "La imagen es obligatoria" });
    const numericStock = parseStock(stock);
    if (numericStock === null) {
      return res.status(400).json({ error: "Stock inválido" });
    }
    const productCost = parseMoney(req.body.product_cost);
    const components = parseCostComponents(req.body.cost_components, req.body.fixed_costs);
    if (!components) {
      return res.status(400).json({ error: "Costos fijos inválidos" });
    }
    const fixedCosts = sumCostComponents(components);
    const siteProfitPercent = parsePercent(req.body.site_profit_percent);
    const designerCommissionValue = parseMoney(req.body.designer_commission_value);
    if ([productCost, fixedCosts, siteProfitPercent, designerCommissionValue].some((value) => value === null)) {
      return res.status(400).json({ error: "Valores de precio o comisión inválidos" });
    }
    const pricing = calculateProductPricing({
      product_cost: productCost,
      fixed_costs: fixedCosts,
      site_profit_percent: siteProfitPercent,
      designer_commission_type: normalizeCommissionType(req.body.designer_commission_type),
      designer_commission_value: designerCommissionValue
    });

    const imageUrl = `/img/productos/${req.file.filename}`;
    const mockupConfig = parseMockupConfigFromBody(req.body, DEFAULT_MOCKUP);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const insert = await client.query(
        `INSERT INTO products (name, description, price, product_cost, fixed_costs, site_profit_percent, designer_commission_type, designer_commission_value, designer_base_price, designer_commission_amount, stock, image_url, published, curve_x_pct, curve_y_pct, curve_top_pct, curve_bottom_pct, curve_left_pct, curve_right_pct, mockup_config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id, name, description, price, product_cost, fixed_costs, site_profit_percent, designer_commission_type, designer_commission_value, designer_base_price, designer_commission_amount, stock, image_url, published, curve_x_pct, curve_y_pct, curve_top_pct, curve_bottom_pct, curve_left_pct, curve_right_pct, mockup_config, created_at, updated_at`,
        [
          cleanName,
          (description || "").toString().trim(),
          pricing.price,
          pricing.product_cost,
          pricing.fixed_costs,
          pricing.site_profit_percent,
          pricing.designer_commission_type,
          pricing.designer_commission_value,
          pricing.designer_base_price,
          pricing.designer_commission_amount,
          numericStock,
          imageUrl,
          parseBoolean(published, false),
          ((mockupConfig.curve_left_pct ?? 0) + (mockupConfig.curve_right_pct ?? 0)) / 2,
          ((mockupConfig.curve_top_pct ?? 0) + (mockupConfig.curve_bottom_pct ?? 0)) / 2,
          mockupConfig.curve_top_pct ?? 0,
          mockupConfig.curve_bottom_pct ?? 0,
          mockupConfig.curve_left_pct ?? 0,
          mockupConfig.curve_right_pct ?? 0,
          mockupConfig
        ]
      );
      await replaceCostComponents(insert.rows[0].id, components, client);
      await client.query("COMMIT");
      const [createdWithComponents] = await attachCostComponents(insert.rows);
      const created = mapRow(createdWithComponents);
      if (created.published) {
        await regenerateMockupsForProduct(created.id, { includeAllDesigns: true });
      }
      res.status(201).json(created);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("ADMIN products create", error);
      if (req.file) {
        await removeFileIfExists(path.join(productosDir, req.file.filename));
      }
      res.status(500).json({ error: "No se pudo crear el producto" });
    } finally {
      client.release();
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
        `SELECT id, name, description, price, product_cost, fixed_costs, site_profit_percent, designer_commission_type, designer_commission_value, designer_base_price, designer_commission_amount, stock, image_url, published, curve_x_pct, curve_y_pct, curve_top_pct, curve_bottom_pct, curve_left_pct, curve_right_pct, mockup_config
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
      const pricingInput = {
        product_cost: prev.product_cost,
        fixed_costs: prev.fixed_costs,
        site_profit_percent: prev.site_profit_percent,
        designer_commission_type: prev.designer_commission_type,
        designer_commission_value: prev.designer_commission_value
      };
      let pricingChanged = false;
      let nextCostComponents = null;
      if (typeof req.body.cost_components !== "undefined") {
        nextCostComponents = parseCostComponents(req.body.cost_components, req.body.fixed_costs);
        if (!nextCostComponents) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "Costos fijos inválidos" });
        }
        pricingInput.fixed_costs = sumCostComponents(nextCostComponents);
        pricingChanged = true;
      }
      if (typeof req.body.product_cost !== "undefined") {
        const parsed = parseMoney(req.body.product_cost);
        if (parsed === null) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "Costo de producto inválido" });
        }
        pricingInput.product_cost = parsed;
        pricingChanged = true;
      }
      if (typeof req.body.fixed_costs !== "undefined" && typeof req.body.cost_components === "undefined") {
        const parsed = parseMoney(req.body.fixed_costs);
        if (parsed === null) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "Costos fijos inválidos" });
        }
        pricingInput.fixed_costs = parsed;
        pricingChanged = true;
      }
      if (typeof req.body.site_profit_percent !== "undefined") {
        const parsed = parsePercent(req.body.site_profit_percent);
        if (parsed === null) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "Ganancia del sitio inválida" });
        }
        pricingInput.site_profit_percent = parsed;
        pricingChanged = true;
      }
      if (typeof req.body.designer_commission_type !== "undefined") {
        pricingInput.designer_commission_type = normalizeCommissionType(
          req.body.designer_commission_type,
          prev.designer_commission_type || "percent"
        );
        pricingChanged = true;
      }
      if (typeof req.body.designer_commission_value !== "undefined") {
        const parsed = parseMoney(req.body.designer_commission_value);
        if (parsed === null) {
          if (req.file) await removeFileIfExists(path.join(productosDir, req.file.filename));
          return res.status(400).json({ error: "Comisión del diseñador inválida" });
        }
        pricingInput.designer_commission_value = parsed;
        pricingChanged = true;
      }
      if (pricingChanged) {
        const pricing = calculateProductPricing(pricingInput);
        fields.push(`price = ${push(pricing.price)}`);
        fields.push(`product_cost = ${push(pricing.product_cost)}`);
        fields.push(`fixed_costs = ${push(pricing.fixed_costs)}`);
        fields.push(`site_profit_percent = ${push(pricing.site_profit_percent)}`);
        fields.push(`designer_commission_type = ${push(pricing.designer_commission_type)}`);
        fields.push(`designer_commission_value = ${push(pricing.designer_commission_value)}`);
        fields.push(`designer_base_price = ${push(pricing.designer_base_price)}`);
        fields.push(`designer_commission_amount = ${push(pricing.designer_commission_amount)}`);
      }
      let nextPublishedValue = prev.published;
      let publishedChanged = false;
      if (typeof req.body.published !== "undefined") {
        nextPublishedValue = parseBoolean(req.body.published, prev.published);
        publishedChanged = nextPublishedValue !== prev.published;
        fields.push(`published = ${push(nextPublishedValue)}`);
      }

      let configChanged = false;
      const prevConfig = {
        ...(prev.mockup_config || {}),
        curve_left_pct: Number.isFinite(Number(prev.curve_left_pct))
          ? Number(prev.curve_left_pct)
          : (Number.isFinite(Number(prev.curve_x_pct)) ? Number(prev.curve_x_pct) : prev?.mockup_config?.curve_left_pct),
        curve_right_pct: Number.isFinite(Number(prev.curve_right_pct))
          ? Number(prev.curve_right_pct)
          : (Number.isFinite(Number(prev.curve_x_pct)) ? Number(prev.curve_x_pct) : prev?.mockup_config?.curve_right_pct),
        curve_top_pct: Number.isFinite(Number(prev.curve_top_pct))
          ? Number(prev.curve_top_pct)
          : (Number.isFinite(Number(prev.curve_y_pct)) ? Number(prev.curve_y_pct) : prev?.mockup_config?.curve_top_pct),
        curve_bottom_pct: Number.isFinite(Number(prev.curve_bottom_pct))
          ? Number(prev.curve_bottom_pct)
          : (Number.isFinite(Number(prev.curve_y_pct)) ? Number(prev.curve_y_pct) : prev?.mockup_config?.curve_bottom_pct)
      };
      if (
        Object.prototype.hasOwnProperty.call(req.body, "mockup_width_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_height_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_left_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_top_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_curve_top_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_curve_bottom_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_curve_left_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_curve_right_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_curve_x_pct") ||
        Object.prototype.hasOwnProperty.call(req.body, "mockup_curve_y_pct")
      ) {
        const newConfig = parseMockupConfigFromBody(req.body, prevConfig);
        configChanged = JSON.stringify(normalizeConfig(prevConfig)) !== JSON.stringify(newConfig);
        fields.push(`mockup_config = ${push(newConfig)}`);
        fields.push(`curve_x_pct = ${push(((newConfig.curve_left_pct ?? 0) + (newConfig.curve_right_pct ?? 0)) / 2)}`);
        fields.push(`curve_y_pct = ${push(((newConfig.curve_top_pct ?? 0) + (newConfig.curve_bottom_pct ?? 0)) / 2)}`);
        fields.push(`curve_top_pct = ${push(newConfig.curve_top_pct ?? 0)}`);
        fields.push(`curve_bottom_pct = ${push(newConfig.curve_bottom_pct ?? 0)}`);
        fields.push(`curve_left_pct = ${push(newConfig.curve_left_pct ?? 0)}`);
        fields.push(`curve_right_pct = ${push(newConfig.curve_right_pct ?? 0)}`);
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
        RETURNING id, name, description, price, product_cost, fixed_costs, site_profit_percent, designer_commission_type, designer_commission_value, designer_base_price, designer_commission_amount, stock, image_url, published, curve_x_pct, curve_y_pct, curve_top_pct, curve_bottom_pct, curve_left_pct, curve_right_pct, mockup_config, created_at, updated_at`,
        values
      );
      if (nextCostComponents) {
        await replaceCostComponents(id, nextCostComponents);
      }
      const [updatedWithComponents] = await attachCostComponents(updateQ.rows);
      const updatedRow = mapRow(updatedWithComponents);

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
        await regenerateMockupsForProduct(id, { includeAllDesigns: true });
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
            AND LENGTH(TRIM(image_url)) > 0`
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
