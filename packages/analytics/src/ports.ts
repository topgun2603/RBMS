import type { FeatureDef } from "@rbms/core";

/** Implemented by the catalogue: product id → name. Unknown ids are simply missing. */
export interface CatalogPort {
  names(tenantId: string, ids: string[]): Promise<Record<string, string>>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export interface AnalyticsConfig {
  /** Secret the daily IP salt is derived from (e.g. env ANALYTICS_SALT or the session secret). Required. */
  ipSaltSecret: string;
  /** Ingest calls per IP per minute, default 120. */
  rateLimitPerMinute?: number;
  /** Raw event retention, default 90 days. */
  retentionDays?: number;
  /** Events are buffered and inserted in batches: flush delay, default 2000 ms (0 = insert right away). */
  flushMs?: number;
  /** Flush as soon as this many events are buffered, default 500. */
  maxBatch?: number;
}

export const ANALYTICS_FEATURE = "analytics";

export const ANALYTICS_FEATURES: FeatureDef[] = [
  {
    key: ANALYTICS_FEATURE,
    module: "analytics",
    label: "Store analytics",
    description: "Visitors, sessions, sources, devices, top products and searches, and the sales funnel of the online store.",
  },
];
