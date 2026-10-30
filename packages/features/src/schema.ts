import { tenantId, timestamps } from "@rbms/db";
import { boolean, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

/**
 * Which features each app (product) offers, set by the platform owner. A shop whose `appId` has no profile
 * gets every registered feature at the app level.
 */
export const appProfiles = pgTable("app_profiles", {
  appId: text("app_id").primaryKey(),
  name: text("name").notNull(),
  /** Module ids and feature keys (see docs/features.md). */
  features: text("features").array().notNull().default([]),
  ...timestamps(),
});

/** The shop owner's own switches for `shopToggle` features. A missing row means the feature's `defaultOn`. */
export const tenantFeatureToggles = pgTable(
  "tenant_feature_toggles",
  {
    tenantId: tenantId(),
    feature: text("feature").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedBy: uuid("updated_by"),
    ...timestamps(),
  },
  (t) => [primaryKey({ name: "tenant_feature_toggles_pk", columns: [t.tenantId, t.feature] })],
);

export type AppProfileRow = typeof appProfiles.$inferSelect;
export type TenantFeatureToggleRow = typeof tenantFeatureToggles.$inferSelect;
