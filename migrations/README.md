# SQL migrations

This directory is intentionally empty of SQL migrations during scaffolding. No database schema has been created or applied.

Future migrations must be ordered, versioned, immutable after application, and recorded in a Postgres migration registry. Use the direct/unpooled Neon connection for applying schema changes. The migration runner in `scripts/migrate.mjs` is a placeholder and does not connect to a database.
