export const JOB_FLOW = ["received", "diagnosed", "awaiting_approval", "approved", "in_progress", "trial", "ready", "delivered"] as const;
export const JOB_STATUSES = [...JOB_FLOW, "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
/** The board's columns (jobs still in the shop). */
export const BOARD_STATUSES = ["received", "diagnosed", "awaiting_approval", "approved", "in_progress", "trial", "ready"] as const;

export const JOB_TEMPLATES = ["device", "garment", "eyewear", "vehicle", "laundry", "appliance", "general"] as const;
export type JobTemplate = (typeof JOB_TEMPLATES)[number];

export const JOB_PRIORITIES = ["normal", "urgent"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const LINE_KINDS = ["part", "labour"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const EVENT_TYPES = ["created", "status", "note", "estimate", "billed", "approval"] as const;
export type JobEventType = (typeof EVENT_TYPES)[number];

/** How the customer answered the estimate (`online` = on the tracking page; staff pick the others). */
export const APPROVAL_CHANNELS = ["in_person", "phone", "whatsapp", "sms", "email", "other"] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number] | "online";
export type ApprovalDecision = "approved" | "declined";

/** The customer's answer to the estimate (`job.approval`). */
export interface JobApproval {
  decision: ApprovalDecision;
  by: string;
  channel: ApprovalChannel;
  at: string;
  /** Estimate total answered (paise, with GST). */
  amount: number;
  note: string | null;
  recordedBy: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** A card on the board / a row of the list (`GET /jobcards`). */
export interface JobSummary {
  id: string;
  number: number;
  label: string;
  template: JobTemplate;
  status: JobStatus;
  customerName: string;
  customerPhone: string | null;
  customerId: string | null;
  fields: Record<string, unknown>;
  summary: string;
  dueDate: string | null;
  overdue: boolean;
  assigneeName: string | null;
  assigneeUserId: string | null;
  priority: JobPriority;
  advance: number;
  notes: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  trackToken: string;
  total: number;
  /** The answer to the estimate now asked; null when not answered (or never asked). */
  approval: JobApproval | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface JobLine {
  id: string;
  kind: LineKind;
  itemId: string | null;
  description: string;
  qty: number;
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string | null;
  amount: number;
  tax: number;
  /** Serial numbers / IMEIs of the units on this part line. */
  serials: string[];
}

export interface JobEvent {
  id: string;
  type: JobEventType;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  note: string | null;
  userId: string | null;
  createdAt: string;
}

export interface JobTotals {
  parts: number;
  labour: number;
  amount: number;
  tax: number;
  total: number;
  advance: number;
  balance: number;
}

/** `GET /jobcards/:id` */
export interface Job extends JobSummary {
  lines: JobLine[];
  events: JobEvent[];
  totals: JobTotals;
  moves: JobStatus[];
  next: JobStatus[];
  /** When it was last sent for approval. */
  approvalRequestedAt: string | null;
}

export interface JobsSummary {
  open: number;
  ready: number;
  overdue: number;
  byStatus: Record<string, number>;
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
  /** The advance recorded on the bill as paid. */
  advancePaid?: number;
}

/** A unit on the shelf (`GET /serials/units`), for picking serials on a part line. */
export interface SerialUnit {
  id: string;
  itemId: string;
  serial: string;
  serial2: string | null;
  status: string;
}

/** A billing item (catalogue variant) from `GET /invoices/items`. */
export interface ShopItem {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}
