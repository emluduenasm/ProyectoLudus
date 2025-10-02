// src/db.js
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

// Crea tabla users si no existe
const bootstrap = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email CITEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'buyer', -- 'buyer' | 'designer' | 'admin'
      use_preference TEXT DEFAULT 'buy',  -- 'buy' | 'upload'
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // extensiones útiles (si tenés permisos)
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  } catch {}
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  } catch {}
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "citext";`);
  } catch {}
};

bootstrap().catch(err => {
  console.error("Error bootstrap DB:", err);
});
