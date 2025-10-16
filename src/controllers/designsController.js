import { pool } from "../db.js";
import fs from "fs";
import path from "path";

// --- Obtener diseño por ID ---
export async function getDesignById(req, res) {
  try {
    const { id } = req.params;
    const q = `
      SELECT
        d.id,
        d.title,
        d.description,
        d.image_url,
        d.thumbnail_url,
        d.created_at,
        u.name AS designer_name,
        COALESCE(COUNT(l.id), 0) AS likes
      FROM designs d
      JOIN users u ON d.designer_id = u.id
      LEFT JOIN design_likes l ON l.design_id = d.id
      WHERE d.id = $1
      GROUP BY d.id, u.name;
    `;
    const { rows } = await pool.query(q, [id]);

    if (!rows.length) {
      return res.status(404).json({ error: "Diseño no encontrado" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error getDesignById:", err);
    res.status(500).json({ error: "Error al obtener el diseño" });
  }
}
