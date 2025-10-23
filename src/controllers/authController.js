import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { registerSchema, loginSchema } from "../validators/authSchemas.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, username: user.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

// Title Case con unicode
const titleCase = (s) =>
  s.trim()
   .toLowerCase()
   .replace(/(^|\s|['-])([\p{L}ÁÉÍÓÚáéíóúÑñÜü])/gu, (m, pre, ch) => pre + ch.toUpperCase());

export const register = async (req, res) => {
  const client = await pool.connect();
  try {
    const data = registerSchema.parse(req.body);

    const personaFirst = titleCase(data.first_name);
    const personaLast  = titleCase(data.last_name);
    const dniClean     = data.dni.replace(/\D/g, "");
    const emailNorm    = data.email.toLowerCase();
    const usernameNorm = data.username.trim();

    const role = data.usePreference === "upload" ? "designer" : "buyer";

    const dupe = await pool.query(
      `SELECT
         MAX(CASE WHEN LOWER(u.email) = LOWER($1) THEN 1 ELSE 0 END) AS email_taken,
         MAX(CASE WHEN LOWER(u.username) = LOWER($2) THEN 1 ELSE 0 END) AS username_taken,
         MAX(CASE WHEN p.dni = $3 THEN 1 ELSE 0 END) AS dni_taken
       FROM users u
       FULL JOIN personas p ON p.id = u.persona_id`,
      [emailNorm, usernameNorm, dniClean]
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
      [personaFirst, personaLast, dniClean]
    );

    const user = await client.query(
      `INSERT INTO users (name, email, username, password_hash, role, persona_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, email, username, role, persona_id, created_at`,
      [
        `${personaFirst} ${personaLast}`,
        emailNorm,
        usernameNorm,
        passwordHash,
        role,
        persona.rows[0].id
      ]
    );

    await client.query("COMMIT");

    const token = signToken(user.rows[0]);
    res.status(201).json({ user: user.rows[0], token, persona: persona.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
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
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
      [data.email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

    // NUEVO: bloqueado por baneo
    if (user.banned) {
      const reason = user.banned_reason || "Tu cuenta fue baneada por infringir las reglas.";
      return res.status(403).json({ error: reason });
    }

    const ok = await bcrypt.compare(data.password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    const token = signToken(user);
    res.json({ user: { id: user.id, email: user.email, username: user.username, role: user.role }, token });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ error: "Datos inválidos", details: err.issues });
    console.error(err);
    res.status(500).json({ error: "Error de servidor" });
  }
};


// NUEVO: perfil del usuario autenticado
export const me = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autorizado" });

    const { rows } = await pool.query(
      `SELECT id, email, username, role FROM users WHERE id = $1`,
      [userId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error de servidor" });
  }
};
