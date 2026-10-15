import { defineModule } from "@srirealtime/core";
import { EINVOICE_FEATURES, EINVOICE_PERMISSIONS } from "./features";
import { einvoiceRoutes } from "./routes";
import { einvoiceAccounts, einvoiceRecords } from "./schema";
import { EInvoiceService, type EInvoiceDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./features";
export * from "./gst";
export * from "./units";
export * from "./nic";
export * from "./ewb";
export * from "./gstr1";
export * from "./crypto";
export * from "./service";
export * from "./drivers/types";
export * from "./drivers/mock";
export * from "./drivers/gsp";
export { einvoiceRoutes } from "./routes";

/**
 * GST e-invoicing: NIC IRN generation / cancellation (schema 1.1) through a GSP or the mock provider, e-way bills
 * (from the IRN or standalone) and GSTR-1 JSON export. Bills come in through `InvoiceDataPort`; documents read
 * `service.irnFor(tenantId, invoiceId)` to print the IRN, Ack no and signed QR.
 */
export function createEInvoice(deps: EInvoiceDeps) {
  const service = new EInvoiceService(deps);
  const module = defineModule({
    id: "einvoice",
    tables: { einvoiceAccounts, einvoiceRecords },
    routes: einvoiceRoutes(service),
    features: EINVOICE_FEATURES,
    permissions: EINVOICE_PERMISSIONS,
  });
  return { service, module };
}
