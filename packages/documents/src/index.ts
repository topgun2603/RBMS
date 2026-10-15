import { defineModule, type FeatureDef, type SrModule } from "@srirealtime/core";
import { registerBuiltins } from "./builtins";
import { PuppeteerPdfDriver, type PdfDriver, type PuppeteerDriverOptions } from "./driver";
import { DocumentRegistry } from "./registry";
import { documentsRoutes } from "./routes";
import { DocumentsService } from "./service";
import { noopLogger, type BrandingPort, type InvoiceDocPort, type LoggerPort, type OrderDocPort, type PurchaseDocPort, type StatementDocPort } from "./types";

export interface DocumentsConfig extends Omit<PuppeteerDriverOptions, "log"> {}

export interface DocumentsDeps {
  config?: DocumentsConfig;
  /** Replace the puppeteer driver (Lambda/container renderer, tests). */
  driver?: PdfDriver;
  invoices?: InvoiceDocPort;
  statements?: StatementDocPort;
  orders?: OrderDocPort;
  purchases?: PurchaseDocPort;
  branding?: BrandingPort;
  log?: LoggerPort;
}

export const DOCUMENTS_FEATURES: FeatureDef[] = [
  {
    key: "documents",
    module: "documents",
    label: "PDF documents",
    description: "Download bills, receipts, statements, packing slips and labels as PDF (Tamil supported).",
  },
];

/**
 * Server-side PDFs. Built-in types are registered for every data port given; register more with
 * `service.registry.register(...)` **before** the host mounts the routes.
 */
export function createDocuments(deps: DocumentsDeps = {}) {
  const log = deps.log ?? noopLogger;
  const driver = deps.driver ?? new PuppeteerPdfDriver({ ...deps.config, log });
  const registry = new DocumentRegistry();
  registerBuiltins(registry, deps);
  const service = new DocumentsService(registry, {
    driver,
    branding: deps.branding,
    invoices: deps.invoices,
    log,
    timeoutMs: deps.config?.timeoutMs,
  });
  const module: SrModule = defineModule({
    id: "documents",
    routes: documentsRoutes(service),
    features: DOCUMENTS_FEATURES,
    stop: () => driver.close(),
  });
  return { service, registry, driver, module };
}

export { DocumentsService, DEFAULT_BRANDING, mergeBranding, type RenderedDocument } from "./service";
export { DocumentRegistry, safeFilename, type DocumentType, type LoadContext } from "./registry";
export { DOCUMENT_TYPE_FEATURES, registerBuiltins, type BuiltinPorts } from "./builtins";
export { PuppeteerPdfDriver, chromeCandidates, findChromeExecutable, type DetectOptions, type PdfDriver, type PuppeteerDriverOptions } from "./driver";
export { renderInvoice, renderInvoiceThermal } from "./renderers/invoice";
export { renderStatement } from "./renderers/statement";
export { renderPackingSlip, renderShippingLabel } from "./renderers/order";
export { renderPurchase } from "./renderers/purchase";
export { esc, page, qrSvg, money, fmtDate, stateLabel } from "./html";
export { fontFaceCss, FONT_STACK } from "./fonts";
export { labels, normalizeLocale, type Labels } from "./labels";
export { documentsRoutes } from "./routes";
export * from "./types";
