import { billingModule } from "@srirealtime/billing-ui";
import { commerceModule } from "@srirealtime/commerce-ui";
import { growthModule } from "@srirealtime/growth-ui";
import { inboxModule } from "@srirealtime/inbox-ui";
import { ordersModule } from "@srirealtime/orders-ui";
import { pharmacyModule } from "@srirealtime/pharmacy-ui";
import { posModule } from "@srirealtime/pos-ui";
import { siteModule } from "@srirealtime/site-ui";
import { createWebApp } from "@srirealtime/web";
import { workspaceModule } from "@srirealtime/workspace-ui";

/**
 * The pharmacy app (app profile "PH"): medicine billing at "/" with the counter, batches & expiry, prescriptions and the
 * H1 register at "/pharmacy", online orders, products, the online store (website, appearance, domain),
 * inbox, growth and workspace settings.
 * The shop comes from the subdomain (thunai.localhost:3006).
 */
export const webApp = createWebApp({
  appId: "PH",
  name: "Pharmacy",
  tenant: { from: "hostname" },
  modules: [
    billingModule(),
    posModule(),
    pharmacyModule(),
    ordersModule(),
    commerceModule(),
    siteModule(),
    inboxModule({ basePath: "/inbox", links: { invoice: (id) => `/invoices/${id}` } }),
    growthModule(),
    workspaceModule(),
  ],
  home: "dashboard",
});
