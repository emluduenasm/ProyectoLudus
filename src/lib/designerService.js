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
    `SELECT d.id,
            d.user_id,
            d.display_name,
            d.avatar_url,
            u.username,
            u.name,
            u.email,
            u.avatar_url AS user_avatar_url
     FROM designers d
     JOIN users u ON u.id = d.user_id
     WHERE d.user_id=$1
     LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    const nextDisplay =
      row.display_name?.trim() ||
      row.username ||
      row.name ||
      row.email ||
      `Designer-${String(userId).slice(0, 8)}`;
    const nextAvatar = row.user_avatar_url || row.avatar_url || DEFAULT_AVATAR;
    if (row.display_name !== nextDisplay || row.avatar_url !== nextAvatar) {
      const synced = await db.query(
        `UPDATE designers
            SET display_name = $1,
                avatar_url = $2
          WHERE id = $3
        RETURNING id, user_id, display_name, avatar_url`,
        [nextDisplay, nextAvatar, row.id]
      );
      return synced.rows[0];
    }
    return {
      id: row.id,
      user_id: row.user_id,
      display_name: nextDisplay,
      avatar_url: nextAvatar
    };
  }

  const info = await db.query(
    `SELECT username, name, email, avatar_url FROM users WHERE id=$1`,
    [userId]
  );
  const display =
    info.rows[0]?.username ||
    info.rows[0]?.name ||
    info.rows[0]?.email ||
    `Designer-${String(userId).slice(0, 8)}`;
  const avatarUrl = info.rows[0]?.avatar_url || DEFAULT_AVATAR;

  const inserted = await db.query(
    `INSERT INTO designers (user_id, display_name, avatar_url)
     VALUES ($1,$2,$3)
     RETURNING id, user_id, display_name, avatar_url`,
    [userId, display, avatarUrl]
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
