// src/routes/ordersRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureOrderSchema } from "../lib/orderService.js";

const router = Router();

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const cleaned = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;
    const designId = String(entry.design_id || entry.designId || "").trim();
    const productId = String(entry.product_id || entry.productId || "").trim();
    const quantity = Number.parseInt(entry.quantity, 10);
    if (!designId || !productId) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    cleaned.push({
      design_id: designId,
      product_id: productId,
      quantity
    });
  }
  return cleaned;
}

const clampInt = (value, min, max, fallback) => {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

function makeOrderNumber() {
  const base = new Date();
  const datePart = base.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LUD-${datePart}-${random}`;
}

router.post("/", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const items = normalizeItems(req.body?.items);
  if (!items.length) {
    return res.status(400).json({ error: "No se enviaron productos válidos." });
  }
  try {
    await ensureOrderSchema();
  } catch (schemaErr) {
    console.error("orders schema error", schemaErr);
    return res.status(500).json({ error: "No se pudo preparar el registro de pedidos." });
  }

  const designIds = [...new Set(items.map((item) => item.design_id))];
  const productIds = [...new Set(items.map((item) => item.product_id))];

  try {
    const client = await pool.connect();
    try {
      const designsQ = await client.query(
        `SELECT d.id,
                d.title,
                d.published,
                COALESCE(d.review_status, CASE WHEN d.published = TRUE THEN 'approved' ELSE 'pending' END) AS review_status,
                u.id AS designer_user_id
           FROM designs d
           JOIN designers g ON g.id = d.designer_id
           JOIN users u ON u.id = g.user_id
          WHERE d.id = ANY($1::uuid[])`,
        [designIds]
      );
      const productsQ = await client.query(
        `SELECT id, name, price, published
           FROM products
          WHERE id = ANY($1::uuid[])`,
        [productIds]
      );
      const addressQ = await client.query(
        `SELECT phone,
                country,
                province,
                city,
                street,
                street_number,
                floor_apartment,
                postal_code,
                notes
           FROM user_addresses
          WHERE user_id = $1
          ORDER BY is_default DESC, created_at DESC
          LIMIT 1`,
        [userId]
      );
      const shipping = addressQ.rows[0];
      if (!shipping) {
        return res
          .status(400)
          .json({ error: "Completa tus datos de envio antes de finalizar la compra." });
      }

      const designMap = new Map(designsQ.rows.map((row) => [String(row.id), row]));
      const productMap = new Map(productsQ.rows.map((row) => [String(row.id), row]));

      const lines = [];
      for (const entry of items) {
        const design = designMap.get(entry.design_id);
        if (!design) {
          return res.status(400).json({ error: "Diseño no válido en el pedido." });
        }
        const reviewOk =
          design.review_status === "approved" || design.published === true;
        if (!reviewOk) {
          return res
            .status(400)
            .json({ error: `El diseño "${design.title}" no está disponible.` });
        }

        const product = productMap.get(entry.product_id);
        if (!product || product.published !== true) {
          return res
            .status(400)
            .json({ error: "Alguno de los productos no está disponible." });
        }
        const unitPrice = Number(product.price ?? 0);
        lines.push({
          design_id: entry.design_id,
          design_title: design.title,
          designer_user_id: design.designer_user_id,
          product_id: entry.product_id,
          product_name: product.name,
          quantity: entry.quantity,
          unit_price: unitPrice
        });
      }

      const totalAmount = lines.reduce(
        (sum, line) => sum + line.unit_price * line.quantity,
        0
      );
      if (totalAmount <= 0) {
        return res.status(400).json({ error: "El total del pedido es inválido." });
      }

      await client.query("BEGIN");
      const orderInsert = await client.query(
        `INSERT INTO orders (
           order_number,
           user_id,
           total_amount,
           status,
           shipping_phone,
           shipping_country,
           shipping_province,
           shipping_city,
           shipping_street,
           shipping_street_number,
           shipping_floor_apartment,
           shipping_postal_code,
           shipping_notes
         )
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, order_number, total_amount, status, created_at`,
        [
          makeOrderNumber(),
          userId,
          totalAmount,
          shipping.phone,
          shipping.country,
          shipping.province,
          shipping.city,
          shipping.street,
          shipping.street_number,
          shipping.floor_apartment,
          shipping.postal_code,
          shipping.notes
        ]
      );
      const order = orderInsert.rows[0];

      const insertValues = [];
      const params = [];
      let paramIndex = 1;
      for (const line of lines) {
        params.push(
          order.id,
          line.design_id,
          line.product_id,
          line.designer_user_id,
          line.design_title,
          line.product_name,
          line.quantity,
          line.unit_price
        );
        insertValues.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`
        );
        paramIndex += 8;
      }
      await client.query(
        `INSERT INTO order_items (
           order_id,
           design_id,
           product_id,
           designer_user_id,
           design_title,
           product_name,
           quantity,
           unit_price
         ) VALUES ${insertValues.join(", ")}`,
        params
      );
      await client.query("COMMIT");

      res.status(201).json({
        order: {
          ...order,
          items: lines.map((line) => ({
            design_id: line.design_id,
            design_title: line.design_title,
            designer_user_id: line.designer_user_id,
            product_id: line.product_id,
            product_name: line.product_name,
            quantity: line.quantity,
            unit_price: line.unit_price
          }))
        }
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("POST /orders", err);
      res
        .status(500)
        .json({ error: "No se pudo registrar el pedido.", detail: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /orders connect", err);
    res.status(500).json({ error: "Error de servidor al crear el pedido." });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    await ensureOrderSchema();
    const userId = req.user.id;
    const page = clampInt(req.query.page, 1, 1000, 1);
    const limit = clampInt(req.query.limit, 1, 50, 10);
    const offset = (page - 1) * limit;

    const base = await pool.query(
      `SELECT COUNT(*)::int AS total FROM orders WHERE user_id = $1`,
      [userId]
    );
    const total = base.rows[0]?.total ?? 0;

    const ordersQ = await pool.query(
      `SELECT
         o.id,
         o.order_number,
         o.total_amount,
         o.status,
         o.created_at
       FROM orders o
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const orderIds = ordersQ.rows.map((row) => row.id);
    let itemMap = new Map();
    if (orderIds.length) {
      const itemsQ = await pool.query(
        `SELECT
           oi.order_id,
           oi.product_name,
           oi.design_title,
           oi.quantity,
           oi.unit_price
         FROM order_items oi
        WHERE oi.order_id = ANY($1::uuid[])
        ORDER BY oi.created_at ASC`,
        [orderIds]
      );
      itemMap = itemsQ.rows.reduce((map, row) => {
        const list = map.get(row.order_id) || [];
        list.push({
          product_name: row.product_name,
          design_title: row.design_title,
          quantity: row.quantity,
          unit_price: Number(row.unit_price ?? 0),
          line_total: Number(row.unit_price ?? 0) * row.quantity
        });
        map.set(row.order_id, list);
        return map;
      }, new Map());
    }

    const items = ordersQ.rows.map((order) => ({
      id: order.id,
      order_number: order.order_number,
      total_amount: Number(order.total_amount ?? 0),
      status: order.status,
      created_at: order.created_at,
      items: itemMap.get(order.id) || []
    }));

    res.json({ page, limit, total, items });
  } catch (err) {
    console.error("GET /orders/mine", err);
    res.status(500).json({ error: "No se pudieron cargar tus compras." });
  }
});

export default router;
