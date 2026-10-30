import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";

/**
 * One-off, idempotent data migration for inventory locations: gives every tenant with legacy stock rows (no
 * location) a default "Main" location and moves those rows and movements to it. Safe while serving traffic.
 *
 *   pnpm --filter @rbms/api migrate:locations
 */
const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

try {
  const result = await kit.inventory.service.backfillLocations();
  log.info(result, "stock locations backfill finished");
} catch (err) {
  log.error(err, "stock locations backfill failed");
  process.exitCode = 1;
} finally {
  await kit.stop();
}
