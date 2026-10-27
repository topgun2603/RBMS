import { sql } from "@srirealtime/db";
import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";

/**
 * Builds a shop's FIFO cost layers (if not yet) and reconciles the valuation and item-wise profit with the books
 * (docs/valuation-reports.md):
 *
 *   pnpm --filter @srirealtime/api exec tsx --env-file-if-exists=.env src/scripts/valuation-check.ts <tenant-slug> [from] [to]
 *
 * Checks: FIFO layers left = stock on hand per item and location; the valuation report's weighted-average total = the
 * books' stock value; item-profit net sales = the P&L's net sales; and how the cost of goods sold on the bills compares
 * with the P&L's periodic cost of goods (opening + purchases - closing). The books are posted for the check and removed
 * again (like accounting-check).
 */
const [slug, fromArg, toArg] = process.argv.slice(2);
const log = pino({ level: "warn" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

try {
  if (!slug) throw new Error("Usage: valuation-check <tenant-slug> [from] [to]");
  const tenant = await kit.tenancy.service.getBySlug(slug);
  if (!tenant) throw new Error(`No shop "${slug}"`);
  const costing = kit.inventory.service.costing;
  const t0 = Date.now();
  const built = await costing.build(tenant.id);
  console.log("layers", JSON.stringify(built), `${Date.now() - t0} ms`);
  const diff = await costing.layerCheck(tenant.id);
  console.log("layers vs stock: items that differ", diff.length, JSON.stringify(diff.slice(0, 5)));
  const today = new Date().toISOString().slice(0, 10);
  const from = fromArg ?? `${today.slice(0, 4)}-01-01`;
  const to = toArg ?? today;
  const val = await costing.valuation(tenant.id, { asOf: to });
  console.log("valuation", JSON.stringify(val.totals), "method", val.method, "mismatches", val.mismatches);
  const acct = kit.accounting.service;
  const before = await kit.db.execute(sql`select count(*)::int as n from acct_entries where tenant_id = ${tenant.id}`);
  const had = Number(((before as unknown as { rows?: { n: number }[] }).rows ?? (before as unknown as { n: number }[]))[0]?.n ?? 0);
  await acct.backfill(tenant.id, {});
  const bs = await acct.balanceSheet(tenant.id, { asOf: to });
  console.log(`books stock value ${bs.stockValue}  valuation(avg) ${val.totals.avgValue}  ${bs.stockValue === val.totals.value ? "OK" : "DIFF " + (bs.stockValue - val.totals.value)}`);
  const pl = await acct.profitLoss(tenant.id, { from, to });
  const sec = (k: string) => pl.sections.find((s) => s.key === k)?.total ?? 0;
  const p = await kit.valuation.profit(tenant.id, { from, to });
  console.log(`${from}..${to} P&L net sales ${sec("sales")}  item-profit net sales ${p.totals.netSales}  ${sec("sales") === p.totals.netSales ? "OK" : "DIFF " + (sec("sales") - p.totals.netSales)}`);
  console.log(`cost of goods: bills ${p.totals.cogs}  P&L periodic ${sec("cogs")}  difference ${sec("cogs") - p.totals.cogs} (stock adjustments, audits, opening stock, valuation estimate)`);
  console.log(`gross profit: bills ${p.totals.grossProfit}  P&L ${pl.grossProfit}; item-cost lines ${p.itemCostLines}, no-cost lines ${p.noCostLines}`);
  if (!had) await acct.wipe(tenant.id);
  console.log("total ms", Date.now() - t0);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await kit.stop();
}
