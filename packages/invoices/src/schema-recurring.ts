/**
 * Recurring invoices (a profile per customer that makes bills on a schedule) and the GSTIN lookup cache
 * (docs/recurring-export-gstin.md). Re-exported by schema.ts, which drizzle-kit reads.
 */
import { pk, tenantId, timestamps } from "@rbms/db";
import type { LineInput } from "@rbms/gst";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** `ended`: the end date or the number of bills was reached (or the owner ended it). */
export const RECURRING_STATUSES = ["active", "paused", "ended"] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

/** What a run makes: a draft to check and issue, or an issued bill (numbered, counts against the plan). */
export const RECURRING_ISSUE_MODES = ["draft", "issue"] as const;
export type RecurringIssueMode = (typeof RECURRING_ISSUE_MODES)[number];

/** Prices of a run: as saved on the profile, or the customer's price list on the run date. */
export const RECURRING_PRICE_MODES = ["fixed", "list"] as const;
export type RecurringPriceMode = (typeof RECURRING_PRICE_MODES)[number];

export const RECURRING_SEND_CHANNELS = ["none", "whatsapp", "sms"] as const;
export type RecurringSendChannel = (typeof RECURRING_SEND_CHANNELS)[number];

/**
 * `pending`: claimed, bill being made; `created`: bill made; `skipped`: skipped by the owner, or a missed date older than
 * the catch-up cap; `locked`: the date is in a locked accounting period; `failed`: the bill could not be made (plan
 * limit, missing customer ...), retried on the next runs up to 3 times.
 */
export const RECURRING_RUN_STATUSES = ["pending", "created", "skipped", "locked", "failed"] as const;
export type RecurringRunStatus = (typeof RECURRING_RUN_STATUSES)[number];

export const recurringProfiles = pgTable(
  "recurring_profiles",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    customerId: uuid("customer_id").notNull(),
    /** Name shown in the list, e.g. "AMC – Meena Stores". */
    name: text("name").notNull(),
    /** Bill lines as entered (GST-exclusive paise; units and item links kept). */
    lines: jsonb("lines").$type<LineInput[]>().notNull(),
    placeOfSupply: text("place_of_supply"),
    notes: text("notes"),
    /** Due date = bill date + this many days (null = no due date). */
    dueDays: integer("due_days"),
    frequency: text("frequency").$type<RecurringFrequency>().notNull(),
    /** Every N weeks / months / quarters / years. */
    interval: integer("interval").notNull().default(1),
    /** Monthly and longer: day of the month, 1–31; a day past the month's end bills on its last day. */
    dayOfMonth: integer("day_of_month"),
    /** Weekly: 0 = Sunday … 6 = Saturday. */
    weekday: integer("weekday"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    /** Stop after this many bills (null = no limit). */
    maxCount: integer("max_count"),
    /** Bills made so far. */
    count: integer("count").notNull().default(0),
    /** Date of the next bill (null once ended). */
    nextRunDate: date("next_run_date", { mode: "string" }),
    status: text("status").$type<RecurringStatus>().notNull().default("active"),
    issueMode: text("issue_mode").$type<RecurringIssueMode>().notNull().default("draft"),
    priceMode: text("price_mode").$type<RecurringPriceMode>().notNull().default("fixed"),
    /** Send the bill's link after an automatic issue (through notify; never for drafts). */
    sendChannel: text("send_channel").$type<RecurringSendChannel>().notNull().default("none"),
    sendLocale: text("send_locale"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("recurring_profiles_tenant_status_idx").on(t.tenantId, t.status),
    index("recurring_profiles_tenant_customer_idx").on(t.tenantId, t.customerId),
    // The scheduler scans active profiles that are due, across shops.
    index("recurring_profiles_due_idx").on(t.status, t.nextRunDate),
  ],
);

/** One scheduled date of a profile. Unique per (profile, date): a job that runs twice never makes a second bill. */
export const recurringRuns = pgTable(
  "recurring_runs",
  {
    id: pk(),
    tenantId: tenantId(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => recurringProfiles.id, { onDelete: "cascade" }),
    runDate: date("run_date", { mode: "string" }).notNull(),
    status: text("status").$type<RecurringRunStatus>().notNull().default("pending"),
    invoiceId: uuid("invoice_id"),
    invoiceNumber: text("invoice_number"),
    /** Paise of the bill made. */
    total: integer("total"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** Notify log id of the message sent with the bill. */
    sentLogId: text("sent_log_id"),
    /** "auto" (the scheduler), "manual" (Run now), "user" (skipped by the owner). */
    trigger: text("trigger").notNull().default("auto"),
    ...timestamps(),
  },
  (t) => [
    unique("recurring_runs_profile_date_uq").on(t.profileId, t.runDate),
    index("recurring_runs_tenant_profile_idx").on(t.tenantId, t.profileId, t.runDate),
  ],
);

// ------------------------------------------------------------------ GSTIN lookup

/** Registration status as the lookup provider reported it. */
export const GSTIN_STATUSES = ["active", "cancelled", "suspended", "inactive", "unknown"] as const;
export type GstinStatus = (typeof GSTIN_STATUSES)[number];

/** Details a provider returned for a GSTIN (public GST search data). */
export interface GstinDetails {
  legalName: string | null;
  tradeName: string | null;
  address: string | null;
  pincode: string | null;
  stateCode: string | null;
  status: GstinStatus;
  /** Regular, Composition, SEZ unit, SEZ developer, Casual, Non-resident ... as the provider spells it. */
  registrationType: string | null;
  /** Business constitution (Proprietorship, Private Limited Company ...). */
  constitution: string | null;
  registeredOn: string | null;
  cancelledOn: string | null;
}

/**
 * Lookup answers, shared by every shop (public registration data, not shop data), kept 30 days. `details` is null
 * when the provider said the GSTIN does not exist.
 */
export const gstinLookups = pgTable(
  "gstin_lookups",
  {
    gstin: text("gstin").primaryKey(),
    provider: text("provider").notNull(),
    found: boolean("found").notNull().default(true),
    status: text("status").$type<GstinStatus>().notNull().default("unknown"),
    details: jsonb("details").$type<GstinDetails>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gstin_lookups_fetched_idx").on(t.fetchedAt)],
);

/** Provider calls per shop (cache hits are not logged), for the per-shop rate limit. */
export const gstinLookupLog = pgTable(
  "gstin_lookup_log",
  {
    id: pk(),
    tenantId: tenantId(),
    gstin: text("gstin").notNull(),
    userId: uuid("user_id"),
    ok: boolean("ok").notNull().default(true),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("gstin_lookup_log_tenant_at_idx").on(t.tenantId, t.at)],
);

export type RecurringProfileRow = typeof recurringProfiles.$inferSelect;
export type RecurringRunRow = typeof recurringRuns.$inferSelect;
export type GstinLookupRow = typeof gstinLookups.$inferSelect;
