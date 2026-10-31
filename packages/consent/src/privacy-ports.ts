import type { NoticeModules } from "./privacy-notice";
import type { PrivacySettings } from "./privacy-settings";

/** Facts about a shop (or the platform) that the notice is generated from. */
export interface NoticeFacts {
  shopName: string;
  legalName: string;
  address: string;
  modules: NoticeModules;
}

/** What the host gives the privacy services: settings, shop facts and the list of shops. Implemented in apps/api. */
export interface PrivacyHostPort {
  /** Effective `privacy` settings: the shop's over the platform's; `null` = the platform's own. */
  settings(tenantId: string | null): Promise<PrivacySettings>;
  facts(tenantId: string | null): Promise<NoticeFacts>;
  /** Every active shop, for the scheduled retention run. */
  tenantIds(): Promise<string[]>;
  /**
   * A signed-in shopper's contact for a rights request: phone and email must be the account's VERIFIED ones (what they
   * sign in with), never profile fields the shopper can edit; the name may come from the shop's customer record.
   */
  contactOf?(tenantId: string, userId: string): Promise<{ name: string | null; phone: string | null; email: string | null } | null>;
}

export interface SubjectQuery {
  userId?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface SubjectRef {
  /** The handler id ("store_customers", "billing_customers" ...). */
  handler: string;
  id: string;
  label: string;
}

/** What an erasure did to one record: anonymised (true) or kept, with the reasons in plain words. */
export interface SubjectErasure {
  anonymised: boolean;
  /** e.g. "12 GST invoices kept for 8 years (CGST Act s.36)". */
  kept: string[];
}

/** A module's records about a shop customer: find them, export them, anonymise them. Registered by apps/api. */
export interface SubjectHandler {
  id: string;
  label: string;
  /** Records of this module that belong to the person (matched by account, phone or email). */
  locate(tenantId: string, q: SubjectQuery): Promise<Array<{ id: string; label: string }>>;
  export(tenantId: string, id: string): Promise<unknown>;
  /** Must be idempotent. Never deletes a tax or accounting record inside its legal period: it keeps and says so. */
  anonymise(tenantId: string, id: string): Promise<SubjectErasure>;
  /** Stops marketing to this record (opt-in off). Optional. */
  stopMarketing?(tenantId: string, id: string): Promise<void>;
  /** Correction is made by staff in the module's own screen; this is only a pointer for the request page. */
  correctionHint?: string;
}

/** Writes consent decisions (the existing consent log) and reads the latest ones. */
export interface ConsentLogPort {
  record(input: {
    userId: string | null;
    tenantId: string;
    purposes: Record<string, boolean>;
    version: string;
    source: "web" | "admin";
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<unknown>;
}

export interface RetentionScope {
  /** Null for platform-wide categories. */
  tenantId: string | null;
}

/** One kind of stored data with a retention period and a purge. Registered by apps/api; see docs/privacy-dpdp.md. */
export interface RetentionCategory {
  key: string;
  scope: "shop" | "platform";
  defaultDays: number;
  /** The shortest a shop may set (legal floor). Settings below it are raised to it. */
  minDays: number;
  action: "delete" | "anonymise";
  /** Tables this category reads or changes. A test checks that none is a tax / accounting table. */
  touches: string[];
  /** Shown instead of counts when another job already does this work (job name, fixed days). */
  managedBy?: { job: string; days: number };
  /** Rows that would be purged now (the dry-run preview). Absent when `managedBy`. */
  count?(scope: RetentionScope, cutoff: Date): Promise<number>;
  /** Purges and returns how many rows were purged. Idempotent. */
  purge?(scope: RetentionScope, cutoff: Date): Promise<number>;
}

/** Tables that hold tax, GST or accounting records. No retention category may touch them (CGST Act s.36: 8 years). */
export const PROTECTED_TABLES: readonly string[] = [
  "invoices",
  "invoice_payments",
  "credit_notes",
  "debit_notes",
  "customer_receipts",
  "orders",
  "order_items",
  "payments",
  "journal_entries",
  "journal_lines",
  "accounts",
  "purchases",
  "purchase_bills",
  "expenses",
  "payroll_runs",
  "payroll_run_lines",
  "payroll_payments",
  "gst_returns",
  "einvoice_documents",
  "subscription_invoices",
];

/** Years GST and accounting records must be kept (CGST Act s.36). */
export const TAX_RECORD_YEARS = 8;
