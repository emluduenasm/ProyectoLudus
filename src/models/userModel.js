// src/models/userModel.js
import { pool } from "../db.js";

export const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

export const createUser = async ({ name, email, passwordHash, role, usePreference }) => {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, use_preference)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, email, role, use_preference, created_at`,
    [name, email, passwordHash, role || "buyer", usePreference || "buy"]
  );
  return rows[0];
};
