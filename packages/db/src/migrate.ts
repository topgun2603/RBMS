import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies the drizzle SQL migrations in `folder` (the journal drizzle-kit generates). Same bookkeeping table as
 * `drizzle-kit migrate` (`drizzle.__drizzle_migrations`), so the two are interchangeable. Returns the number of
 * migrations recorded afterwards. Used by the production image, which has no drizzle-kit (apps/api/src/migrate.ts).
 */
export async function runMigrations(url: string, folder: string): Promise<number> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
    const rows = await client<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return rows[0]?.n ?? 0;
  } finally {
    await client.end({ timeout: 5 });
  }
}
