import { defineModule } from "@rbms/core";
import { WHATSAPP_FEATURES, WHATSAPP_PERMISSIONS } from "./features";
import { whatsappRoutes } from "./routes";
import { waAccounts, waCampaignRecipients, waCampaigns, waContacts, waMessages, waNotes, waTemplates } from "./schema";
import { WhatsAppService, type WhatsAppDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./template";
export * from "./webhook";
export * from "./audience";
export * from "./ports";
export * from "./events";
export * from "./features";
export * from "./settings";
export * from "./crypto";
export * from "./service";
export * from "./drivers/types";
export { MetaDriver, buildMessagePayload, GRAPH_BASE } from "./drivers/meta";
export { MockDriver, MOCK_TEMPLATES, type MockDriverOptions } from "./drivers/mock";
export { whatsappRoutes, type WhatsAppRouteService } from "./routes";

/**
 * WhatsApp Business at `/v1/whatsapp` (docs/batch3.md §B1): two-way inbox over the Cloud API (Graph v21.0), 24 h
 * service-window rule, STOP/START opt-outs, template sync + mapping, and throttled, scheduled template campaigns.
 * Live updates: `service.onEvent(listener)` (see events.ts).
 */
export function createWhatsApp(deps: WhatsAppDeps) {
  const service = new WhatsAppService(deps);
  const module = defineModule({
    id: "whatsapp",
    tables: { waAccounts, waContacts, waMessages, waNotes, waTemplates, waCampaigns, waCampaignRecipients },
    routes: whatsappRoutes(service),
    features: WHATSAPP_FEATURES,
    permissions: WHATSAPP_PERMISSIONS,
  });
  return { service, module };
}
