import { pk, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export type UserStatus = "active" | "disabled" | "deleted";
export type OtpChannel = "sms" | "whatsapp" | "email";

export const users = pgTable("users", {
  id: pk(),
  /** E.164, e.g. "+919876543210". */
  phone: text("phone").unique(),
  /** Always lowercased. */
  email: text("email").unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  locale: text("locale").notNull().default("en"),
  platformRoles: text("platform_roles").array().notNull().default(sql`'{}'::text[]`),
  status: text("status").$type<UserStatus>().notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps(),
});

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"google">().notNull(),
    providerUserId: text("provider_user_id").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("auth_identities_provider_uid").on(t.provider, t.providerUserId), index("auth_identities_user_idx").on(t.userId)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 of the bearer token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** The app that signed in, from the `x-client` header (e.g. "srikit-business/1.0.0 (android)"); null = web. */
    client: text("client"),
    /**
     * A POS PIN session (`@srirealtime/pos`): the paired terminal it is bound to. Such a session is valid only on a
     * request that carries that terminal's device token; it never slides. Null for every other session.
     */
    terminalId: uuid("terminal_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId), index("auth_sessions_terminal_idx").on(t.terminalId)],
);

export const authOtps = pgTable(
  "auth_otps",
  {
    id: pk(),
    /** Normalised phone (E.164) or lowercased email. */
    target: text("target").notNull(),
    channel: text("channel").$type<OtpChannel>().notNull(),
    /** sha256(code + target). */
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_otps_target_idx").on(t.target)],
);

/**
 * One-time sign-in codes that carry a session across origins (the landing site → a shop's app): single use, 60 s.
 * Only the sha256 of the code is stored.
 */
export const authHandoffs = pgTable(
  "auth_handoffs",
  {
    id: pk(),
    codeHash: text("code_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** The shop a storefront handoff was made for; only that shop can redeem it. Null for business-app handoffs. */
    tenantId: uuid("tenant_id"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_handoffs_user_idx").on(t.userId)],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof authSessions.$inferSelect;
export type IdentityRow = typeof authIdentities.$inferSelect;
export type OtpRow = typeof authOtps.$inferSelect;
