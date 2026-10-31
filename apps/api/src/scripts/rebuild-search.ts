import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";

/**
 * Backfill for catalogue search (docs/commerce-batch2.md §3): recomputes `catalog_products.search_text` for every
 * product of every tenant (the service maintains it on writes from now on). Idempotent; run once after the migration
 * that adds the column (and the pg_trgm extension).
 *
 *   pnpm --filter @rbms/api migrate:search
 */
const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

try {
  const result = await kit.catalogue.service.rebuildSearchText();
  log.info(result, "catalogue search text backfill finished");
} catch (err) {
  log.error(err, "catalogue search text backfill failed");
  process.exitCode = 1;
} finally {
  await kit.stop();
}
