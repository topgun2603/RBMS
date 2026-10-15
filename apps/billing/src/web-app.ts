import { billingModule } from "@srirealtime/billing-ui";
import { createWebApp } from "@srirealtime/web";

/** The billing app: the billing UI module at "/", the shop from the subdomain (raja.localhost:3001). */
export const webApp = createWebApp({
  appId: "BL",
  name: "Billing",
  tenant: { from: "hostname" },
  modules: [billingModule()],
  home: "dashboard",
});
