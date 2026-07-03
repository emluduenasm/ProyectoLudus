import { pool } from "../db.js";

let schemaReady = false;

export async function ensureCartSchema() {
  if (schemaReady) return;
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
    )
  `);
  await pool.query(`
    ALTER TABLE cart_items
      ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS added_count INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS first_added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS last_added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS cart_items_user_active_idx ON cart_items(user_id, removed_at)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS cart_items_updated_at_idx ON cart_items(updated_at)`
  );
  schemaReady = true;
}
