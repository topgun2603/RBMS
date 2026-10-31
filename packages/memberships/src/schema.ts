import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, date, index, integer, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Stored subscription statuses. `expired` and `upcoming` are never stored: they follow from the dates (an `active`
 * row whose end date has passed is expired; one that starts later is upcoming). See `subscriptionState` in logic.ts.
 */
export const SUBSCRIPTION_STATUSES = ["active", "frozen", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** A plan the shop sells: "Gym monthly", "Gym yearly", "PT 12 sessions", "Hair spa × 6". */
export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    /** Length in days (30 / 90 / 180 / 365 …). The plan runs from the start day through start + duration − 1. */
    durationDays: integer("duration_days").notNull(),
    /** Visits included (PT sessions, spa sittings). Null = unlimited visits while the plan runs. */
    sessions: integer("sessions"),
    /** Paise: the rate on the bill line. */
    price: integer("price").notNull().default(0),
    gstRate: real("gst_rate").notNull().default(18),
    /** Catalogue item (variant) to bill; null = billed as a free-text line with the plan's name. */
    itemId: uuid("item_id"),
    /** Days a member may pause the plan in total (holiday, injury); 0 = no freezing. */
    freezeDaysAllowed: integer("freeze_days_allowed").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("membership_plans_tenant_name_uq").on(t.tenantId, t.name), index("membership_plans_tenant_sort_idx").on(t.tenantId, t.sort)],
);

/** A member of the gym / salon. `memberCode` ("M-0042") is printed on the card and typed at the front desk. */
export const membershipMembers = pgTable(
  "membership_members",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Per shop: 1, 2, 3… (taken under an advisory lock). */
    memberNo: integer("member_no").notNull(),
    memberCode: text("member_code").notNull(),
    name: text("name").notNull(),
    /** Indian mobile as E.164 ("+919876543210"); unique per shop when present. */
    phone: text("phone"),
    /** The billing customer, when linked. */
    customerId: uuid("customer_id"),
    notes: text("notes"),
    photoUrl: text("photo_url"),
    ...timestamps(),
  },
  (t) => [
    unique("membership_members_tenant_no_uq").on(t.tenantId, t.memberNo),
    unique("membership_members_tenant_code_uq").on(t.tenantId, t.memberCode),
    unique("membership_members_tenant_phone_uq").on(t.tenantId, t.phone),
    index("membership_members_tenant_name_idx").on(t.tenantId, t.name),
  ],
);

/** One sold plan: a member's period (and sessions) from start to end. Renewals are new rows (`renewedFromId`). */
export const membershipSubscriptions = pgTable(
  "membership_subscriptions",
  {
    id: pk(),
    tenantId: tenantId(),
    memberId: uuid("member_id").notNull(),
    planId: uuid("plan_id").notNull(),
    /** The plan's name when sold (plans can be renamed later). */
    planName: text("plan_name").notNull(),
    /** IST calendar days, both inclusive. A freeze pushes `endDate` out by the days frozen. */
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    /** Visits included; null = unlimited. */
    sessionsTotal: integer("sessions_total"),
    sessionsUsed: integer("sessions_used").notNull().default(0),
    status: text("status").$type<SubscriptionStatus>().notNull().default("active"),
    /** Day the current freeze started (status `frozen`). */
    frozenFrom: date("frozen_from", { mode: "string" }),
    /** The plan's freeze allowance when sold, and the days used of it so far. */
    freezeDaysAllowed: integer("freeze_days_allowed").notNull().default(0),
    freezeDaysUsed: integer("freeze_days_used").notNull().default(0),
    /** Paise, as billed. */
    price: integer("price").notNull().default(0),
    invoiceId: uuid("invoice_id"),
    renewedFromId: uuid("renewed_from_id"),
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    soldBy: uuid("sold_by"),
    ...timestamps(),
  },
  (t) => [
    index("membership_subscriptions_tenant_member_idx").on(t.tenantId, t.memberId, t.endDate),
    index("membership_subscriptions_tenant_end_idx").on(t.tenantId, t.endDate),
    index("membership_subscriptions_tenant_plan_idx").on(t.tenantId, t.planId),
  ],
);

/** A visit: the member came in (front desk check-in). Uses one session of a session pack. */
export const membershipCheckins = pgTable(
  "membership_checkins",
  {
    id: pk(),
    tenantId: tenantId(),
    memberId: uuid("member_id").notNull(),
    subscriptionId: uuid("subscription_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Staff member who checked them in (null = self check-in / import). */
    byUserId: uuid("by_user_id"),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    index("membership_checkins_tenant_member_at_idx").on(t.tenantId, t.memberId, t.at),
    index("membership_checkins_tenant_at_idx").on(t.tenantId, t.at),
  ],
);

export type MembershipPlanRow = typeof membershipPlans.$inferSelect;
export type MembershipMemberRow = typeof membershipMembers.$inferSelect;
export type MembershipSubscriptionRow = typeof membershipSubscriptions.$inferSelect;
export type MembershipCheckinRow = typeof membershipCheckins.$inferSelect;
