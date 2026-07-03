// src/lib/orderService.js
import { pool } from "../db.js";

let schemaReady = false;

export async function ensureOrderSchema() {
  if (schemaReady) return;
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
    )
  `);
  await pool.query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS shipping_phone TEXT,
      ADD COLUMN IF NOT EXISTS shipping_country TEXT,
      ADD COLUMN IF NOT EXISTS shipping_province TEXT,
      ADD COLUMN IF NOT EXISTS shipping_city TEXT,
      ADD COLUMN IF NOT EXISTS shipping_street TEXT,
      ADD COLUMN IF NOT EXISTS shipping_street_number TEXT,
      ADD COLUMN IF NOT EXISTS shipping_floor_apartment TEXT,
      ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT,
      ADD COLUMN IF NOT EXISTS shipping_notes TEXT
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
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id)`
  );
  schemaReady = true;
}
