import type { FeatureGatePort, TenantRef } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import {
  createExportBilling,
  createGstinLookup,
  createRecurring,
  httpGstinProvider,
  type GstinLookupProvider,
  type InvoicesService,
  type LoggerPort,
} from "@srirealtime/invoices";
import type { Env } from "./env";

/** The scheduled job that makes the day's recurring bills (and retries failed ones). */
export const RECURRING_JOB = "invoices.recurring";
/** 06:15 and 14:15 IST: the morning run bills the day, the afternoon run retries what failed (plan limit raised ...). */
export const RECURRING_CRON = "15 6,14 * * *";

export interface RecurringWiring {
  db: Db;
  env: Env;
  invoices: InvoicesService;
  tenantRef: (tenantId: string) => Promise<TenantRef | null>;
  /** Units and list prices of bill lines (kit-pricing.ts `prepareLines`). */
  prepareLines: (tenantId: string, lines: unknown[], opts: { customerId?: string | null; date?: string | null }) => Promise<unknown[]>;
  /** The books' period lock, null when unlocked or the books are off. */
  lockedThrough: (tenantId: string) => Promise<string | null>;
  featureGate: FeatureGatePort;
  log: LoggerPort;
  now?: () => Date;
}

/**
 * The GSTIN lookup provider from env (docs/recurring-export-gstin.md), or null (offline only). Nothing is called at
 * start-up; the provider is only asked when a shop looks a GSTIN up.
 */
export function gstinProviderFromEnv(env: Env, log: LoggerPort): GstinLookupProvider | null {
  if (!env.GSTIN_LOOKUP_PROVIDER) return null;
  if (!env.GSTIN_LOOKUP_URL || !env.GSTIN_LOOKUP_URL.includes("{gstin}")) {
    log.warn({ provider: env.GSTIN_LOOKUP_PROVIDER }, "gstin lookup: GSTIN_LOOKUP_URL with {gstin} is missing; lookups stay offline");
    return null;
  }
  return httpGstinProvider({
    name: env.GSTIN_LOOKUP_PROVIDER,
    url: env.GSTIN_LOOKUP_URL,
    apiKey: env.GSTIN_LOOKUP_KEY ?? null,
    headerName: env.GSTIN_LOOKUP_HEADER ?? undefined,
  });
}

/**
 * Recurring invoices, the GSTIN lookup and the export-billing helpers (docs/recurring-export-gstin.md), over the
 * invoices service. The scheduler job is defined and scheduled by kit.ts.
 */
export function wireRecurringExport(w: RecurringWiring) {
  const recurring = createRecurring({
    db: w.db,
    invoices: w.invoices,
    tenant: w.tenantRef,
    lines: { prepare: (tenantId, lines, opts) => w.prepareLines(tenantId, lines, opts) },
    lockedThrough: w.lockedThrough,
    featureGate: w.featureGate,
    log: w.log,
    now: w.now,
  });
  const gstin = createGstinLookup({
    db: w.db,
    provider: gstinProviderFromEnv(w.env, w.log),
    config: { perHour: w.env.GSTIN_LOOKUP_PER_HOUR, perDay: w.env.GSTIN_LOOKUP_PER_DAY, cacheDays: w.env.GSTIN_LOOKUP_CACHE_DAYS },
    log: w.log,
    now: w.now,
  });
  const exportBilling = createExportBilling(w.invoices);
  return {
    recurring,
    gstin,
    modules: [recurring.module, gstin.module, exportBilling.module],
    runDue: async () => {
      const r = await recurring.service.runDue();
      w.log.info(r, "recurring invoices run");
    },
  };
}
