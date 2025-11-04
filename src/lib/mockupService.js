// src/lib/mockupService.js
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { pool } from "../db.js";

const uploadsDir = path.join(process.cwd(), "public", "img", "uploads");
const mockupsDir = path.join(uploadsDir, "mockups");
const productosDir = path.join(process.cwd(), "public", "img", "productos");
fs.mkdirSync(mockupsDir, { recursive: true });

const DEFAULT_CONFIG = {
  width_pct: 0.45,
  height_pct: 0.45,
  top_pct: 0.18,
  left_pct: 0.5,
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
  let left = clamp(Number(cfg.left_pct), 0, 1, DEFAULT_CONFIG.left_pct);
  let top = clamp(Number(cfg.top_pct), 0, 1, DEFAULT_CONFIG.top_pct);
  const blend =
    typeof cfg.blend === "string" && cfg.blend.trim()
      ? cfg.blend.trim()
      : DEFAULT_CONFIG.blend;
  const opacity = Number.isFinite(cfg.opacity)
    ? clamp(Number(cfg.opacity), 0, 1, undefined)
    : undefined;
  const angle = Number.isFinite(cfg.angle) ? Number(cfg.angle) : 0;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (left < halfWidth) left = halfWidth;
  if (left > 1 - halfWidth) left = 1 - halfWidth;
  if (top < halfHeight) top = halfHeight;
  if (top > 1 - halfHeight) top = 1 - halfHeight;

  return {
    width_pct: width,
    height_pct: height,
    top_pct: top,
    left_pct: left,
    blend,
    opacity,
    angle
  };
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
    `SELECT id, name, image_url, mockup_config
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
      config: normalizeConfig(row.mockup_config)
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
    fit: "cover"
  });

  if (config.angle) {
    overlaySharp = overlaySharp.rotate(config.angle, {
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    });
  }

  const overlayBuffer = await overlaySharp.png().toBuffer();
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
      await client.query(
        `INSERT INTO design_product_mockups (design_id, product_id, image_url)
         VALUES ($1,$2,$3)
         ON CONFLICT (design_id, product_id)
         DO UPDATE SET image_url = EXCLUDED.image_url, created_at = now()`,
        [designId, tpl.product_id, url]
      );
      results.push({
        product_id: tpl.product_id,
        product_name: tpl.product_name,
        image_url: url
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
            p.name AS product_name
       FROM design_product_mockups m
       JOIN products p ON p.id = m.product_id
      WHERE m.design_id = ANY($1::uuid[])
      ORDER BY p.name ASC`,
    [designIds]
  );

  for (const row of rows) {
    const list = map.get(row.design_id) || [];
    list.push({
      product_id: row.product_id,
      product_name: row.product_name,
      image_url: row.image_url
    });
    map.set(row.design_id, list);
  }
  for (const id of designIds) {
    if (map.has(id)) continue;
    const legacyName = `${id}-remera.jpg`;
    const legacyPath = path.join(mockupsDir, legacyName);
    try {
      await fs.promises.access(legacyPath);
      map.set(id, [
        {
          product_id: null,
          product_name: "Mockup remera",
          image_url: `/img/uploads/mockups/${legacyName}`
        }
      ]);
    } catch {}
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
