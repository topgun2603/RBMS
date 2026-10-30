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

/** Tells the shop's owners about a new enquiry (push, else WhatsApp). Optional; fire-and-forget, failures are logged. */
export interface EnquiryNotifyPort {
  received(tenantId: string, enquiry: ReceivedEnquiry): void | Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
