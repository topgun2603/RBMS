import { bookingsModule } from "@rbms/bookings-ui";
import { commerceModule } from "@rbms/commerce-ui";
import { enquiriesModule } from "@rbms/enquiries-ui";
import { inboxModule } from "@rbms/inbox-ui";
import { siteModule } from "@rbms/site-ui";
import { createWebApp } from "@rbms/web";
import { workspaceModule } from "@rbms/workspace-ui";

/**
 * The school app (app profile "SC"): admission enquiries first, campus visits / counselling appointments, programmes
 * (catalogue items without variants or stock), the school website, the website chat + help desk and workspace
 * settings. The school comes from the subdomain (thamarai.localhost:3009). The dashboard shows the widgets of the
 * mounted modules (enquiries, visits, website, chat).
 */
export const webApp = createWebApp({
  appId: "SC",
  name: "School",
  tenant: { from: "hostname" },
  modules: [
    enquiriesModule(),
    bookingsModule(),
    // Programmes = catalogue items; "catalogue" alone (no "catalogue.*", no "inventory") hides variants and stock.
    commerceModule({ features: ["catalogue"] }),
    siteModule(),
    inboxModule({ basePath: "/inbox" }),
    workspaceModule(),
  ],
  home: "dashboard",
});
