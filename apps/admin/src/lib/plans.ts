/** Plans per app (docs/verticals.md "Plans per app"): each app has its own plans, one per tier. */

export const PLAN_TIERS = ["free", "starter", "pro", "enterprise"] as const;

/** Id of an app's plan of a tier: "sv-pro" (a shared template is just the tier: "pro"). */
export const planIdFor = (appId: string | null | undefined, tier: string) => (appId ? `${appId.toLowerCase()}-${tier}` : tier);

/** The plans a shop of `appId` can be on: its app's own, or the shared ones when the app has none (as the API decides). */
export function plansForApp<P extends { appId?: string | null }>(plans: readonly P[], appId: string | null | undefined): P[] {
  const own = appId ? plans.filter((p) => p.appId === appId) : [];
  return own.length ? own : plans.filter((p) => !p.appId);
}
