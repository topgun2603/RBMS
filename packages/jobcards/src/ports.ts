import type { FeatureDef, PermissionDef, TenantRef } from "@srirealtime/core";
import type { JobApproval } from "./logic";
import type { JobStatus } from "./schema";
import type { JobTemplate } from "./templates";

export interface BillLine {
  description: string;
  itemId: string | null;
  qty: number;
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string | null;
  /** Serial numbers / IMEIs of the units sold on this line: the bill marks them sold and starts their warranty. */
  serials?: string[];
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
  /** Paise of the advance recorded on the bill as already paid. */
  advancePaid?: number;
}

/** The advance taken at intake, recorded on the bill as a payment already received (balance = total − advance). */
export interface BillAdvance {
  /** Paise; the adapter records at most the bill total. */
  amount: number;
  /** When it was taken (YYYY-MM-DD, IST). */
  date: string;
  /** "Advance on JC-0007" */
  reference: string;
}

/** Makes the GST bill for a job (invoices). The bill is issued with the advance on it as paid; the rest is paid as usual. */
export interface BillingPort {
  createBill(
    tenant: TenantRef,
    input: {
      lines: BillLine[];
      customer: { name: string; phone: string | null } | null;
      notes: string | null;
      tillSessionId: string | null;
      advance?: BillAdvance | null;
    },
    opts: { branchId: string | null },
  ): Promise<BillResult>;
}

/** The shop's serial-number stock (serials module), for parts with serials on job card lines. */
export interface SerialStockPort {
  /** Of `serials` (normalised), the ones not on the shelf for `itemId` (unknown, sold, defective, another item's). */
  unavailable(tenantId: string, itemId: string, serials: string[]): Promise<string[]>;
}

/** What a status listener gets: enough to text the customer "your phone is ready". */
export interface JobSummary {
  id: string;
  number: number;
  /** "JC-0012" */
  label: string;
  template: JobTemplate;
  status: JobStatus;
  customerName: string;
  customerPhone: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  trackToken: string;
}

/**
 * Told when a job is taken in (`received`), waits for the customer's approval of the estimate, becomes ready or is
 * delivered (SMS / WhatsApp to the customer). Optional; failures are logged.
 */
export interface NotifyPort {
  statusChanged(tenantId: string, job: JobSummary): void | Promise<void>;
  /** The customer approved or declined the estimate on the tracking page: tell the shop (owners / admins). */
  approvalDecided?(tenantId: string, job: JobSummary, approval: JobApproval): void | Promise<void>;
}

/** Statuses the notify port hears about. */
export const NOTIFY_STATUSES: readonly JobStatus[] = ["received", "awaiting_approval", "ready", "delivered"];

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const JOBCARDS_FEATURE = "jobcards";
export const JOBCARDS_TRACKING_FEATURE = "jobcards.tracking";

export const JOBCARDS_MANAGE = "jobcards.manage";
export const JOBCARDS_BILL = "jobcards.bill";
export const JOBCARDS_VIEW = "jobcards.view";

export const JOBCARDS_FEATURES: FeatureDef[] = [
  {
    key: JOBCARDS_FEATURE,
    module: "jobcards",
    label: "Job cards",
    description: "Take in repairs, tailoring and lens orders with a job card: details, estimate of parts and labour, status board and a bill when it's done.",
  },
  {
    key: JOBCARDS_TRACKING_FEATURE,
    module: "jobcards",
    label: "Job tracking link",
    description: "Customers open a link to see where their job is and when it will be ready.",
    dependsOn: [JOBCARDS_FEATURE],
    shopToggle: true,
  },
];

export const JOBCARDS_PERMISSIONS: PermissionDef[] = [
  { key: JOBCARDS_VIEW, module: "jobcards", label: "See job cards", description: "See the job board, job details and estimates." },
  { key: JOBCARDS_MANAGE, module: "jobcards", label: "Manage job cards", description: "Take in jobs, edit details, add parts and labour, move and cancel jobs." },
  { key: JOBCARDS_BILL, module: "jobcards", label: "Bill job cards", description: "Make the bill for a finished job." },
];
