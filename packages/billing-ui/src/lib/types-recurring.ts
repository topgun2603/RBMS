import type { LineInput } from "@srirealtime/gst";

/** Recurring bills (docs/recurring-export-gstin.md): the shapes of /v1/recurring (packages/invoices/src/recurring.ts). */
export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export const RECURRING_STATUSES = ["active", "paused", "ended"] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];
export const RECURRING_RUN_STATUSES = ["pending", "created", "skipped", "locked", "failed"] as const;
export type RecurringRunStatus = (typeof RECURRING_RUN_STATUSES)[number];
export type RecurringIssueMode = "draft" | "issue";
export type RecurringPriceMode = "fixed" | "list";
export type RecurringSendChannel = "none" | "whatsapp" | "sms";

export interface RecurringProfile {
  id: string;
  branchId: string | null;
  customerId: string;
  customerName: string;
  name: string;
  lines: LineInput[];
  placeOfSupply: string | null;
  notes: string | null;
  dueDays: number | null;
  frequency: RecurringFrequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
  maxCount: number | null;
  count: number;
  nextRunDate: string | null;
  status: RecurringStatus;
  issueMode: RecurringIssueMode;
  priceMode: RecurringPriceMode;
  sendChannel: RecurringSendChannel;
  sendLocale: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  /** Paise at the saved prices. */
  estimate: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringRun {
  id: string;
  runDate: string;
  status: RecurringRunStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
  total: number | null;
  attempts: number;
  error: string | null;
  sent: boolean;
  trigger: "auto" | "manual" | "user" | (string & {});
  createdAt: string;
}

export interface RecurringDetail extends RecurringProfile {
  runs: RecurringRun[];
  upcoming: string[];
}

export interface RecurringSummary {
  active: number;
  paused: number;
  ended: number;
  dueThisWeek: number;
  failed: number;
}

export interface RecurringInput {
  customerId: string;
  name?: string | null;
  lines: LineInput[];
  placeOfSupply?: string | null;
  notes?: string | null;
  dueDays?: number | null;
  frequency: RecurringFrequency;
  interval: number;
  dayOfMonth?: number | null;
  weekday?: number | null;
  startDate: string;
  endDate?: string | null;
  maxCount?: number | null;
  issueMode: RecurringIssueMode;
  priceMode: RecurringPriceMode;
  sendChannel: RecurringSendChannel;
  sendLocale?: string | null;
}

export interface ScheduleLike {
  frequency: RecurringFrequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
}

/**
 * The message key and values that describe a schedule ("Every month on day 31", "Every 2 weeks on Monday"). The
 * weekday / day defaults to the start date's, like the server.
 */
export function scheduleText(s: ScheduleLike): { key: string; values: Record<string, string | number> } {
  const n = Math.max(1, s.interval);
  const many = n > 1 ? "Many" : "One";
  if (s.frequency === "weekly") {
    const wd = s.weekday ?? new Date(`${s.startDate}T00:00:00Z`).getUTCDay();
    return { key: `billing.recurring.every.weekly${many}`, values: { n, weekday: `billing.recurring.weekday.${wd}` } };
  }
  const day = s.dayOfMonth ?? Number(s.startDate.slice(8, 10));
  return { key: `billing.recurring.every.${s.frequency}${many}`, values: { n, day } };
}
