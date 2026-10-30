import { billingModule } from "@rbms/billing-ui";
import { commerceModule } from "@rbms/commerce-ui";
import { enquiriesModule } from "@rbms/enquiries-ui";
import { growthModule } from "@rbms/growth-ui";
import { inboxModule } from "@rbms/inbox-ui";
import { ordersModule } from "@rbms/orders-ui";
import { payrollModule } from "@rbms/payroll-ui";
import { posModule } from "@rbms/pos-ui";
import { restaurantModule } from "@rbms/restaurant-ui";
import { siteModule } from "@rbms/site-ui";
import { createWebApp } from "@rbms/web";
import { workspaceModule } from "@rbms/workspace-ui";

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
