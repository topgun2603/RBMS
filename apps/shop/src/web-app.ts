import { enquiriesModule } from "@rbms/enquiries-ui";
import { growthModule } from "@rbms/growth-ui";
import { jewelleryModule } from "@rbms/jewellery-ui";
import { marketplaceModule } from "@rbms/marketplace-ui";
import { inboxModule } from "@rbms/inbox-ui";
import { payrollModule } from "@rbms/payroll-ui";
import { posModule } from "@rbms/pos-ui";
import { billingModule } from "@rbms/billing-ui";
import { commerceModule } from "@rbms/commerce-ui";
import { ordersModule } from "@rbms/orders-ui";
import { scalesModule } from "@rbms/scales-ui";
import { serialsModule } from "@rbms/serials-ui";
import { siteModule } from "@rbms/site-ui";
import { createWebApp } from "@rbms/web";
import { workspaceModule } from "@rbms/workspace-ui";
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
    enquiriesModule(),
    billingModule({ basePath: "/billing" }),
    posModule(),
    scalesModule(),
    serialsModule({ invoiceHref: (id) => `/billing/invoices/${id}` }),
    jewelleryModule({ invoiceHref: (id) => `/billing/invoices/${id}` }),
    inboxModule({ basePath: "/inbox", links: { invoice: (id) => `/billing/invoices/${id}` } }),
    marketplaceModule({ basePath: "/marketplace" }),
    growthModule(),
    payrollModule(),
    workspaceModule(),
  ],
  home: "dashboard",
});
