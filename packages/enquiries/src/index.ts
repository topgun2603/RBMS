import { defineModule } from "@rbms/core";
import { ENQUIRIES_FEATURES, ENQUIRIES_PERMISSIONS } from "./ports";
import { enquiriesRoutes } from "./routes";
import { enquiries } from "./schema";
import { EnquiriesService, type EnquiriesDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export { EnquiriesService, ENQUIRY_SORT, enquiryListQuery, enquiryPatch, publicEnquiryInput } from "./service";
export type { EnquiriesDeps, EnquiriesSummary, EnquiryListQuery, EnquiryView, PublicEnquiryInput } from "./service";
export { enquiriesRoutes } from "./routes";

/**
 * Enquiries sent from the shop's website: the CMS `enquiry-form` section / page block posts here (admissions for a
 * school, call backs for any shop). Staff follow them up (status, note); owners get an alert per new enquiry.
 */
export function createEnquiries(deps: EnquiriesDeps) {
  const service = new EnquiriesService(deps);
  const module = defineModule({
    id: "enquiries",
    tables: { enquiries },
    routes: enquiriesRoutes(service),
    features: ENQUIRIES_FEATURES,
    permissions: ENQUIRIES_PERMISSIONS,
  });
  return { service, module };
}
