import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureCartSchema } from "../lib/cartService.js";

const router = Router();

const normalizeId = (value) => String(value || "").trim();
const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

const normalizeQuantity = (value, fallback = 1) => {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity) || quantity < 1) return fallback;
  return Math.min(quantity, 99);
};

function rowToCartItem(row) {
  return {
    key: `${row.design_id}:${row.product_id}`,
    id: row.id,
    design_id: row.design_id,
    design_title: row.design_title || "",
    product_id: row.product_id,
    product_name: row.product_name || "",
    price: Number(row.price ?? 0),
    quantity: Number(row.quantity || 1),
    image_url: row.image_url || "",
    added_count: Number(row.added_count || 1),
    created_at: row.created_at,
    first_added_at: row.first_added_at,
    last_added_at: row.last_added_at,
    updated_at: row.updated_at
  };
}

async function fetchCart(userId) {
  await ensureCartSchema();
  const result = await pool.query(
    `SELECT
       ci.id,
       ci.design_id,
       d.title AS design_title,
       ci.product_id,
       p.name AS product_name,
       p.price,
       ci.quantity,
       ci.added_count,
       ci.created_at,
       ci.first_added_at,
       ci.last_added_at,
       ci.updated_at,
       COALESCE(dpm.image_url, p.image_url, d.thumbnail_url, d.image_url) AS image_url
     FROM cart_items ci
     JOIN designs d ON d.id = ci.design_id
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN design_product_mockups dpm
       ON dpm.design_id = ci.design_id AND dpm.product_id = ci.product_id
     WHERE ci.user_id = $1
       AND ci.removed_at IS NULL
       AND p.published = TRUE
       AND (
         d.published = TRUE
         OR COALESCE(d.review_status, CASE WHEN d.published = TRUE THEN 'approved' ELSE 'pending' END) = 'approved'
       )
     ORDER BY ci.updated_at DESC`,
    [userId]
  );
  const items = result.rows.map(rowToCartItem);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  return { items, count, total };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    res.json(await fetchCart(req.user.id));
  } catch (err) {
    console.error("GET /cart", err);
    res.status(500).json({ error: "No se pudo cargar el carrito." });
  }
});

router.post("/items", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const designId = normalizeId(req.body?.design_id || req.body?.designId);
  const productId = normalizeId(req.body?.product_id || req.body?.productId);
  const quantity = normalizeQuantity(req.body?.quantity);

  if (!isUuid(designId) || !isUuid(productId)) {
    return res.status(400).json({ error: "Producto o diseño inválido." });
  }

  try {
    await ensureCartSchema();
    const availability = await pool.query(
      `SELECT
         d.id AS design_id,
         p.id AS product_id,
         p.published AS product_published,
         d.title AS design_title,
         COALESCE(d.review_status, CASE WHEN d.published = TRUE THEN 'approved' ELSE 'pending' END) AS review_status,
         d.published AS design_published
       FROM designs d
       CROSS JOIN products p
       WHERE d.id = $1::uuid
         AND p.id = $2::uuid
       LIMIT 1`,
      [designId, productId]
    );
    const item = availability.rows[0];
    const designOk =
      item && (item.design_published === true || item.review_status === "approved");
    if (!item || !designOk || item.product_published !== true) {
      return res.status(400).json({ error: "El producto o diseño no está disponible." });
    }

    await pool.query(
      `INSERT INTO cart_items (
         user_id,
         design_id,
         product_id,
         quantity,
         added_count,
         first_added_at,
         last_added_at,
         updated_at,
         removed_at
       )
       VALUES ($1, $2, $3, $4, 1, now(), now(), now(), NULL)
       ON CONFLICT (user_id, design_id, product_id)
       DO UPDATE SET
         quantity = CASE
           WHEN cart_items.removed_at IS NULL THEN LEAST(cart_items.quantity + EXCLUDED.quantity, 99)
           ELSE EXCLUDED.quantity
         END,
         added_count = cart_items.added_count + 1,
         last_added_at = now(),
         updated_at = now(),
         removed_at = NULL`,
      [userId, designId, productId, quantity]
    );
    res.status(201).json(await fetchCart(userId));
  } catch (err) {
    console.error("POST /cart/items", err);
    res.status(500).json({ error: "No se pudo agregar al carrito." });
  }
});

router.patch("/items/:key", requireAuth, async (req, res) => {
  const [designId, productId] = String(req.params.key || "").split(":");
  const quantity = normalizeQuantity(req.body?.quantity);
  if (!isUuid(designId) || !isUuid(productId)) {
    return res.status(400).json({ error: "Item de carrito inválido." });
  }

  try {
    await ensureCartSchema();
    await pool.query(
      `UPDATE cart_items
          SET quantity = $4,
              updated_at = now()
        WHERE user_id = $1
          AND design_id = $2::uuid
          AND product_id = $3::uuid
          AND removed_at IS NULL`,
      [req.user.id, designId, productId, quantity]
    );
    res.json(await fetchCart(req.user.id));
  } catch (err) {
    console.error("PATCH /cart/items/:key", err);
    res.status(500).json({ error: "No se pudo actualizar el carrito." });
  }
});

router.delete("/items/:key", requireAuth, async (req, res) => {
  const [designId, productId] = String(req.params.key || "").split(":");
  if (!isUuid(designId) || !isUuid(productId)) {
    return res.status(400).json({ error: "Item de carrito inválido." });
  }

  try {
    await ensureCartSchema();
    await pool.query(
      `UPDATE cart_items
          SET removed_at = now(),
              updated_at = now()
        WHERE user_id = $1
          AND design_id = $2::uuid
          AND product_id = $3::uuid
          AND removed_at IS NULL`,
      [req.user.id, designId, productId]
    );
    res.json(await fetchCart(req.user.id));
  } catch (err) {
    console.error("DELETE /cart/items/:key", err);
    res.status(500).json({ error: "No se pudo quitar el producto." });
  }
});

router.delete("/", requireAuth, async (req, res) => {
  try {
    await ensureCartSchema();
    await pool.query(
      `UPDATE cart_items
          SET removed_at = now(),
              updated_at = now()
        WHERE user_id = $1
          AND removed_at IS NULL`,
      [req.user.id]
    );
    res.json(await fetchCart(req.user.id));
  } catch (err) {
    console.error("DELETE /cart", err);
    res.status(500).json({ error: "No se pudo vaciar el carrito." });
  }
});

export default router;
