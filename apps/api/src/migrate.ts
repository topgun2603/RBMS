import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@srirealtime/db";

/**
 * Applies the SQL migrations in apps/api/drizzle without drizzle-kit (a dev dependency that isn't in the production
 * image). Same journal and bookkeeping table as `drizzle-kit migrate`, so the two are interchangeable. Run it as a
 * one-off task before rolling out a new API version, never on API boot (docs/deploy-aws.md):
 *
 *   node apps/api/dist/migrate.mjs            (production image; MIGRATIONS_DIR overrides the folder)
 *   pnpm --filter @srirealtime/api db:migrate (development: drizzle-kit)
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(2);
}
// src/migrate.ts and dist/migrate.mjs both sit one level below apps/api.
const folder = process.env.MIGRATIONS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const started = Date.now();
try {
  const n = await runMigrations(url, folder);
  console.log(`[migrate] up to date: ${n} migrations recorded (${Date.now() - started} ms)`);
} catch (err) {
  console.error(`[migrate] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
