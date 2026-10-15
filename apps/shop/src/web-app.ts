import { billingModule } from "@srirealtime/billing-ui";
import { createWebApp } from "@srirealtime/web";
import { storeModule } from "./store/module";

/**
 * Ecommerce store admin (app profile "EC"): a small store module at "/" and the billing UI module at "/billing".
 * Which billing features show up is decided by the server (EC profile: no credit book, reminders or purchases).
 */
export const webApp = createWebApp({
  appId: "EC",
  name: "Store",
  tenant: { from: "hostname" },
  modules: [storeModule(), billingModule({ basePath: "/billing" })],
  home: "dashboard",
});
