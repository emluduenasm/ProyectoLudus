// src/routes/designsRoutes.js
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

router.get("/featured", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "6", 10), 24));
    const { rows } = await pool.query(`
      SELECT
        d.id,
        d.title,
        d.image_url,
        d.created_at,
        COALESCE(u.name, 'Anónimo') AS designer_name,
        COUNT(l.user_id)::int AS likes
      FROM designs d
      JOIN designers g ON g.id = d.designer_id
      JOIN users u ON u.id = g.user_id
      LEFT JOIN design_likes l ON l.design_id = d.id
      WHERE d.published = true
      GROUP BY d.id, u.name
      ORDER BY likes DESC, d.created_at DESC
      LIMIT $1;
    `, [limit]);

    console.log(`[featured] rows=${rows.length}`);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar los diseños destacados" });
  }
});

// Ruta de peek para ver contadores rápidos
router.get("/debug/peek", async (req, res) => {
  try {
    const q = async (sql) => (await pool.query(sql)).rows[0].c;
    const users = await q(`SELECT COUNT(*)::int AS c FROM users`);
    const designers = await q(`SELECT COUNT(*)::int AS c FROM designers`);
    const designs = await q(`SELECT COUNT(*)::int AS c FROM designs WHERE published = true`);
    const likes = await q(`SELECT COUNT(*)::int AS c FROM design_likes`);
    res.json({ users, designers, designs, likes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "peek failed" });
  }
});

export default router;
