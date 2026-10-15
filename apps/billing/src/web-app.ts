import { growthModule } from "@srirealtime/growth-ui";
import { inboxModule } from "@srirealtime/inbox-ui";
import { posModule } from "@srirealtime/pos-ui";
import { billingModule } from "@srirealtime/billing-ui";
import { createWebApp } from "@srirealtime/web";
import { workspaceModule } from "@srirealtime/workspace-ui";

/**
 * The billing app: the billing UI module at "/" plus the workspace settings (team, activity log, import/export,
 * setup checklist); the shop comes from the subdomain (raja.localhost:3001).
 */
export const webApp = createWebApp({
  appId: "BL",
  name: "Billing",
  tenant: { from: "hostname" },
  modules: [billingModule(), posModule(), inboxModule({ basePath: "/inbox" }), growthModule(), workspaceModule()],
  home: "dashboard",
});
