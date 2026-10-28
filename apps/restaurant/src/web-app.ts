import { billingModule } from "@srirealtime/billing-ui";
import { commerceModule } from "@srirealtime/commerce-ui";
import { enquiriesModule } from "@srirealtime/enquiries-ui";
import { growthModule } from "@srirealtime/growth-ui";
import { inboxModule } from "@srirealtime/inbox-ui";
import { ordersModule } from "@srirealtime/orders-ui";
import { payrollModule } from "@srirealtime/payroll-ui";
import { posModule } from "@srirealtime/pos-ui";
import { restaurantModule } from "@srirealtime/restaurant-ui";
import { siteModule } from "@srirealtime/site-ui";
import { createWebApp } from "@srirealtime/web";
import { workspaceModule } from "@srirealtime/workspace-ui";

/**
 * The restaurant app (app profile "RS"): tables, running orders, KOTs and the kitchen display at "/dine", online orders,
 * the menu (catalogue), the counter, billing at "/billing" and the workspace settings. The shop comes from the subdomain
 * (arusuvai.localhost:3007); table QR codes open the shop's online store (NEXT_PUBLIC_STORE_URL, `{slug}`).
 */
export const webApp = createWebApp({
  appId: "RS",
  name: "Restaurant",
  tenant: { from: "hostname" },
  modules: [
    restaurantModule({ storeUrl: process.env.NEXT_PUBLIC_STORE_URL || "http://{slug}.localhost:3003" }),
    ordersModule(),
    commerceModule(),
    siteModule(),
    enquiriesModule(),
    posModule(),
    billingModule({ basePath: "/billing" }),
    inboxModule({ basePath: "/inbox", links: { invoice: (id) => `/billing/invoices/${id}` } }),
    growthModule(),
    payrollModule(),
    workspaceModule(),
  ],
  home: "dashboard",
});
