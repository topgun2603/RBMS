import type { FeatureGatePort } from "@rbms/core";
import type { Db } from "@rbms/db";
import { createSalesDocs, type InvoicesService, type SalesDocsDeps } from "@rbms/invoices";
import type { ChallanStockInput, InventoryService, ReserveInput } from "@rbms/inventory";

/** What the sales documents wiring needs from the host's services (structural, so kit.ts passes its own objects). */
export interface SalesDocsWiring {
  db: Db;
  invoices: InvoicesService;
  inventory: () => Pick<InventoryService, "applyChallan" | "reserve" | "release"> | undefined;
  features: { gate: FeatureGatePort; service: { isEnabled(tenantId: string, key: string): Promise<boolean> } };
  notify: {
    send(input: { tenantId: string; channel: "whatsapp" | "sms" | "email"; to: string; template: string; vars: Record<string, string>; locale?: string }): Promise<{ logId: string }>;
  };
  settings: { get(tenantId: string): Promise<Record<string, unknown>> };
  branding: { get(tenantId: string): Promise<{ appName: string | null; logoUrl: string | null; css: string }> };
  publicBaseUrl: (tenantId: string) => Promise<string>;
  branches?: SalesDocsDeps["branches"];
  now?: () => Date;
  log: SalesDocsDeps["log"];
}

/**
 * Proforma invoices, sale orders and delivery challans (docs/sales-documents.md): the invoices package's service, wired to
 * the shop's settings, WhatsApp / SMS / email (notify) and the inventory module (challan stock moves, sale order holds).
 * Stock only moves for shops with the inventory feature on; giving stock back (returns, cancel, release) stays
 * unconditional like bills (each step is idempotent).
 */
export function wireSalesDocs(w: SalesDocsWiring) {
  const stockOn = (tenantId: string) => w.features.service.isEnabled(tenantId, "inventory");
  return createSalesDocs({
    db: w.db,
    invoices: w.invoices,
    settings: { get: (tenantId) => w.settings.get(tenantId) },
    branding: w.branding,
    publicBaseUrl: w.publicBaseUrl,
    branches: w.branches,
    featureGate: w.features.gate,
    notifier: {
      send: async ({ tenantId, channel, to, template, vars, locale }) => ({
        logId: (await w.notify.send({ tenantId, channel, to, template, vars, locale })).logId,
      }),
    },
    stock: {
      applyChallan: async (tenantId, input) => {
        const inv = w.inventory();
        if (!inv) return null;
        if (input.step === "out" && !(await stockOn(tenantId))) return null;
        return inv.applyChallan(tenantId, input as ChallanStockInput);
      },
      reserve: async (tenantId, r) => {
        const inv = w.inventory();
        return inv && (await stockOn(tenantId)) ? inv.reserve(tenantId, r as ReserveInput, { allowBackorder: r.allowBackorder }) : null;
      },
      release: async (tenantId, refType, refId) => w.inventory()?.release(tenantId, refType, refId) ?? null,
    },
    now: w.now,
    log: w.log,
  });
}
