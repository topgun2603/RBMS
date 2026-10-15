import { defineModule } from "@srirealtime/core";
import { ANALYTICS_FEATURES } from "./ports";
import { analyticsRoutes } from "./routes";
import { analyticsDaily, analyticsEvents } from "./schema";
import { AnalyticsService, type AnalyticsDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./ua";
export * from "./ingest";
export * from "./rollup";
export * from "./overview";
export { AnalyticsService, MAX_OVERVIEW_DAYS } from "./service";
export type { AnalyticsDeps, IngestRequest } from "./service";
export { analyticsRoutes } from "./routes";

/** Job names the host schedules. */
export const ANALYTICS_JOBS = { rollup: "analytics.rollup", purge: "analytics.purge" } as const;

/**
 * Privacy-friendly storefront analytics: public ingest (bots ignored, IP hashed with a daily salt, per-IP limit,
 * batched inserts), hourly rollups into analytics_daily, 90-day raw retention and an owner overview.
 */
export function createAnalytics(deps: AnalyticsDeps) {
  const service = new AnalyticsService(deps);
  const module = defineModule({
    id: "analytics",
    tables: { analyticsEvents, analyticsDaily },
    routes: analyticsRoutes(service),
    features: ANALYTICS_FEATURES,
    stop: () => service.flush(),
  });
  return { service, module };
}
