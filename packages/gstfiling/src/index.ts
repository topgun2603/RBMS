import { defineModule } from "@rbms/core";
import { GST_FILING_PERMISSIONS } from "./features";
import { gstFilingRoutes } from "./routes";
import { gst2bImports, gst2bRows, gstAdjustments, gstAdvances, gstDocFlags, gstFilings, gstSettings, gstTaxPayments } from "./schema";
import { GstFilingService, type GstFilingDeps } from "./service";
import { Gstr2bService } from "./service-2b";

export * from "./schema";
export * from "./ports";
export * from "./features";
export * from "./config";
export * from "./util";
export * from "./itc";
export * from "./gstr3b";
export * from "./gstr1x";
export * from "./reco2b";
export * from "./composition";
export * from "./calendar";
export * from "./rcm-categories";
export { GstFilingService, parsePeriod, flagPatch, adjustmentInput, advanceInput, taxPaymentInput, filingInput } from "./service";
export type { GstFilingDeps, PeriodRef, FilingIssue, ItcRegisterRow } from "./service";
export { Gstr2bService } from "./service-2b";
export { gstFilingRoutes } from "./routes";

/**
 * GST filing depth for Indian shops: GSTR-3B (with ITC and reverse charge), the GSTR-1 tables the base export lacks,
 * GSTR-2B reconciliation from the downloaded file, composition (bill of supply, CMP-08, GSTR-4) and a filing calendar.
 * Reads bills, purchases and expenses through ports; writes only its own tables. Rules cited in docs/gst-filing.md.
 */
export function createGstFiling(deps: GstFilingDeps) {
  const service = new GstFilingService(deps);
  const reco = new Gstr2bService(service);
  const module = defineModule({
    id: "gstfiling",
    tables: { gstSettings, gstDocFlags, gstAdjustments, gst2bImports, gst2bRows, gstFilings, gstAdvances, gstTaxPayments },
    routes: gstFilingRoutes(service, reco),
    permissions: GST_FILING_PERMISSIONS,
  });
  return { service, reco, module };
}
