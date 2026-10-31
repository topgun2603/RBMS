import { billingModule } from "@rbms/billing-ui";
import { commerceModule } from "@rbms/commerce-ui";
import { enquiriesModule } from "@rbms/enquiries-ui";
import { growthModule } from "@rbms/growth-ui";
import { inboxModule } from "@rbms/inbox-ui";
import { ordersModule } from "@rbms/orders-ui";
import { pharmacyModule } from "@rbms/pharmacy-ui";
import { payrollModule } from "@rbms/payroll-ui";
import { posModule } from "@rbms/pos-ui";
import { siteModule } from "@rbms/site-ui";
import { createWebApp } from "@rbms/web";
import { workspaceModule } from "@rbms/workspace-ui";

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
    enquiriesModule(),
    inboxModule({ basePath: "/inbox", links: { invoice: (id) => `/invoices/${id}` } }),
    growthModule(),
    payrollModule(),
    workspaceModule(),
  ],
  home: "dashboard",
});
