import { defineModule, type SrModule } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import type { AiService } from "../service";
import type { AiSettings } from "../features";
import { aiItemPairs, aiProductAliases } from "../schema";
import { AliasService, type AliasPorts } from "./aliases";
import { ShopperChat, type ChatPorts } from "./chat";
import { storeRoutes, type CartPartnersPort, type PricingPorts, type SocialPorts } from "./routes";
import { TogetherService, type TogetherPorts } from "./together";

export * from "./common";
export * from "./aliases";
export * from "./together";
export * from "./pricing";
export * from "./social";
export * from "./chat";
export { storeRoutes, STORE_PERMISSIONS, type StoreRouteDeps, type PricingPorts, type SocialPorts, type CartPartnersPort, type CartPartner } from "./routes";
export { STORE_REGISTRY } from "./registry";

export interface AiStoreDeps {
  db: Db;
  ai: AiService;
  aliasPorts: AliasPorts;
  togetherPorts: TogetherPorts;
  chatPorts: ChatPorts;
  pricing: PricingPorts;
  social: SocialPorts;
  cart: CartPartnersPort;
  settings: { get(tenantId: string): Promise<AiSettings> };
  saveSettings: (tenantId: string, patch: { features?: Record<string, boolean>; shopperChat?: { dailyCredits: number } }) => Promise<void>;
  featureOn(tenantId: string): Promise<boolean>;
  enqueueAliases: (p: import("./aliases").AliasJobPayload) => Promise<void>;
  now?: () => Date;
  log?: { warn(o: object, m?: string): void };
}

/**
 * AI Phase 4 part B, the store features (docs/ai.md): shopper chat, search words, bought-together, pricing hints, social posts.
 * Mount `module` (routes at /v1/ai/store); `aliases.process` and `together.refreshAll` are the bodies of the background jobs.
 */
export function createAiStore(d: AiStoreDeps) {
  const aliases = new AliasService({ db: d.db, ai: d.ai, ports: d.aliasPorts, log: d.log });
  const together = new TogetherService({ db: d.db, ports: d.togetherPorts, now: d.now, log: d.log });
  const chat = new ShopperChat({ db: d.db, ai: d.ai, ports: d.chatPorts, settings: d.settings, featureOn: d.featureOn, now: d.now, log: d.log });
  const togetherOn = async (tenantId: string) => (await d.settings.get(tenantId)).features["bought-together"] !== false;
  const module: SrModule = defineModule({
    id: "ai/store",
    tables: { aiProductAliases, aiItemPairs },
    routes: storeRoutes({ ai: d.ai, aliases, chat, together, pricing: d.pricing, social: d.social, cart: d.cart, enqueueAliases: d.enqueueAliases, saveSettings: d.saveSettings, togetherOn }),
  });
  return { module, aliases, together, chat, togetherOn };
}
