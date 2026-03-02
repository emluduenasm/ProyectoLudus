// src/models/userModel.js
import { pool } from "../db.js";

export const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

export const createUser = async ({ name, email, passwordHash, role, usePreference, avatarUrl }) => {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, use_preference, avatar_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name, email, role, use_preference, avatar_url, created_at`,
    [name, email, passwordHash, role || "buyer", usePreference || "buy", avatarUrl || null]
  );
  return rows[0];
};
