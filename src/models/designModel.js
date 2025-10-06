import { pool } from "../db.js";

export const getFeaturedDesigns = async (limit = 6) => {
  const { rows } = await pool.query(
    `
    SELECT
      d.id,
      d.title,
      d.image_url,
      d.created_at::date AS created_at,
      COALESCE(u.name, 'Anónimo') AS designer_name,
      COUNT(l.user_id)::int AS likes
    FROM designs d
    JOIN designers g ON g.id = d.designer_id
    JOIN users u ON u.id = g.user_id
    LEFT JOIN design_likes l ON l.design_id = d.id
    WHERE d.published = true
    GROUP BY d.id, u.name
    ORDER BY likes DESC, d.created_at DESC
    LIMIT $1;
    `,
    [limit]
  );
  return rows;
};
