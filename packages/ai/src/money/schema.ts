import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { CoverNote, LoanPackFacts } from "./loanpack";

/**
 * Packs the owner prepared in Phase 5 part B (today only `loan-pack`). The facts are a snapshot of the shop's own figures at
 * the time; the share link is a random token that expires and can be revoked. Nothing here is sent to anyone automatically.
 */
export const aiMoneyPacks = pgTable(
  "ai_money_packs",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").notNull().default("loan-pack"),
    facts: jsonb("facts").$type<LoanPackFacts>().notNull(),
    cover: jsonb("cover").$type<CoverNote & { source: "ai" | "template" }>().notNull(),
    /** The owner unticked the name mask: real customer names are in the facts. */
    showNames: boolean("show_names").notNull().default(false),
    shopName: text("shop_name"),
    credits: integer("credits").notNull().default(0),
    createdBy: text("created_by"),
    shareToken: text("share_token"),
    shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ai_money_packs_share_token_uq").on(t.shareToken), index("ai_money_packs_tenant_idx").on(t.tenantId, t.createdAt)],
);
export type AiMoneyPackRow = typeof aiMoneyPacks.$inferSelect;
