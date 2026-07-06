// src/lib/mockupService.js
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { pool } from "../db.js";

const uploadsDir = path.join(process.cwd(), "public", "img", "uploads");
const mockupsDir = path.join(uploadsDir, "mockups");
const productosDir = path.join(process.cwd(), "public", "img", "productos");
fs.mkdirSync(mockupsDir, { recursive: true });

function withCacheBuster(url, versionSource) {
  if (!url) return url;
  let stamp = Date.now();
  if (typeof versionSource === "number" && Number.isFinite(versionSource)) {
    stamp = Number(versionSource);
  } else if (versionSource) {
    const parsed = Date.parse(versionSource);
    if (!Number.isNaN(parsed)) {
      stamp = parsed;
    }
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${stamp}`;
}

const DEFAULT_CONFIG = {
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

function clamp(num, min, max, fallback) {
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const width = clamp(Number(cfg.width_pct), 0.05, 0.9, DEFAULT_CONFIG.width_pct);
  const height = clamp(
    Number(cfg.height_pct),
    0.05,
    0.9,
    Number.isFinite(cfg.height_pct) ? cfg.height_pct : width
  );
  const left = clamp(Number(cfg.left_pct), 0, 1, DEFAULT_CONFIG.left_pct);
  const top = clamp(Number(cfg.top_pct), 0, 1, DEFAULT_CONFIG.top_pct);
  const legacyX = Number(cfg.curve_x_pct);
  const legacyY = Number(cfg.curve_y_pct);
  const curveTop = clamp(
    Number(cfg.curve_top_pct),
    -1,
    1,
    Number.isFinite(legacyY) ? legacyY : DEFAULT_CONFIG.curve_top_pct
  );
  const curveBottom = clamp(
    Number(cfg.curve_bottom_pct),
    -1,
    1,
    Number.isFinite(legacyY) ? legacyY : DEFAULT_CONFIG.curve_bottom_pct
  );
  const curveLeft = clamp(
    Number(cfg.curve_left_pct),
    -1,
    1,
    Number.isFinite(legacyX) ? legacyX : DEFAULT_CONFIG.curve_left_pct
  );
  const curveRight = clamp(
    Number(cfg.curve_right_pct),
    -1,
    1,
    Number.isFinite(legacyX) ? legacyX : DEFAULT_CONFIG.curve_right_pct
  );
  const blend =
    typeof cfg.blend === "string" && cfg.blend.trim()
      ? cfg.blend.trim()
      : DEFAULT_CONFIG.blend;
  const opacity = Number.isFinite(cfg.opacity)
    ? clamp(Number(cfg.opacity), 0, 1, undefined)
    : undefined;
  const angle = Number.isFinite(cfg.angle) ? Number(cfg.angle) : 0;
  return {
    width_pct: width,
    height_pct: height,
    top_pct: top,
    left_pct: left,
    curve_top_pct: curveTop,
    curve_bottom_pct: curveBottom,
    curve_left_pct: curveLeft,
    curve_right_pct: curveRight,
    blend,
    opacity,
    angle
  };
}

function clampSigned(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

function sampleBilinearRGBA(data, width, height, x, y, out, outIdx) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  for (let c = 0; c < 4; c += 1) {
    const top = data[idx00 + c] * (1 - tx) + data[idx10 + c] * tx;
    const bottom = data[idx01 + c] * (1 - tx) + data[idx11 + c] * tx;
    out[outIdx + c] = Math.round(top * (1 - ty) + bottom * ty);
  }
}

async function applyCurvatureToOverlay(overlayBuffer, curves = {}) {
  const curveTop = clampSigned(Number(curves.curve_top_pct));
  const curveBottom = clampSigned(Number(curves.curve_bottom_pct));
  const curveLeft = clampSigned(Number(curves.curve_left_pct));
  const curveRight = clampSigned(Number(curves.curve_right_pct));
  if (curveTop === 0 && curveBottom === 0 && curveLeft === 0 && curveRight === 0) {
    return overlayBuffer;
  }

  const { data, info } = await sharp(overlayBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width || 0;
  const height = info.height || 0;
  if (!width || !height) return overlayBuffer;

  const out = Buffer.alloc(width * height * 4);
  const maxX = Math.max(1, width - 1);
  const maxY = Math.max(1, height - 1);
  const maxInsetX = 0.42; // proportion of half-width
  const maxInsetY = 0.42; // proportion of half-height

  const profile = (v, c) => (c >= 0 ? (1 - v * v) : (v * v));

  for (let y = 0; y < height; y += 1) {
    const ny = (y / maxY) * 2 - 1;
    for (let x = 0; x < width; x += 1) {
      const nx = (x / maxX) * 2 - 1;
      const outIdx = (y * width + x) * 4;

      // Curved inner bounds: when outside, pixel becomes transparent.
      const insetLeft = Math.abs(curveLeft) * maxInsetX * profile(ny, curveLeft);
      const insetRight = Math.abs(curveRight) * maxInsetX * profile(ny, curveRight);
      const insetTop = Math.abs(curveTop) * maxInsetY * profile(nx, curveTop);
      const insetBottom = Math.abs(curveBottom) * maxInsetY * profile(nx, curveBottom);

      const boundLeft = -1 + insetLeft;
      const boundRight = 1 - insetRight;
      const boundTop = -1 + insetTop;
      const boundBottom = 1 - insetBottom;
      if (nx < boundLeft || nx > boundRight || ny < boundTop || ny > boundBottom) {
        out[outIdx] = 0;
        out[outIdx + 1] = 0;
        out[outIdx + 2] = 0;
        out[outIdx + 3] = 0;
        continue;
      }

      // Remap from curved target area back to full source image.
      const widthSpan = Math.max(1e-6, boundRight - boundLeft);
      const heightSpan = Math.max(1e-6, boundBottom - boundTop);
      const srcNx = ((nx - boundLeft) / widthSpan) * 2 - 1;
      const srcNy = ((ny - boundTop) / heightSpan) * 2 - 1;
      const srcX = ((Math.max(-1, Math.min(1, srcNx)) + 1) * maxX) / 2;
      const srcY = ((Math.max(-1, Math.min(1, srcNy)) + 1) * maxY) / 2;
      sampleBilinearRGBA(data, width, height, srcX, srcY, out, outIdx);
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function resolveTemplatePath(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const clean = imageUrl.replace(/^\/+/, "");
  const full = path.join(process.cwd(), "public", clean);
  return full;
}

async function listMockupTemplates(client = pool, filterIds = null) {
  const params = [];
  let where = `WHERE published = TRUE
        AND image_url IS NOT NULL
        AND LENGTH(TRIM(image_url)) > 0`;
  if (filterIds && Array.isArray(filterIds) && filterIds.length) {
    params.push(filterIds);
    where += ` AND id = ANY($${params.length}::uuid[])`;
  }
  const { rows } = await client.query(
    `SELECT id, name, image_url, curve_x_pct, curve_y_pct, curve_top_pct, curve_bottom_pct, curve_left_pct, curve_right_pct, mockup_config
       FROM products
      ${where}`,
    params
  );
  const templates = [];
  for (const row of rows) {
    const templatePath = resolveTemplatePath(row.image_url);
    if (!templatePath) continue;
    try {
      await fs.promises.access(templatePath);
    } catch {
      continue;
    }
    templates.push({
      product_id: row.id,
      product_name: row.name,
      templatePath,
      config: normalizeConfig({
        ...(row.mockup_config || {}),
        curve_left_pct: Number.isFinite(Number(row.curve_left_pct))
          ? Number(row.curve_left_pct)
          : (Number.isFinite(Number(row.curve_x_pct)) ? Number(row.curve_x_pct) : row?.mockup_config?.curve_left_pct),
        curve_right_pct: Number.isFinite(Number(row.curve_right_pct))
          ? Number(row.curve_right_pct)
          : (Number.isFinite(Number(row.curve_x_pct)) ? Number(row.curve_x_pct) : row?.mockup_config?.curve_right_pct),
        curve_top_pct: Number.isFinite(Number(row.curve_top_pct))
          ? Number(row.curve_top_pct)
          : (Number.isFinite(Number(row.curve_y_pct)) ? Number(row.curve_y_pct) : row?.mockup_config?.curve_top_pct),
        curve_bottom_pct: Number.isFinite(Number(row.curve_bottom_pct))
          ? Number(row.curve_bottom_pct)
          : (Number.isFinite(Number(row.curve_y_pct)) ? Number(row.curve_y_pct) : row?.mockup_config?.curve_bottom_pct)
      })
    });
  }
  return templates;
}

async function buildComposite(templatePath, designSource, config) {
  const templateMeta = await sharp(templatePath).metadata();
  const tplWidth = templateMeta.width || 1000;
  const tplHeight = templateMeta.height || 1000;

  const overlayWidth = Math.max(
    24,
    Math.round(tplWidth * (config.width_pct ?? DEFAULT_CONFIG.width_pct))
  );
  const overlayHeight = Math.max(
    24,
    Math.round(tplHeight * (config.height_pct ?? config.width_pct ?? DEFAULT_CONFIG.height_pct))
  );

  let overlaySharp = sharp(designSource).resize({
    width: overlayWidth,
    height: overlayHeight,
    fit: "contain",
    background: { r: 255, g: 255, b: 255, alpha: 0 }
  });

  if (config.angle) {
    overlaySharp = overlaySharp.rotate(config.angle, {
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    });
  }

  let overlayBuffer = await overlaySharp.png().toBuffer();
  overlayBuffer = await applyCurvatureToOverlay(overlayBuffer, config);
  const overlayMeta = await sharp(overlayBuffer).metadata();
  const ovWidth = overlayMeta.width || overlayWidth;
  const ovHeight = overlayMeta.height || overlayHeight;

  const leftAnchor = config.left_pct ?? DEFAULT_CONFIG.left_pct;
  const topAnchor = config.top_pct ?? DEFAULT_CONFIG.top_pct;

  const rawLeft = Math.round(tplWidth * leftAnchor - ovWidth / 2);
  const left = Math.min(tplWidth - ovWidth, Math.max(0, rawLeft));
  const rawTop = Math.round(tplHeight * topAnchor - ovHeight / 2);
  const top = Math.min(tplHeight - ovHeight, Math.max(0, rawTop));

  const compositeOptions = {
    input: overlayBuffer,
    left,
    top,
    blend: config.blend || DEFAULT_CONFIG.blend
  };
  if (typeof config.opacity === "number") {
    compositeOptions.opacity = clamp(config.opacity, 0, 1, config.opacity);
  }

  return sharp(templatePath)
    .composite([compositeOptions])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function removeUnusedMockups(designId, keepIds = [], client = pool) {
  const { rows } = await client.query(
    `SELECT product_id, image_url
       FROM design_product_mockups
      WHERE design_id = $1`,
    [designId]
  );
  const keepSet = new Set(keepIds.map((id) => String(id)));
  for (const row of rows) {
    if (!keepSet.has(String(row.product_id))) {
      if (row.image_url && row.image_url.startsWith("/img/uploads/mockups/")) {
        const filename = row.image_url.replace("/img/uploads/mockups/", "");
        const absPath = path.join(mockupsDir, filename);
        await fs.promises.unlink(absPath).catch(() => {});
      }
      await client.query(
        `DELETE FROM design_product_mockups
          WHERE design_id = $1
            AND product_id = $2`,
        [designId, row.product_id]
      );
    }
  }
}

export async function generateProductMockups(designId, designPath, client = pool, targetProductIds = null) {
  const templates = await listMockupTemplates(client, targetProductIds);
  if (!templates.length) return [];

  if (!targetProductIds) {
    await removeUnusedMockups(designId, templates.map((t) => t.product_id), client);
  }

  const results = [];
  for (const tpl of templates) {
    try {
      const buffer = await buildComposite(tpl.templatePath, designPath, tpl.config);
      const filename = `${designId}-${tpl.product_id}.jpg`;
      const outputPath = path.join(mockupsDir, filename);
      await fs.promises.writeFile(outputPath, buffer);
      const url = `/img/uploads/mockups/${filename}`;
      const insert = await client.query(
        `INSERT INTO design_product_mockups (design_id, product_id, image_url)
         VALUES ($1,$2,$3)
         ON CONFLICT (design_id, product_id)
         DO UPDATE SET image_url = EXCLUDED.image_url, created_at = now()
         RETURNING created_at`,
        [designId, tpl.product_id, url]
      );
      const createdAt = insert.rows[0]?.created_at;
      results.push({
        product_id: tpl.product_id,
        product_name: tpl.product_name,
        image_url: withCacheBuster(url, createdAt)
      });
    } catch (err) {
      console.error("generateProductMockups", err?.message || err);
    }
  }
  return results;
}

export async function previewProductMockups(buffer, client = pool) {
  const templates = await listMockupTemplates(client);
  if (!templates.length) return [];
  const previews = [];
  for (const tpl of templates) {
    try {
      const composite = await buildComposite(tpl.templatePath, buffer, tpl.config);
      previews.push({
        product_id: tpl.product_id,
        product_name: tpl.product_name,
        image: `data:image/jpeg;base64,${composite.toString("base64")}`
      });
    } catch (err) {
      console.error("previewProductMockups", err?.message || err);
    }
  }
  return previews;
}

export async function getDesignMockups(designIds, client = pool) {
  const map = new Map();
  if (!Array.isArray(designIds) || !designIds.length) return map;
  const { rows } = await client.query(
    `SELECT m.design_id,
            m.product_id,
            m.image_url,
            m.created_at,
            p.name AS product_name,
            p.price,
            p.designer_base_price,
            p.designer_commission_type,
            p.designer_commission_value,
            p.designer_commission_amount
       FROM design_product_mockups m
       JOIN products p ON p.id = m.product_id
      WHERE m.design_id = ANY($1::uuid[])
        AND p.published = TRUE
      ORDER BY p.name ASC`,
    [designIds]
  );

  for (const row of rows) {
    const list = map.get(row.design_id) || [];
    list.push({
      product_id: row.product_id,
      product_name: row.product_name,
      image_url: withCacheBuster(row.image_url, row.created_at),
      price: row.price !== null ? Number(row.price) : null,
      designer_base_price: row.designer_base_price !== null ? Number(row.designer_base_price) : 0,
      designer_commission_type: row.designer_commission_type || "percent",
      designer_commission_value: row.designer_commission_value !== null ? Number(row.designer_commission_value) : 0,
      designer_commission_amount: row.designer_commission_amount !== null ? Number(row.designer_commission_amount) : 0
    });
    map.set(row.design_id, list);
  }
  return map;
}

export async function deleteDesignMockups(designId, client = pool) {
  const { rows } = await client.query(
    `SELECT image_url FROM design_product_mockups WHERE design_id=$1`,
    [designId]
  );
  await client.query(
    `DELETE FROM design_product_mockups WHERE design_id=$1`,
    [designId]
  );
  for (const row of rows) {
    if (row.image_url && row.image_url.startsWith("/img/uploads/mockups/")) {
      const filename = row.image_url.replace("/img/uploads/mockups/", "");
      const absPath = path.join(mockupsDir, filename);
      await fs.promises.unlink(absPath).catch(() => {});
    }
  }
}

export { DEFAULT_CONFIG as DEFAULT_MOCKUP_CONFIG };
