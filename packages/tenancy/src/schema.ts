import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const TENANT_STATUSES = ["active", "suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const tenants = pgTable("tenants", {
  id: pk(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  planId: text("plan_id"),
  status: text("status", { enum: TENANT_STATUSES }).notNull().default("active"),
  /** Which product this tenant belongs to, e.g. "EC", "SCH". */
  appId: text("app_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
});

/** Custom domains. Only `verified` domains resolve to their tenant. */
export const tenantDomains = pgTable(
  "tenant_domains",
  {
    id: pk(),
    tenantId: tenantId(),
    domain: text("domain").notNull().unique(),
    verified: boolean("verified").notNull().default(false),
    /** Value of the `_rbms-verify.<domain>` TXT record. Set on add; older rows get one lazily. */
    verificationToken: text("verification_token"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Last DNS check (manual or the `tenancy.domains.verify` job). */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("tenant_domains_tenant_idx").on(t.tenantId), index("tenant_domains_verified_idx").on(t.verified)],
);

/** User ↔ tenant link with per-tenant roles. No FK to users: auth is a separate module. */
export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid("user_id").notNull(),
    roles: text("roles").array().notNull().default(["member"]),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("tenant_memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("tenant_memberships_user_idx").on(t.userId),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type TenantDomain = typeof tenantDomains.$inferSelect;
export type TenantMembership = typeof tenantMemberships.$inferSelect;
