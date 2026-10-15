import { defineModule } from "@srirealtime/core";
import { SUPPORT_FEATURES, SUPPORT_PERMISSIONS } from "./features";
import { supportRoutes } from "./routes";
import { faqArticles, faqCategories, supportMessages, supportTickets, supportTicketSeries } from "./schema";
import { SupportService, type SupportDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./sla";
export * from "./faq";
export * from "./ports";
export * from "./service";
export * from "./features";
export { supportRoutes, requesterIdentity, GUEST_TOKEN_HEADER } from "./routes";

/**
 * Help desk + FAQ at `/v1/support` (docs/batch3.md §A3). Settings: `settings.define("support",
 * SUPPORT_SETTINGS_SCHEMA, SUPPORT_SETTINGS_DEFAULTS)`. Job: call `service.markOverdue()` every few minutes.
 */
export function createSupport(deps: SupportDeps) {
  const service = new SupportService(deps);
  const module = defineModule({
    id: "support",
    tables: { supportTickets, supportTicketSeries, supportMessages, faqCategories, faqArticles },
    routes: supportRoutes(service),
    features: SUPPORT_FEATURES,
    permissions: SUPPORT_PERMISSIONS,
  });
  return { service, module };
}
