// src/routes/adminOrdersRoutes.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ensureOrderSchema } from "../lib/orderService.js";

const router = Router();
const onlyAdmin = [requireAuth, requireRole("admin")];

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

router.get("/", ...onlyAdmin, async (req, res) => {
  try {
    await ensureOrderSchema();
    const page = clampInt(req.query.page, 1, 1000, 1);
    const limit = clampInt(req.query.limit, 1, 100, 10);
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const offset = (page - 1) * limit;

    const filters = [];
    const params = [];
    let idx = 0;
    const push = (value) => {
      params.push(value);
      idx += 1;
      return `$${idx}`;
    };

    if (status) {
      const p = push(status);
      filters.push(`o.status = ${p}`);
    }
    if (q) {
      const p = push(`%${q}%`);
      filters.push(
        `(LOWER(o.order_number) LIKE ${p}
          OR LOWER(COALESCE(NULLIF(TRIM(u.name), ''), u.email)) LIKE ${p})`
      );
    }

    const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countQ = await pool.query(
      `SELECT COUNT(*)::int AS total FROM orders o ${whereSql}`,
      params
    );
    const total = countQ.rows[0]?.total ?? 0;

    const dataQ = await pool.query(
      `SELECT
         o.id,
         o.order_number,
         o.total_amount,
         o.status,
         o.created_at,
         u.id AS user_id,
         COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS user_name,
         u.email,
         COALESCE(SUM(oi.quantity), 0)::int AS total_quantity,
         COUNT(oi.id)::int AS lines
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${whereSql}
       GROUP BY o.id, u.id
       ORDER BY o.created_at DESC
       LIMIT $${idx + 1}
       OFFSET $${idx + 2}`,
      [...params, limit, offset]
    );

    res.json({
      page,
      limit,
      total,
      items: dataQ.rows.map((row) => ({
        id: row.id,
        order_number: row.order_number,
        total_amount: Number(row.total_amount ?? 0),
        status: row.status,
        created_at: row.created_at,
        total_quantity: row.total_quantity ?? 0,
        lines: row.lines ?? 0,
        buyer: {
          id: row.user_id,
          name: row.user_name,
          email: row.email
        }
      }))
    });
  } catch (error) {
    console.error("ADMIN orders list", error);
    res.status(500).json({ error: "No se pudo obtener la lista de pedidos." });
  }
});

router.get("/:id", ...onlyAdmin, async (req, res) => {
  try {
    await ensureOrderSchema();
    const { id } = req.params;
    const orderQ = await pool.query(
      `SELECT
         o.id,
         o.order_number,
         o.total_amount,
         o.status,
         o.created_at,
         o.shipping_phone,
         o.shipping_country,
         o.shipping_province,
         o.shipping_city,
         o.shipping_street,
         o.shipping_street_number,
         o.shipping_floor_apartment,
         o.shipping_postal_code,
         o.shipping_notes,
         u.id AS user_id,
         COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS user_name,
         u.email
       FROM orders o
       JOIN users u ON u.id = o.user_id
      WHERE o.id = $1`,
      [id]
    );
    if (!orderQ.rowCount) {
      return res.status(404).json({ error: "Pedido no encontrado." });
    }
    const itemsQ = await pool.query(
      `SELECT
         oi.id,
         oi.design_id,
         oi.design_title,
         oi.product_id,
         oi.product_name,
         oi.designer_user_id,
         du.email AS designer_email,
         COALESCE(NULLIF(TRIM(du.name), ''), du.email) AS designer_name,
         oi.quantity,
         oi.unit_price,
         oi.created_at
       FROM order_items oi
       JOIN users du ON du.id = oi.designer_user_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC`,
      [id]
    );

    res.json({
      ...orderQ.rows[0],
      items: itemsQ.rows.map((row) => ({
        id: row.id,
        design_id: row.design_id,
        design_title: row.design_title,
        product_id: row.product_id,
        product_name: row.product_name,
        designer_user_id: row.designer_user_id,
        designer_name: row.designer_name,
        designer_email: row.designer_email,
        quantity: row.quantity,
        unit_price: Number(row.unit_price ?? 0),
        created_at: row.created_at
      }))
    });
  } catch (error) {
    console.error("ADMIN order detail", error);
    res.status(500).json({ error: "No se pudo cargar el pedido." });
  }
});

export default router;
