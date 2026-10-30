import type { FeatureDef, PermissionDef } from "@rbms/core";

export const ENQUIRIES_MODULE = "enquiries";
export const ENQUIRIES_FEATURE = "enquiries";
export const ENQUIRIES_MANAGE = "enquiries.manage";

export const ENQUIRIES_FEATURES: FeatureDef[] = [
  {
    key: ENQUIRIES_FEATURE,
    module: ENQUIRIES_MODULE,
    label: "Website enquiries",
    description: "An enquiry form for the website (admissions, call backs) and a list to follow every enquiry up.",
    shopToggle: true,
    // On by default for schools (admissions); other shops switch it on when they add an enquiry form.
    defaultOnApps: ["SC"],
  },
];

export const ENQUIRIES_PERMISSIONS: PermissionDef[] = [
  {
    key: ENQUIRIES_MANAGE,
    module: ENQUIRIES_MODULE,
    label: "Handle website enquiries",
    description: "See the enquiries sent from the website, update their status and notes, and delete them.",
  },
];

/** A new enquiry, as handed to the notifier. */
export interface ReceivedEnquiry {
  id: string;
  number: string;
  name: string;
  phone: string;
  topic: string | null;
  studentName: string | null;
  option: string | null;
}

/**
 * Tells the shop's owners about a new enquiry (push, else WhatsApp). Optional; fire-and-forget, failures are logged.
 * Past `ALERT_RATE` an hour the single alerts stop and `digest` is sent once the hour is over instead.
 */
export interface EnquiryNotifyPort {
  received(tenantId: string, enquiry: ReceivedEnquiry): void | Promise<void>;
  /** "`count` more enquiries since `since`": the alerts held back by the hourly cap. */
  digest?(tenantId: string, input: { count: number; since: Date }): void | Promise<void>;
}

/** A shared fixed-window counter (the API's Redis-backed rate-limit counter, `WindowCounter` in http-guard.ts). */
export interface EnquiryCounterPort {
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

/** Background jobs, for the delayed digest (`ENQUIRY_DIGEST_JOB`); jobs with the same `jobId` run once. */
export interface EnquiryQueuePort {
  enqueue<T>(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
