import { growthModule } from "@rbms/growth-ui";
import { inboxModule } from "@rbms/inbox-ui";
import { payrollModule } from "@rbms/payroll-ui";
import { posModule } from "@rbms/pos-ui";
import { billingModule } from "@rbms/billing-ui";
import { scalesModule } from "@rbms/scales-ui";
import { createWebApp } from "@rbms/web";
import { workspaceModule } from "@rbms/workspace-ui";

/**
 * The billing app: the billing UI module at "/" plus the workspace settings (team, activity log, import/export,
 * setup checklist); the shop comes from the subdomain (raja.localhost:3001).
 */
export const webApp = createWebApp({
  appId: "BL",
  name: "Billing",
  tenant: { from: "hostname" },
  modules: [scalesModule(), billingModule(), posModule(), inboxModule({ basePath: "/inbox" }), growthModule(), payrollModule(), workspaceModule()],
  home: "dashboard",
});
