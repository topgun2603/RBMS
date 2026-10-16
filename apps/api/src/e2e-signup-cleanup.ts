import type { Kit } from "./kit";

/**
 * Shops end-to-end sign-ups create: every `e2e-…` slug except the seeded e2e shops (e2e-bill, e2e-store, e2e-lite),
 * e.g. the API's batch-5 script (`e2e-su…`) and the landing site's browser tests. They are throwaway:
 * `cleanup:e2e-data` deletes them with every row that references them (any table with a `tenant_id` column), then
 * the tenant.
 */
export const E2E_SIGNUP_SLUG_PREFIX = "e2e-";
export const SEEDED_E2E_SHOPS = new Set(["e2e-bill", "e2e-store", "e2e-lite"]);
const KEEP = SEEDED_E2E_SHOPS;

type Client = { unsafe(text: string, params?: unknown[]): Promise<Record<string, unknown>[]> };
const clientOf = (kit: Kit) => (kit.db as unknown as { $client: Client }).$client;

export async function removeSignupShops(kit: Kit, opts: { dryRun?: boolean } = {}) {
  const db = clientOf(kit);
  const shops = (await db.unsafe(`SELECT id, slug FROM tenants WHERE slug LIKE $1 ORDER BY created_at`, [`${E2E_SIGNUP_SLUG_PREFIX}%`])).filter(
    (r) => !KEEP.has(String(r.slug)),
  ) as { id: string; slug: string }[];
  const summary: Record<string, number> = {};
  if (shops.length === 0) return { shops: [] as string[], summary, problems: [] as string[] };
  if (opts.dryRun) return { shops: shops.map((s) => s.slug), summary: { "sign-up shops": shops.length }, problems: [] as string[] };

  const tables = (
    await db.unsafe(
      `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`,
    )
  ).map((r) => String(r.table_name));
  const ids = shops.map((s) => s.id);
  const problems: string[] = [];
  // Foreign keys between module tables: delete in passes until nothing is left (or nothing more can go).
  let pending = new Set(tables);
  for (let pass = 0; pass < 8 && pending.size; pass++) {
    const failed = new Set<string>();
    for (const table of pending) {
      try {
        const rows = await db.unsafe(`DELETE FROM "${table}" WHERE tenant_id = ANY($1::uuid[]) RETURNING 1`, [ids]);
        if (rows.length) summary[table] = (summary[table] ?? 0) + rows.length;
      } catch (err) {
        failed.add(table);
        if (pass === 7) problems.push(`${table}: ${(err as Error).message}`);
      }
    }
    if (failed.size === pending.size) {
      for (const t of failed) problems.push(`${t}: could not delete (foreign keys)`);
      break;
    }
    pending = failed;
  }
  try {
    const rows = await db.unsafe(`DELETE FROM tenants WHERE id = ANY($1::uuid[]) RETURNING 1`, [ids]);
    summary["sign-up shops"] = rows.length;
  } catch (err) {
    problems.push(`tenants: ${(err as Error).message}`);
  }
  kit.tenancy.service.invalidate();
  return { shops: shops.map((s) => s.slug), summary, problems };
}
