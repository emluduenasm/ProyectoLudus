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
  const client = await pool.connect();
  try {
    const {
      first_name = "",
      last_name = "",
      dni = "",
      username = "",
      email = "",
      password = "",
      use_preference = "buy"
    } = req.body || {};

    const fn = String(first_name).trim();
    const ln = String(last_name).trim();
    const dniClean = String(dni).replace(/\D/g, "");
    const uname = String(username).trim();
    const emailNorm = String(email).trim().toLowerCase();

    // Validaciones mínimas y claras
    if (!emailNorm || !password) return res.status(400).json({ error: "Email y password requeridos" });
    if (!fn) return res.status(400).json({ error: "Nombres requeridos" });
    if (!ln) return res.status(400).json({ error: "Apellidos requeridos" });
    if (!/^\d{8}$/.test(dniClean)) return res.status(400).json({ error: "DNI inválido (8 dígitos)" });

    // Duplicados
    const dupe = await pool.query(
      `SELECT
         MAX(CASE WHEN LOWER(u.email)=LOWER($1) THEN 1 ELSE 0 END) AS email_taken,
         MAX(CASE WHEN LOWER(u.username)=LOWER($2) THEN 1 ELSE 0 END) AS username_taken,
         MAX(CASE WHEN p.dni = $3 THEN 1 ELSE 0 END) AS dni_taken
       FROM users u
       FULL JOIN personas p ON p.id = u.persona_id`,
      [emailNorm, uname, dniClean]
    );
    const flags = dupe.rows[0] || {};
    if (flags.email_taken)    return res.status(409).json({ error: "El email ya está registrado" });
    if (flags.username_taken) return res.status(409).json({ error: "El alias ya está en uso" });
    if (flags.dni_taken)      return res.status(409).json({ error: "El DNI ya está registrado" });

    const role = (use_preference === "upload") ? "designer" : "buyer";

    await client.query("BEGIN");

    const persona = await client.query(
      `INSERT INTO personas (first_name, last_name, dni)
       VALUES ($1,$2,$3)
       RETURNING id, first_name, last_name, dni`,
      [fn, ln, dniClean]
    );

    const hash = await bcrypt.hash(password, 12);
    const user = await client.query(
      `INSERT INTO users (id, name, username, email, password_hash, role, persona_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       RETURNING id, email, username, role, persona_id, created_at`,
      [
        `${fn} ${ln}`.trim(),
        uname,
        emailNorm,
        hash,
        role,
        persona.rows[0].id
      ]
    );

    await client.query("COMMIT");

    const token = sign({ id: user.rows[0].id, email: user.rows[0].email });
    res.status(201).json({ token, user: user.rows[0], persona: persona.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK").catch(()=>{});
    console.error("register", e);
    res.status(500).json({ error: "No se pudo registrar" });
  } finally {
    client.release();
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
