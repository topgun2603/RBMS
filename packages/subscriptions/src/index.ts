import { defineModule, type FeatureDef, type PermissionDef } from "@srirealtime/core";
import { subscriptionsRoutes, SUBSCRIPTIONS_PERMISSION } from "./routes";
import { platformInvoices, platformInvoiceSeries, providerPlans, subscriptionEvents, subscriptions } from "./schema";
import { SubscriptionsService, type SubscriptionsDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./provider";
export * from "./service";
export * from "./list";
export { subscriptionsRoutes, SUBSCRIPTIONS_PERMISSION } from "./routes";

export const SUBSCRIPTIONS_MODULE = "subscriptions";
export const SUBSCRIPTIONS_FEATURE = "subscriptions";
/** Job name of the daily lifecycle run (09:00 IST). */
export const SUBSCRIPTIONS_LIFECYCLE_JOB = "subscriptions.lifecycle";

/**
 * The Plan & billing page. Every plan grants it (it is how a shop upgrades), so the plans module lists it among the
 * core modules and the app profiles include it.
 */
export const SUBSCRIPTIONS_FEATURES: FeatureDef[] = [
  {
    key: SUBSCRIPTIONS_FEATURE,
    module: SUBSCRIPTIONS_MODULE,
    label: "Plan & billing",
    description: "See your plan, trial and usage, change plan, pay by UPI Autopay or card, and download platform invoices.",
  },
];

/** Owners and admins hold it (full access); no built-in staff role includes it. */
export const SUBSCRIPTIONS_PERMISSIONS: PermissionDef[] = [
  {
    key: SUBSCRIPTIONS_PERMISSION,
    module: SUBSCRIPTIONS_MODULE,
    label: "Manage plan and billing",
    description: "Change the shop's plan, set up payment, cancel or resume, and download platform invoices.",
  },
];

/** Platform plan subscriptions at `/v1/subscriptions` (docs/batch5.md). */
export function createSubscriptions(deps: SubscriptionsDeps) {
  const service = new SubscriptionsService(deps);
  const module = defineModule({
    id: SUBSCRIPTIONS_MODULE,
    tables: { subscriptions, subscriptionEvents, platformInvoices, platformInvoiceSeries, providerPlans },
    routes: subscriptionsRoutes(service),
    features: SUBSCRIPTIONS_FEATURES,
    permissions: SUBSCRIPTIONS_PERMISSIONS,
  });
  return { service, module };
}
