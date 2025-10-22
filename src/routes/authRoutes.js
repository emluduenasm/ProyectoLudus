// src/routes/authRoutes.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const sign = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

/**
 * POST /api/auth/register
 * body: { name, username, email, password }
 */
router.post("/register", async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email y password requeridos" });

    const exists = await pool.query(`SELECT 1 FROM users WHERE LOWER(email)=LOWER($1)`, [email]);
    if (exists.rowCount) return res.status(409).json({ error: "Email ya registrado" });

    const hash = await bcrypt.hash(password, 10);
    const ins = await pool.query(
      `INSERT INTO users (id, name, username, email, password_hash, role)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'designer')
       RETURNING id, email`,
      [name || "", username || "", email, hash]
    );

    const token = sign({ id: ins.rows[0].id, email: ins.rows[0].email });
    res.json({ token });
  } catch (e) {
    console.error("register", e);
    res.status(500).json({ error: "No se pudo registrar" });
  }
});

/**
 * POST /api/auth/login
 * body: { email, password }
 * Devuelve token con { id, email } (el rol siempre se obtiene desde DB)
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const u = await pool.query(
      `SELECT id, email, password_hash FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
      [email]
    );
    if (!u.rowCount) return res.status(401).json({ error: "Credenciales inválidas" });

    const ok = await bcrypt.compare(password, u.rows[0].password_hash || "");
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    const token = sign({ id: u.rows[0].id, email: u.rows[0].email });
    res.json({ token });
  } catch (e) {
    console.error("login", e);
    res.status(500).json({ error: "No se pudo iniciar sesión" });
  }
});

/**
 * GET /api/auth/me
 * Devuelve el usuario actual SIEMPRE desde la DB (rol actualizado)
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, email, username, name, role FROM users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(r.rows[0]);
  } catch (e) {
    console.error("me", e);
    res.status(500).json({ error: "Error al obtener perfil" });
  }
});

/**
 * GET /api/auth/check
 * Query: ?email=...&dni=...&username=...
 * Responde: { email_taken: boolean, dni_taken: boolean, username_taken: boolean }
 */
router.get("/check", async (req, res) => {
  try {
    const emailNorm    = (req.query.email || "").trim().toLowerCase();
    const usernameNorm = (req.query.username || "").trim();
    const dniClean     = (req.query.dni || "").toString().replace(/\D/g, "");

    const out = { email_taken: false, dni_taken: false, username_taken: false };

    if (emailNorm) {
      const r = await pool.query(
        `SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
        [emailNorm]
      );
      out.email_taken = !!r.rowCount;
    }

    if (usernameNorm) {
      const r = await pool.query(
        `SELECT 1 FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
        [usernameNorm]
      );
      out.username_taken = !!r.rowCount;
    }

    if (dniClean) {
      // Tu base ya usa "personas" (según tu controlador). Consultamos ahí.
      const r = await pool.query(
        `SELECT 1 FROM personas WHERE dni=$1 LIMIT 1`,
        [dniClean]
      );
      out.dni_taken = !!r.rowCount;
    }

    res.json(out);
  } catch (e) {
    console.error("auth/check", e);
    res.status(500).json({ error: "No se pudo verificar" });
  }
});


export default router;
