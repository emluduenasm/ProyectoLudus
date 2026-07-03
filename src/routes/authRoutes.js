// src/routes/authRoutes.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";


const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const sign = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
const uploadsDir = path.join(process.cwd(), "public", "img", "uploads");
const avatarsDir = path.join(uploadsDir, "avatars");
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(avatarsDir, { recursive: true });
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg"];

const registerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_AVATAR_TYPES.includes(file.mimetype);
    cb(ok ? null : new Error("Formato no permitido (solo JPG o PNG)"), ok);
  }
});

const processAvatar = async (buffer, userId) => {
  const filename = `${userId}-${Date.now()}.jpg`;
  const filePath = path.join(avatarsDir, filename);
  const processed = await sharp(buffer)
    .resize({ width: 512, height: 512, fit: "cover" })
    .jpeg({ quality: 90 })
    .toBuffer();
  await fs.promises.writeFile(filePath, processed);
  return {
    url: `/img/uploads/avatars/${filename}`,
    diskPath: filePath
  };
};

const text = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const digits = (value, max = 40) => String(value ?? "").replace(/\D/g, "").slice(0, max);
const validPayoutAlias = (value) => /^[A-Za-z0-9._-]{6,30}$/.test(value);
const validPayoutCbu = (value) => /^\d{22}$/.test(value);
const ARG_PROVINCES = new Set([
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autonoma de Buenos Aires",
  "Cordoba",
  "Corrientes",
  "Entre Rios",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquen",
  "Rio Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucuman"
]);
const normalizePostalCodeAR = (value) => text(value, 12).toUpperCase().replace(/\s+/g, "");
const validPostalCodeAR = (value) => /^\d{4}$/.test(value) || /^[A-Z]\d{4}[A-Z]{3}$/.test(value);

/**
 * POST /api/auth/register
 * body: { name, username, email, password }
 */
router.post(
  "/register",
  (req, res, next) => {
    registerUpload.single("avatar")(req, res, (err) => {
      if (err) {
        return res
          .status(400)
          .json({ error: err?.message || "Imagen inválida (JPG/PNG, máx 2 MB)" });
      }
      next();
    });
  },
  async (req, res) => {
  const client = await pool.connect();
  let avatarPathOnDisk = null;
  try {
    const {
      first_name = "",
      last_name = "",
      dni = "",
      username = "",
      email = "",
      password = "",
      use_preference = "buy",
      phone = "",
      country = "Argentina",
      province = "",
      city = "",
      street = "",
      street_number = "",
      floor_apartment = "",
      postal_code = "",
      shipping_notes = "",
      payout_alias = "",
      payout_cbu = ""
    } = req.body || {};

    const fn = String(first_name).trim();
    const ln = String(last_name).trim();
    const dniClean = String(dni).replace(/\D/g, "");
    const uname = String(username).trim();
    const emailNorm = String(email).trim().toLowerCase();
    const usePrefNormalized = use_preference === "upload" ? "upload" : "buy";
    const wantsPayout = usePrefNormalized === "upload";
    const role = usePrefNormalized === "upload" ? "designer" : "buyer";
    const address = {
      phone: digits(phone, 10),
      country: text(country || "Argentina", 80),
      province: text(province, 80),
      city: text(city, 80),
      street: text(street, 120),
      street_number: text(street_number, 20),
      floor_apartment: text(floor_apartment, 80),
      postal_code: normalizePostalCodeAR(postal_code),
      notes: text(shipping_notes, 240)
    };
    const payoutAlias = text(payout_alias, 30);
    const payoutCbu = digits(payout_cbu, 22);

    // Validaciones mínimas y claras
    if (!emailNorm || !password) return res.status(400).json({ error: "Email y password requeridos" });
    if (!fn) return res.status(400).json({ error: "Nombres requeridos" });
    if (!ln) return res.status(400).json({ error: "Apellidos requeridos" });
    if (!/^\d{8}$/.test(dniClean)) return res.status(400).json({ error: "DNI inválido (8 dígitos)" });
    if (!req.file) return res.status(400).json({ error: "La foto de perfil es obligatoria." });
    if (address.phone.length !== 10) return res.status(400).json({ error: "Telefono argentino invalido: debe tener 10 digitos" });
    if (!address.country || !address.province || !address.city || !address.street || !address.street_number || !address.postal_code) {
      return res.status(400).json({ error: "Completa la direccion de contacto y facturacion" });
    }
    if (address.country !== "Argentina") return res.status(400).json({ error: "Por ahora solo se admiten direcciones de Argentina" });
    if (!ARG_PROVINCES.has(address.province)) return res.status(400).json({ error: "Provincia invalida" });
    if (!validPostalCodeAR(address.postal_code)) return res.status(400).json({ error: "Codigo postal invalido" });
    if (wantsPayout) {
      if (!payoutAlias && !payoutCbu) {
        return res.status(400).json({ error: "Carga alias o CBU/CVU para cobrar comisiones" });
      }
      if (payoutAlias && !validPayoutAlias(payoutAlias)) {
        return res.status(400).json({ error: "Alias de cobro invalido" });
      }
      if (payoutCbu && !validPayoutCbu(payoutCbu)) {
        return res.status(400).json({ error: "CBU/CVU invalido (22 digitos)" });
      }
    }

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

    await client.query("BEGIN");

    const persona = await client.query(
      `INSERT INTO personas (first_name, last_name, dni)
       VALUES ($1,$2,$3)
       RETURNING id, first_name, last_name, dni`,
      [fn, ln, dniClean]
    );

    const hash = await bcrypt.hash(password, 12);
    const user = await client.query(
      `INSERT INTO users (id, name, username, email, password_hash, role, persona_id, use_preference)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, username, role, persona_id, use_preference, created_at`,
      [
        `${fn} ${ln}`.trim(),
        uname,
        emailNorm,
        hash,
        role,
        persona.rows[0].id,
        usePrefNormalized
      ]
    );
    const userId = user.rows[0].id;
    const avatar = await processAvatar(req.file.buffer, userId);
    avatarPathOnDisk = avatar.diskPath;
    await client.query(
      `UPDATE users SET avatar_url=$1 WHERE id=$2`,
      [avatar.url, userId]
    );
    await client.query(
      `INSERT INTO user_addresses (
         user_id,
         phone,
         country,
         province,
         city,
         street,
         street_number,
         floor_apartment,
         postal_code,
         notes,
         is_default
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)`,
      [
        userId,
        address.phone,
        address.country,
        address.province,
        address.city,
        address.street,
        address.street_number,
        address.floor_apartment || null,
        address.postal_code,
        address.notes || null
      ]
    );
    if (role === "designer") {
      const displayName = uname || `${fn} ${ln}`.trim() || emailNorm;
      await client.query(
        `INSERT INTO designers (user_id, display_name, avatar_url, payout_alias, payout_cbu)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id)
         DO UPDATE SET avatar_url = EXCLUDED.avatar_url,
                       payout_alias = EXCLUDED.payout_alias,
                       payout_cbu = EXCLUDED.payout_cbu,
                       display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), designers.display_name)`,
        [userId, displayName || "Diseñador", avatar.url, payoutAlias || null, payoutCbu || null]
      );
    }

    await client.query("COMMIT");

    const token = sign({ id: user.rows[0].id, email: user.rows[0].email });
    res.status(201).json({
      token,
      user: { ...user.rows[0], avatar_url: avatar.url },
      persona: persona.rows[0]
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(()=>{});
    if (avatarPathOnDisk) {
      fs.promises.unlink(avatarPathOnDisk).catch(() => {});
    }
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
      `SELECT id, email, username, name, role, use_preference, avatar_url FROM users WHERE id=$1 LIMIT 1`,
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
