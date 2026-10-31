import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";
import { parseBackfillArgs } from "./analytics-backfill-args";

/**
 * Recomputes the storefront analytics rollups from the raw events over a wider window than the hourly job's two days
 * (e.g. after the per-product purchase change, or a rollup bug fix). Idempotent. Raw events are kept for 90 days, so
 * older days cannot be rebuilt (the window is capped there).
 *
 *   pnpm --filter @rbms/api analytics:backfill                       # last 90 days, all shops
 *   pnpm --filter @rbms/api analytics:backfill --days 30 --tenant <tenant uuid>
 */
const log = pino({ level: "info" });

try {
  const args = parseBackfillArgs(process.argv.slice(2));
  const kit = createKit({ ...env, REDIS_URL: "memory" }, log);
  try {
    const result = await kit.analytics.service.rollup({ days: args.days, tenantId: args.tenantId });
    log.info({ ...result, from: result.dates[0], to: result.dates.at(-1) }, "analytics backfill finished");
  } finally {
    await kit.stop();
  }
} catch (err) {
  log.error(err, "analytics backfill failed");
  process.exitCode = 1;
}
