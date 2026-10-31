import { billingModule } from "@rbms/billing-ui";
import { bookingsModule } from "@rbms/bookings-ui";
import { commerceModule } from "@rbms/commerce-ui";
import { enquiriesModule } from "@rbms/enquiries-ui";
import { growthModule } from "@rbms/growth-ui";
import { inboxModule } from "@rbms/inbox-ui";
import { jobcardsModule } from "@rbms/jobcards-ui";
import { membershipsModule } from "@rbms/memberships-ui";
import { ordersModule } from "@rbms/orders-ui";
import { payrollModule } from "@rbms/payroll-ui";
import { posModule } from "@rbms/pos-ui";
import { serialsModule } from "@rbms/serials-ui";
import { siteModule } from "@rbms/site-ui";
import { createWebApp, currentTenantSlug } from "@rbms/web";
import { workspaceModule } from "@rbms/workspace-ui";

/** The shop's online store ({slug} = shop subdomain): job cards link customers to `<store>/job/<code>` to track work. */
const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL || "http://{slug}.localhost:3003";
const trackUrl = (token: string) => {
  const slug = currentTenantSlug();
  return slug ? `${STORE_URL.replace("{slug}", slug).replace(/\/+$/, "")}/job/${token}` : null;
};

/**
 * The services app (app profile "SV"): salons, spas, gyms, repair shops, tailors and opticals. Appointments at
 * "/appointments", job cards at "/jobs", members at "/members", billing and the counter at "/", services and products
 * (catalogue), online orders, the online store (website, appearance, domain), inbox, growth and workspace settings. The shop comes from the subdomain (glow.localhost:3008).
 */
export const webApp = createWebApp({
  appId: "SV",
  name: "Services",
  tenant: { from: "hostname" },
  modules: [
    bookingsModule(),
    jobcardsModule({ trackUrl }),
    serialsModule(),
    membershipsModule(),
    billingModule(),
    posModule(),
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
