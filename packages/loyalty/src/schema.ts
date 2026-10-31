import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Ledger entry types. Points are signed: earn and positive adjust add, redeem / expire / negative adjust take away,
 * reverse is the net of undoing a ref (earn taken back, redeemed points given back).
 */
export const LEDGER_TYPES = ["earn", "redeem", "expire", "adjust", "reverse"] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/**
 * What a ledger entry points at. `invoice` (counter bill), `order` (online order), `manual` (staff adjustment, ref id
 * generated), `lot` (an expiry: ref id = the ledger id of the lot that expired), `credit_note` (points taken back for a
 * credit note, ref id = "<invoice id>:<credit note id>"; a cancelled note gives them back with an `earn` entry).
 */
export const REF_TYPES = ["invoice", "order", "manual", "lot", "credit_note"] as const;
export type RefType = (typeof REF_TYPES)[number];

export const loyaltyMembers = pgTable(
  "loyalty_members",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Normalised Indian mobile, "+919876543210". */
    memberKey: text("member_key").notNull(),
    name: text("name"),
    /** Always equals the sum of `remaining` over the member's open lots; never negative. */
    pointsBalance: integer("points_balance").notNull().default(0),
    /** Paise; bigint because a regular wholesale buyer can pass ₹2 crore. */
    lifetimeSpend: bigint("lifetime_spend", { mode: "number" }).notNull().default(0),
    /** Tier name from the settings (recomputed on every earn / reverse). */
    tier: text("tier").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("loyalty_members_tenant_key_uq").on(t.tenantId, t.memberKey),
    index("loyalty_members_tenant_name_idx").on(t.tenantId, t.name),
  ],
);

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: pk(),
    tenantId: tenantId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => loyaltyMembers.id, { onDelete: "cascade" }),
    type: text("type").$type<LedgerType>().notNull(),
    /** Signed. */
    points: integer("points").notNull(),
    /**
     * The money basis in paise: the purchase amount for earn (and for the reverse of an earn), the discount for
     * redeem, 0 otherwise.
     */
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull().default(0),
    /**
     * Points of this entry still unused (a "lot"). Only entries that add points carry it: earn, positive adjust and
     * a reverse that gave redeemed points back. FIFO redemption and expiry draw it down.
     */
    remaining: integer("remaining").notNull().default(0),
    refType: text("ref_type").$type<RefType>().notNull(),
    refId: text("ref_id").notNull(),
    /** When the lot's unused points expire (last millisecond of an IST month); null = never. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Adjust reason, or what a reverse could not take back. */
    note: text("note"),
    /** Staff user for adjustments. */
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("loyalty_ledger_ref_uq").on(t.tenantId, t.refType, t.refId, t.type),
    index("loyalty_ledger_member_idx").on(t.tenantId, t.memberId, t.createdAt),
    index("loyalty_ledger_due_idx").on(t.expiresAt).where(sql`${t.remaining} > 0`),
  ],
);

export type LoyaltyMemberRow = typeof loyaltyMembers.$inferSelect;
export type LoyaltyLedgerRow = typeof loyaltyLedger.$inferSelect;
