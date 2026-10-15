import type { LegacyItemRow } from "@srirealtime/catalogue";
import { billingItems } from "@srirealtime/invoices";
import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";

/**
 * One-off, idempotent: copies every `billing_items` row (deleted ones too, as deleted products) into the catalogue as a
 * product with one default variant whose id is the old item id, so bills, stock and purchases keep pointing at it.
 * Re-running skips items already copied. `billing_items` itself is left untouched.
 *
 *   pnpm --filter @srirealtime/api migrate:items
 */
const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

const PAGE = 5_000;
const totals = { tenants: 0, rows: 0, created: 0, skipped: 0 };
let tenantId: string | null = null;
let batch: LegacyItemRow[] = [];

async function flush() {
  if (!tenantId || batch.length === 0) return;
  const result = await kit.catalogue.service.importLegacyItems(tenantId, batch);
  log.info({ tenantId, rows: batch.length, ...result }, "billing items copied to the catalogue");
  totals.tenants++;
  totals.rows += batch.length;
  totals.created += result.created;
  totals.skipped += result.skipped;
  batch = [];
}

try {
  // Ordered by tenant so each tenant's items arrive together and are imported in one call.
  for (let offset = 0; ; offset += PAGE) {
    const rows = await kit.db
      .select({
        id: billingItems.id,
        tenantId: billingItems.tenantId,
        name: billingItems.name,
        hsn: billingItems.hsn,
        unit: billingItems.unit,
        rate: billingItems.rate,
        gstRate: billingItems.gstRate,
        createdAt: billingItems.createdAt,
        deletedAt: billingItems.deletedAt,
      })
      .from(billingItems)
      .orderBy(billingItems.tenantId, billingItems.id)
      .limit(PAGE)
      .offset(offset);
    for (const { tenantId: rowTenant, ...row } of rows) {
      if (rowTenant !== tenantId) {
        await flush();
        tenantId = rowTenant;
      }
      batch.push(row);
    }
    if (rows.length < PAGE) break;
  }
  await flush();
  log.info(totals, "billing items migration finished");
} catch (err) {
  log.error(err, "billing items migration failed");
  process.exitCode = 1;
} finally {
  await kit.stop();
}
