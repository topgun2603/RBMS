import { timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** One row per tenant: which steps the owner skipped and whether the checklist was dismissed. */
export const onboardingState = pgTable("onboarding_state", {
  tenantId: uuid("tenant_id").primaryKey(),
  /** Step keys the owner chose to skip. */
  skipped: text("skipped").array().notNull().default(sql`'{}'::text[]`),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  /** First time every visible step was done or skipped. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps(),
});

export type OnboardingStateRow = typeof onboardingState.$inferSelect;
