import { billingModule } from "@srirealtime/billing-ui";
import { bookingsModule } from "@srirealtime/bookings-ui";
import { commerceModule } from "@srirealtime/commerce-ui";
import { growthModule } from "@srirealtime/growth-ui";
import { inboxModule } from "@srirealtime/inbox-ui";
import { jobcardsModule } from "@srirealtime/jobcards-ui";
import { membershipsModule } from "@srirealtime/memberships-ui";
import { ordersModule } from "@srirealtime/orders-ui";
import { posModule } from "@srirealtime/pos-ui";
import { serialsModule } from "@srirealtime/serials-ui";
import { siteModule } from "@srirealtime/site-ui";
import { createWebApp, currentTenantSlug } from "@srirealtime/web";
import { workspaceModule } from "@srirealtime/workspace-ui";

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
    inboxModule({ basePath: "/inbox", links: { invoice: (id) => `/invoices/${id}` } }),
    growthModule(),
    workspaceModule(),
  ],
  home: "dashboard",
});
