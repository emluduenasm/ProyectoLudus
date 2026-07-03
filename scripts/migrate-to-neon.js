import fs from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";

const { Pool } = pg;

const mode = process.argv[2] || "check";
const shouldTruncate = process.argv.includes("--truncate-target");

const tables = [
  "personas",
  "users",
  "categories",
  "designers",
  "products",
  "designs",
  "user_addresses",
  "design_product_mockups",
  "design_likes",
  "orders",
  "order_items",
  "cart_items"
];

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([^#=\s][^=]*)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [
        key.trim(),
        value.trim().replace(/^['"]|['"]$/g, "")
      ])
  );
}

function makePool(env, label) {
  if (!env.DATABASE_URL) {
    throw new Error(`${label}: falta DATABASE_URL`);
  }
  return new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
  });
}

async function tableExists(pool, table) {
  const result = await pool.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function tableColumns(pool, table) {
  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map((row) => row.column_name);
}

async function tableCount(pool, table) {
  if (!(await tableExists(pool, table))) return null;
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)}`);
  return result.rows[0].count;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function printCounts(label, pool) {
  const current = await pool.query("SELECT current_database() AS db, current_user AS usr");
  console.log(`${label}: connected db=${current.rows[0].db} user=${current.rows[0].usr}`);
  for (const table of tables) {
    const count = await tableCount(pool, table);
    console.log(`${label}: ${table}=${count === null ? "missing" : count}`);
  }
}

async function truncateTarget(pool) {
  const existingTables = [];
  for (const table of tables) {
    if (await tableExists(pool, table)) existingTables.push(quoteIdent(table));
  }
  if (!existingTables.length) return;
  await pool.query(`TRUNCATE TABLE ${existingTables.join(", ")} RESTART IDENTITY CASCADE`);
}

async function copyTable(source, target, table) {
  if (!(await tableExists(source, table))) {
    console.log(`SKIP ${table}: no existe en origen`);
    return;
  }
  if (!(await tableExists(target, table))) {
    console.log(`SKIP ${table}: no existe en destino`);
    return;
  }

  const sourceColumns = await tableColumns(source, table);
  const targetColumns = new Set(await tableColumns(target, table));
  const columns = sourceColumns.filter((column) => targetColumns.has(column));
  if (!columns.length) {
    console.log(`SKIP ${table}: sin columnas comunes`);
    return;
  }

  const selectSql = `SELECT ${columns.map(quoteIdent).join(", ")} FROM ${quoteIdent(table)}`;
  const rows = (await source.query(selectSql)).rows;
  if (!rows.length) {
    console.log(`COPY ${table}: 0 filas`);
    return;
  }

  const columnSql = columns.map(quoteIdent).join(", ");
  let inserted = 0;
  for (const row of rows) {
    const values = columns.map((column) => row[column]);
    const params = values.map((_, index) => `$${index + 1}`).join(", ");
    await target.query(
      `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES (${params})`,
      values
    );
    inserted += 1;
  }
  console.log(`COPY ${table}: ${inserted} filas`);
}

async function main() {
  const targetEnv = parseEnv(fs.readFileSync(".env", "utf8"));
  const previousEnv = parseEnv(execFileSync("git", ["show", "HEAD:.env"], { encoding: "utf8" }));
  const sourceEnv = {
    DATABASE_URL: targetEnv.SOURCE_DATABASE_URL || previousEnv.DATABASE_URL,
    DATABASE_SSL: targetEnv.SOURCE_DATABASE_SSL || previousEnv.DATABASE_SSL
  };

  const source = makePool(sourceEnv, "SOURCE");
  const target = makePool(targetEnv, "TARGET");

  try {
    if (mode === "check") {
      await printCounts("SOURCE", source);
      await printCounts("TARGET", target);
      return;
    }

    if (mode !== "run") {
      throw new Error("Uso: node scripts/migrate-to-neon.js check | run [--truncate-target]");
    }

    await target.query("BEGIN");
    try {
      if (shouldTruncate) {
        console.log("TARGET: truncando tablas antes de migrar");
        await truncateTarget(target);
      }
      for (const table of tables) {
        await copyTable(source, target, table);
      }
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK").catch(() => {});
      throw error;
    }

    await printCounts("TARGET", target);
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
