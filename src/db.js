// src/db.js  (versión sin CITEXT)
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

const bootstrap = async () => {
  // === 1) Extensiones necesarias (solo pgcrypto, NO citext) ===
  // gen_random_uuid() viene de pgcrypto
  try { await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`); } catch {}

  // === 2) Tablas base ===
  // USERS: email como TEXT (no CITEXT) + índice único case-insensitive
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'buyer',      -- 'buyer' | 'designer' | 'admin'
      use_preference TEXT DEFAULT 'buy',       -- 'buy' | 'upload'
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
  `);

  // DESIGNERS (1–1 con user)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS designers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // DESIGNS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS designs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      designer_id UUID NOT NULL REFERENCES designers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,           -- ej: /img/diseno1.jpg
      thumbnail_url TEXT,
      published BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

    // columnas adicionales que pudieron faltar en instalaciones anteriores
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending';
  `);
  await pool.query(`
    UPDATE designs
      SET review_status = CASE
        WHEN published = TRUE THEN 'approved'
        ELSE COALESCE(review_status, 'pending')
      END;
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);


  // LIKES (PK compuesta)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_likes (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      design_id UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, design_id)
    );
    CREATE INDEX IF NOT EXISTS idx_design_likes_design ON design_likes (design_id);
  `);
};

// 1) Extensiones (ya las tenías)
await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

// 2) Identidad legal
await pool.query(`
  CREATE TABLE IF NOT EXISTS personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name  TEXT NOT NULL,
    dni        VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);

// 3) Users (añadimos username y FK a persona)
await pool.query(`
  -- Aseguramos columnas nuevas sin romper datos previos
  ALTER TABLE users ADD COLUMN IF NOT EXISTS username   TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES personas(id) ON DELETE SET NULL;

  -- Unicidad case-insensitive para username (opcional pero recomendado)
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
  ALTER TABLE users ADD COLUMN IF NOT EXISTS use_preference TEXT DEFAULT 'buy';
  ALTER TABLE users ALTER COLUMN use_preference SET DEFAULT 'buy';
  UPDATE users SET use_preference = COALESCE(use_preference, 'buy');
`);


bootstrap().catch(err => {
  console.error("Error bootstrap DB:", err);
});
