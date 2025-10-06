// src/controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { findUserByEmail, createUser } from "../models/userModel.js";
import { registerSchema, loginSchema } from "../validators/authSchemas.js";

const signToken = (user) =>
  jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

import { pool } from "../db.js"; // asegúrate de tenerlo importado

export const register = async (req, res) => {
  const client = await pool.connect();
  try {
    const data = registerSchema.parse(req.body);

    // Unicidad de email / username / dni
    const dupe = await pool.query(
      `SELECT
         MAX(CASE WHEN LOWER(u.email) = LOWER($1) THEN 1 ELSE 0 END) AS email_taken,
         MAX(CASE WHEN LOWER(u.username) = LOWER($2) THEN 1 ELSE 0 END) AS username_taken,
         MAX(CASE WHEN p.dni = $3 THEN 1 ELSE 0 END) AS dni_taken
       FROM users u
       FULL JOIN personas p ON p.id = u.persona_id`,
      [data.email, data.username, data.dni]
    );
    const flags = dupe.rows[0];
    if (flags.email_taken)    return res.status(409).json({ error: "El email ya está registrado." });
    if (flags.username_taken) return res.status(409).json({ error: "El alias ya está en uso." });
    if (flags.dni_taken)      return res.status(409).json({ error: "El DNI ya está registrado." });

    const passwordHash = await bcrypt.hash(data.password, 12);

    await client.query("BEGIN");

    const persona = await client.query(
      `INSERT INTO personas (first_name, last_name, dni)
       VALUES ($1,$2,$3)
       RETURNING id, first_name, last_name, dni`,
      [data.first_name.trim(), data.last_name.trim(), data.dni.trim()]
    );

    const user = await client.query(
      `INSERT INTO users (name, email, username, password_hash, role, use_preference, persona_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, email, username, role, use_preference, persona_id, created_at`,
      [
        `${data.first_name.trim()} ${data.last_name.trim()}`,
        data.email.toLowerCase(),
        data.username,
        passwordHash,
        data.role || "buyer",
        data.usePreference || "buy",
        persona.rows[0].id
      ]
    );

    await client.query("COMMIT");

    const token = signToken(user.rows[0]);
    res.status(201).json({ user: user.rows[0], token, persona: persona.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.issues) return res.status(400).json({ error: "Datos inválidos", details: err.issues });
    console.error(err);
    res.status(500).json({ error: "Error de servidor" });
  } finally {
    client.release();
  }
};


export const login = async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await findUserByEmail(data.email.toLowerCase());
    if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

    const ok = await bcrypt.compare(data.password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    const token = signToken(user);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        use_preference: user.use_preference
      },
      token
    });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ error: "Datos inválidos", details: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: "Error de servidor" });
  }
};

export const me = async (req, res) => {
  res.json({ user: req.user });
};
