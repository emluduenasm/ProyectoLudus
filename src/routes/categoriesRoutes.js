// src/routes/categoriesRoutes.js
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/categories  → categorías activas ordenadas por nombre
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug FROM categories WHERE active = TRUE ORDER BY name ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /categories", e);
    res.status(500).json({ error: "No se pudieron obtener las categorías" });
  }
});

export default router;
