import type { FeatureDef, PermissionDef, TenantRef } from "@srirealtime/core";
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
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
}

/** Makes the GST bill for a job (invoices). The bill is issued; payment (and the advance) is taken on it as usual. */
export interface BillingPort {
  createBill(
    tenant: TenantRef,
    input: { lines: BillLine[]; customer: { name: string; phone: string | null } | null; notes: string | null; tillSessionId: string | null },
    opts: { branchId: string | null },
  ): Promise<BillResult>;
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

/** Told when a job becomes ready or is delivered (SMS / WhatsApp to the customer). Optional; failures are logged. */
export interface NotifyPort {
  statusChanged(tenantId: string, job: JobSummary): void | Promise<void>;
}

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
