import { pino } from "pino";
import { E2eCleanup } from "../e2e-cleanup";
import { removeSignupShops } from "../e2e-signup-cleanup";
import { env } from "../env";
import { createKit } from "../kit";

/**
 * Removes what earlier end-to-end runs left in the demo shops (raja, kumar, anbu), identified by the scripts' markers
 * (see e2e-cleanup.ts). The seeded demo data stays. Idempotent; prints what it changed.
 *
 *   pnpm --filter @srirealtime/api cleanup:e2e-data            (or -- --dry-run to only count)
 *   pnpm --filter @srirealtime/api cleanup:e2e-data -- raja    (only some shops)
 *   pnpm --filter @srirealtime/api cleanup:e2e-data -- --prefix=smoke-   (only the throwaway shops with that prefix)
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slugs = args.filter((a) => !a.startsWith("--"));
const prefixes = args.filter((a) => a.startsWith("--prefix=")).map((a) => a.slice("--prefix=".length));
const SHOPS = slugs.length ? slugs : ["raja", "kumar", "anbu"];

const log = pino({ level: "warn" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

try {
  let problems = 0;
  for (const slug of prefixes.length ? [] : SHOPS) {
    const tenant = await kit.tenancy.service.getBySlug(slug);
    if (!tenant) {
      console.log(`${slug}: no such shop`);
      continue;
    }
    const job = new E2eCleanup(kit, tenant.id, log, dryRun);
    const summary = await job.run();
    const lines = Object.entries(summary);
    console.log(`\n${slug}${dryRun ? " (dry run)" : ""}: ${lines.length ? "" : "nothing to clean"}`);
    for (const [what, n] of lines) console.log(`  ${String(n).padStart(4)}  ${what}`);
    for (const p of job.problems) console.log(`  !  ${p}`);
    problems += job.problems.length;
  }
  // Batch 5: the throwaway shops the sign-up e2e steps and smoke runs create (e2e-su…, smoke-…) are deleted outright.
  if (!slugs.length) {
    const r = await removeSignupShops(kit, { dryRun, prefixes: prefixes.length ? prefixes : undefined });
    console.log(`\nthrowaway shops${dryRun ? " (dry run)" : ""}: ${r.shops.length ? r.shops.join(", ") : "none"}`);
    for (const [what, n] of Object.entries(r.summary)) console.log(`  ${String(n).padStart(4)}  ${what}`);
    for (const p of r.problems) console.log(`  !  ${p}`);
    problems += r.problems.length;
  }
  if (problems) process.exitCode = 1;
} catch (err) {
  log.error(err, "cleanup failed");
  process.exitCode = 1;
} finally {
  await kit.stop();
}
