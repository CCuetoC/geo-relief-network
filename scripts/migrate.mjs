import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED is required for schema migrations.");
}
if (new URL(connectionString).hostname.includes("-pooler")) {
  throw new Error("Use a direct Neon connection URL (without -pooler) for migrations.");
}

const pool = new Pool({ connectionString });
const client = await pool.connect();
const lockName = "geo-relief-network:migrations";
try {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS grn_schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    )
  `);

  const files = (await readdir(path.join(root, "migrations")))
    .filter((name) => /^\d{4}-[a-z0-9-]+\.sql$/i.test(name))
    .sort();

  for (const file of files) {
    const sql = await readFile(path.join(root, "migrations", file), "utf8");
    const version = file.slice(0, 4);
    const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
    const existing = await client.query(
      "SELECT checksum FROM grn_schema_migrations WHERE version = $1",
      [version],
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration ${file} was modified; migrations are immutable.`);
      }
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO grn_schema_migrations (version, checksum) VALUES ($1, $2)",
        [version, checksum],
      );
      await client.query("COMMIT");
      console.info(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined);
  client.release();
  await pool.end();
}
