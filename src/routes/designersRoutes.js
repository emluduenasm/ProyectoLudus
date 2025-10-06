// src/routes/designersRoutes.js
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * GET /api/designers/featured?limit=6
 * Devuelve los diseñadores ordenados por total de likes de sus diseños (desc),
 * con cantidad de diseños publicados y datos de avatar/nombre.
 */
router.get("/featured", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "6", 10), 24));
    const { rows } = await pool.query(`
      SELECT
        g.id AS designer_id,
        COALESCE(g.display_name, 'Anónimo') AS display_name,
        COALESCE(g.avatar_url, '/img/disenador1.jpg') AS avatar_url,
        COALESCE(COUNT(DISTINCT d.id), 0)::int AS designs_count,
        COALESCE(COUNT(l.user_id), 0)::int AS total_likes
      FROM designers g
      JOIN users u ON u.id = g.user_id
      LEFT JOIN designs d ON d.designer_id = g.id AND d.published = true
      LEFT JOIN design_likes l ON l.design_id = d.id
      GROUP BY g.id
      ORDER BY total_likes DESC, designs_count DESC, display_name ASC
      LIMIT $1;
    `, [limit]);

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron cargar los diseñadores destacados" });
  }
});

export default router;
