import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "migrations");

export async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const applied = await pool.query(
      `SELECT 1 FROM schema_migrations WHERE filename = $1 LIMIT 1`,
      [filename]
    );
    if (applied.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT
           set_config('app.seed_admin_password', $1, true),
           set_config('app.seed_designer_password', $2, true)`,
        [
          process.env.SEED_ADMIN_PASSWORD || "admin1234",
          process.env.SEED_DESIGNER_PASSWORD || "designer123"
        ]
      );
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [filename]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
