import { billingModule } from "@srirealtime/billing-ui";
import { commerceModule } from "@srirealtime/commerce-ui";
import { createWebApp } from "@srirealtime/web";
import { storeModule } from "./store/module";

/**
 * Ecommerce store admin (app profile "EC"): the store module (dashboard welcome + the Orders placeholder), the
 * commerce UI module at "/" (Catalogue: products, categories, collections) and the billing UI module at "/billing".
 * Which features show up is decided by the server (EC profile: no credit book, reminders or purchases).
 */
export const webApp = createWebApp({
  appId: "EC",
  name: "Store",
  tenant: { from: "hostname" },
  modules: [storeModule(), commerceModule(), billingModule({ basePath: "/billing" })],
  home: "dashboard",
});
