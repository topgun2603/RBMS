import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";

/**
 * Runs one background job right now in this process, e.g. after a deploy or from a test:
 *
 *   pnpm --filter @rbms/api job analytics.rollup
 */
const name = process.argv[2];
const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

try {
  if (!name) throw new Error("Usage: job <name>");
  await kit.runJob(name);
  log.info({ job: name }, "job finished");
} catch (err) {
  log.error(err, "job failed");
  process.exitCode = 1;
} finally {
  await kit.stop();
}
