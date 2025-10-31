// src/lib/designerService.js
import { pool } from "../db.js";

export const DEFAULT_AVATAR = "/img/uploads/avatars/default.png";

function getDb(client) {
  if (client && typeof client.query === "function") return client;
  return pool;
}

export async function ensureDesigner(userId, client) {
  const db = getDb(client);
  const existing = await db.query(
    `SELECT id, user_id, display_name, avatar_url
     FROM designers
     WHERE user_id=$1
     LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const info = await db.query(
    `SELECT username, name FROM users WHERE id=$1`,
    [userId]
  );
  const display =
    info.rows[0]?.username ||
    info.rows[0]?.name ||
    `Designer-${String(userId).slice(0, 8)}`;

  const inserted = await db.query(
    `INSERT INTO designers (user_id, display_name, avatar_url)
     VALUES ($1,$2,$3)
     RETURNING id, user_id, display_name, avatar_url`,
    [userId, display, DEFAULT_AVATAR]
  );
  return inserted.rows[0];
}

export async function getDesignerByUser(userId, client) {
  const db = getDb(client);
  const existing = await db.query(
    `SELECT id, user_id, display_name, avatar_url
     FROM designers
     WHERE user_id=$1
     LIMIT 1`,
    [userId]
  );
  return existing.rows[0] || null;
}
