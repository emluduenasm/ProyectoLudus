// src/middleware/auth.js
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

/**
 * Valida que exista un Bearer token y adjunta el payload en req.user
 * (guardamos id y email en el token; el rol siempre se consulta a DB)
 */
export const requireAuth = (req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Falta token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET); // { id, email }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
};

/**
 * Verifica contra la DB que el usuario tenga alguno de los roles requeridos.
 * Siempre lee el rol actual desde la tabla users (evita problemas con tokens viejos).
 */
export const requireRole = (...roles) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
  try {
    const r = await pool.query(`SELECT role FROM users WHERE id=$1`, [req.user.id]);
    const role = r.rows[0]?.role || null;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    // por conveniencia adjuntamos el rol fresco
    req.user.role = role;
    next();
  } catch (e) {
    console.error("requireRole error", e);
    res.status(500).json({ error: "Error verificando rol" });
  }
};

// alias por compatibilidad
export const authRequired = requireAuth;
export default requireAuth;
