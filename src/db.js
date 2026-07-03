// src/db.js  (versión sin CITEXT)
import "dotenv/config";
import pg from "pg";
import { runMigrations } from "./db/migrations.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

const bootstrap = async () => {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  } catch {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'buyer',
      use_preference TEXT DEFAULT 'buy',
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS designers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      payout_alias TEXT,
      payout_cbu TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE designers
      ADD COLUMN IF NOT EXISTS payout_alias TEXT,
      ADD COLUMN IF NOT EXISTS payout_cbu TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS designs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      designer_id UUID NOT NULL REFERENCES designers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}',
      image_url TEXT NOT NULL,
      thumbnail_url TEXT,
      published BOOLEAN NOT NULL DEFAULT false,
      review_status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      image_url TEXT,
      published BOOLEAN NOT NULL DEFAULT false,
      curve_x_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      curve_y_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      curve_top_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      curve_bottom_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      curve_left_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      curve_right_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      mockup_config JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS products_published_idx ON products (published);
  `);

  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS mockup_config JSONB;
  `);
  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS curve_x_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS curve_y_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS curve_top_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS curve_bottom_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS curve_left_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS curve_right_pct NUMERIC(5,4) NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    UPDATE products
       SET mockup_config = jsonb_build_object(
         'width_pct', 0.45,
         'height_pct', 0.45,
         'top_pct', 0.5,
         'left_pct', 0.5,
         'curve_top_pct', 0,
         'curve_bottom_pct', 0,
         'curve_left_pct', 0,
         'curve_right_pct', 0,
         'curve_x_pct', 0,
         'curve_y_pct', 0,
         'blend', 'multiply'
       )
     WHERE mockup_config IS NULL;
  `);
  await pool.query(`
    UPDATE products
       SET curve_x_pct = COALESCE(
             (mockup_config->>'curve_x_pct')::numeric,
             (mockup_config->>'curve_left_pct')::numeric,
             curve_x_pct,
             0
           ),
           curve_y_pct = COALESCE(
             (mockup_config->>'curve_y_pct')::numeric,
             (mockup_config->>'curve_top_pct')::numeric,
             curve_y_pct,
             0
           ),
           curve_top_pct = COALESCE((mockup_config->>'curve_top_pct')::numeric, curve_top_pct, curve_y_pct, 0),
           curve_bottom_pct = COALESCE((mockup_config->>'curve_bottom_pct')::numeric, curve_bottom_pct, curve_y_pct, 0),
           curve_left_pct = COALESCE((mockup_config->>'curve_left_pct')::numeric, curve_left_pct, curve_x_pct, 0),
           curve_right_pct = COALESCE((mockup_config->>'curve_right_pct')::numeric, curve_right_pct, curve_x_pct, 0);
  `);
  await pool.query(`
    UPDATE products
       SET mockup_config = jsonb_set(
             jsonb_set(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(
                       COALESCE(mockup_config, '{}'::jsonb),
                       '{curve_left_pct}',
                       to_jsonb(curve_left_pct),
                       true
                     ),
                     '{curve_right_pct}',
                     to_jsonb(curve_right_pct),
                     true
                   ),
                   '{curve_top_pct}',
                   to_jsonb(curve_top_pct),
                   true
                 ),
                 '{curve_bottom_pct}',
                 to_jsonb(curve_bottom_pct),
                 true
               ),
               '{curve_x_pct}',
               to_jsonb(curve_x_pct),
               true
             ),
             '{curve_y_pct}',
             to_jsonb(curve_y_pct),
             true
           );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_product_mockups (
      design_id UUID REFERENCES designs(id) ON DELETE CASCADE,
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (design_id, product_id)
    );
  `);

  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_number TEXT NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      shipping_phone TEXT,
      shipping_country TEXT,
      shipping_province TEXT,
      shipping_city TEXT,
      shipping_street TEXT,
      shipping_street_number TEXT,
      shipping_floor_apartment TEXT,
      shipping_postal_code TEXT,
      shipping_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      design_id UUID NOT NULL REFERENCES designs(id) ON DELETE RESTRICT,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      designer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      design_title TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_likes (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      design_id UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, design_id)
    );
    CREATE INDEX IF NOT EXISTS idx_design_likes_design ON design_likes (design_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      design_id UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      added_count INTEGER NOT NULL DEFAULT 1 CHECK (added_count > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      first_added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      removed_at TIMESTAMPTZ,
      UNIQUE (user_id, design_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS cart_items_user_active_idx ON cart_items(user_id, removed_at);
    CREATE INDEX IF NOT EXISTS cart_items_updated_at_idx ON cart_items(updated_at);
  `);
};

const runSupplementalMigrations = async () => {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS personas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name TEXT NOT NULL,
      last_name  TEXT NOT NULL,
      dni        VARCHAR(20) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_addresses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'Principal',
      phone TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'Argentina',
      province TEXT NOT NULL,
      city TEXT NOT NULL,
      street TEXT NOT NULL,
      street_number TEXT NOT NULL,
      floor_apartment TEXT,
      postal_code TEXT NOT NULL,
      notes TEXT,
      is_default BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS user_addresses_user_id_idx ON user_addresses(user_id);
  `);
  await pool.query(`
    ALTER TABLE user_addresses
      ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'Principal',
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'Argentina',
      ADD COLUMN IF NOT EXISTS province TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS street TEXT,
      ADD COLUMN IF NOT EXISTS street_number TEXT,
      ADD COLUMN IF NOT EXISTS floor_apartment TEXT,
      ADD COLUMN IF NOT EXISTS postal_code TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    UPDATE user_addresses
       SET country = COALESCE(NULLIF(country, ''), 'Argentina'),
           label = COALESCE(NULLIF(label, ''), 'Principal'),
           is_default = COALESCE(is_default, TRUE),
           updated_at = COALESCE(updated_at, now());
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username   TEXT;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES personas(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS use_preference TEXT DEFAULT 'buy';
  `);
  await pool.query(`
    ALTER TABLE users ALTER COLUMN use_preference SET DEFAULT 'buy';
  `);
  await pool.query(`
    UPDATE users SET use_preference = COALESCE(use_preference, 'buy');
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE users ALTER COLUMN banned SET DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id);
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS published_backup BOOLEAN DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE designs
      ALTER COLUMN published SET DEFAULT FALSE;
  `);
};

try {
  await bootstrap();
  await runSupplementalMigrations();
  await runMigrations(pool);
} catch (err) {
  console.error("Error bootstrap DB:", err);
}
