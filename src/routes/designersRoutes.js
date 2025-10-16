// src/routes/designersRoutes.js
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * Diseñadores destacados por suma de likes de sus diseños publicados.
 * Devuelve: id, name (display_name/username/name), avatar_url, likes
 */
router.get("/featured", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id,
              COALESCE(NULLIF(TRIM(g.display_name), ''), u.username, u.name, 'Anónimo') AS name,
              COALESCE(NULLIF(TRIM(g.avatar_url), ''), '/img/disenador1.jpg')           AS avatar_url,
              COALESCE(SUM(lc.cnt), 0)::int                                            AS likes
       FROM designers g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN (
         SELECT d.designer_id, COUNT(l.user_id) AS cnt
         FROM designs d
         LEFT JOIN design_likes l ON l.design_id = d.id
         WHERE d.published = TRUE
         GROUP BY d.designer_id, d.id
       ) lc ON lc.designer_id = g.id
       GROUP BY g.id, u.username, u.name
       ORDER BY likes DESC, name ASC
       LIMIT 12`
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /designers/featured", e);
    res.status(500).json({ error: "No se pudieron cargar los diseñadores destacados" });
  }
});

export default router;
