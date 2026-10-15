import { billingModule } from "@srirealtime/billing-ui";
import { commerceModule } from "@srirealtime/commerce-ui";
import { ordersModule } from "@srirealtime/orders-ui";
import { siteModule } from "@srirealtime/site-ui";
import { createWebApp } from "@srirealtime/web";
import { workspaceModule } from "@srirealtime/workspace-ui";
import { storeModule } from "./store/module";

/**
 * Ecommerce store admin (app profile "EC"). Sidebar sections follow module order: the store dashboard, Sales (orders,
 * coupons), Catalogue, Online store (website content, reviews, analytics), Billing at "/billing", and the workspace
 * settings (team, activity log, import/export, setup). Orders comes before the catalogue so "New order" is the
 * primary action. Which features show up is decided by the server (EC profile: no credit book, reminders or purchases).
 */
export const webApp = createWebApp({
  appId: "EC",
  name: "Store",
  tenant: { from: "hostname" },
  modules: [
    storeModule(),
    ordersModule(),
    commerceModule(),
    siteModule(),
    billingModule({ basePath: "/billing" }),
    workspaceModule(),
  ],
  home: "dashboard",
});
