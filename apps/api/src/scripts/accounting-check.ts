import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";

/**
 * Posts a shop's history into the books, runs the reconciliation and prints the checks (docs/accounting.md). Meant for
 * development and for checking a shop before switching its books on:
 *
 *   pnpm --filter @rbms/api exec tsx --env-file-if-exists=.env src/scripts/accounting-check.ts <tenant-slug> [--wipe] [--keep]
 *
 * By default the shop's accounting rows are removed again afterwards (--keep leaves them; --wipe only removes them).
 */
const [slug, ...flags] = process.argv.slice(2);
const log = pino({ level: "warn" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

try {
  if (!slug) throw new Error("Usage: accounting-check <tenant-slug> [--wipe] [--keep]");
  const tenant = await kit.tenancy.service.getBySlug(slug);
  if (!tenant) throw new Error(`No shop "${slug}"`);
  const svc = kit.accounting.service;
  if (flags.includes("--wipe")) {
    await svc.wipe(tenant.id);
    console.log("wiped");
  } else {
    const t0 = Date.now();
    const first = await svc.backfill(tenant.id, {});
    console.log("backfill", JSON.stringify({ posted: first.posted, ms: first.ms, errors: first.errors.slice(0, 5), byType: first.byType }));
    const second = await svc.sync(tenant.id);
    console.log("second run", JSON.stringify({ posted: second.posted, reversed: second.reversed, unchanged: second.unchanged, ms: second.ms }));
    const rec = await svc.reconcile(tenant.id, {});
    for (const c of rec.checks) {
      console.log(`${c.ok ? "OK  " : "DIFF"} ${c.key.padEnd(14)} ledger=${c.ledger} source=${c.source} diff=${c.difference}${c.explained?.length ? ` explained=${JSON.stringify(c.explained)}` : ""}`);
    }
    for (const type of ["customer", "supplier"] as const) {
      const p = await svc.reconcileParties(tenant.id, { type });
      console.log(type, "party total", JSON.stringify(p.total), "rows with a difference:", p.items.filter((i) => i.difference !== 0).length);
      for (const i of p.items.filter((x) => x.difference !== 0).slice(0, 5)) console.log("  ", JSON.stringify(i));
    }
    const tb = await svc.trialBalance(tenant.id, {});
    const bs = await svc.balanceSheet(tenant.id, {});
    console.log("trial balance balanced:", tb.balanced, JSON.stringify(tb.totals));
    console.log("balance sheet balanced:", bs.balanced, "difference", bs.difference, "assets", bs.totalAssets, "profit", bs.profitToDate, "stock", bs.stockValue);
    console.log("total ms", Date.now() - t0);
    if (!flags.includes("--keep")) {
      await svc.wipe(tenant.id);
      console.log("accounting rows removed again");
    }
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await kit.stop();
}
