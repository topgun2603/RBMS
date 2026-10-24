/**
 * API shapes the workspace UI reads: `/v1/staff`, `/v1/audit`, `/v1/import` + `/v1/export` and `/v1/onboarding`
 * (packages/staff, audit, importexport, onboarding). Dates arrive as ISO strings.
 */

export interface Paged<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------- staff

/** Base level of a membership. Owners are managed through tenancy; the staff API assigns admin/staff/member. */
export type Level = "owner" | "admin" | "staff" | "member";
export const ASSIGNABLE_LEVELS = ["admin", "staff"] as const;
export type AssignableLevel = (typeof ASSIGNABLE_LEVELS)[number];

export interface StaffMember {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  level: Level | null;
  roles: string[];
  roleKeys: string[];
  active: boolean;
  lastActive: string | null;
  joinedAt: string;
}

export interface InviteInput {
  /** Phone (+91…) or email. */
  target: string;
  roleKeys: string[];
  level?: AssignableLevel;
}

export interface MemberPatch {
  roleKeys?: string[];
  level?: AssignableLevel;
  active?: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  /** Permission patterns: "invoices.create", "orders.*", "*.view". */
  permissions: string[];
  builtin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RoleInput {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
}

export interface PermissionDef {
  key: string;
  module: string;
  label: string;
  description: string;
}

export interface PermissionGroup {
  module: string;
  permissions: PermissionDef[];
}

// ---------------------------------------------------------------- audit

export interface AuditEvent {
  id: string;
  /** Null only for platform events (super-admin listing); a shop's own log never contains them. */
  tenantId: string | null;
  actorUserId: string | null;
  /** "invoice.cancel" or the derived "invoices.post /:id/cancel". */
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Extra field of the `GET /audit` list: the count stops at 10,000 (`total` is then 10,000). */
export interface AuditListExtras {
  totalCapped?: boolean;
}

// ---------------------------------------------------------------- import / export

export interface ImporterColumn {
  key: string;
  label: string;
  required: boolean;
  example: string | null;
  help: string | null;
}

export interface Importer {
  key: string;
  label: string;
  feature: string | null;
  /** Re-importing the same file skips what was imported before. */
  idempotent?: boolean;
  columns: ImporterColumn[];
}

export interface Exporter {
  key: string;
  label: string;
  feature: string | null;
}

/** Importer column key → index of the file column it reads (null = not imported). */
export type Mapping = Record<string, number | null>;

export interface DetectedColumn {
  index: number;
  header: string;
  mappedTo: string | null;
}

export interface PreviewRow {
  /** File row number (header = 1, first data row = 2). */
  row: number;
  data: Record<string, unknown>;
  errors: string[];
  raw: string[];
}

export interface PreviewResult {
  jobId: string;
  key: string;
  fileName: string | null;
  columns: DetectedColumn[];
  mapping: Mapping;
  /** Labels of required columns the file doesn't have. */
  missing: string[];
  rows: PreviewRow[];
  totals: { rows: number; valid: number; invalid: number };
  /** Source software used for the header aliases. */
  source?: SourceId;
  /** Source guessed from the headers when it differs from the chosen one. */
  detectedSource?: SourceId | null;
  /** Rows left out before mapping (receipts, journals, returns, report totals). */
  ignoredRows?: number;
  /** Valid rows imported before; they are skipped on commit. */
  alreadyImported?: number;
}

export type SourceId = "generic" | "vyapar" | "tally" | "busy" | "marg";

export interface ImportSource {
  id: SourceId;
  label: string;
  labelTa: string;
  /** "documented" = layout confirmed; "assumed" = tolerant matching on commonly seen column names. */
  verified: "documented" | "assumed";
  formats: string[];
  /** importer key -> what to export from that software. */
  exports: Record<string, string>;
  notes: string;
}

export interface ImportOptions {
  /** Keep the unpaid part of imported bills outstanding (default: it is already in the party balance). */
  carryDues?: boolean;
}

export interface ExportJob {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "expired";
  fileName: string | null;
  fileSize: number | null;
  counts: Record<string, number>;
  error: string | null;
  expiresAt: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export type ImportJobStatus = "preview" | "queued" | "running" | "done" | "failed" | "rolled_back";

export interface ImportJob {
  jobId: string;
  key: string;
  status: ImportJobStatus;
  fileName: string | null;
  total: number;
  valid: number;
  invalid: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: { row: number; message: string }[];
  source?: string | null;
  options?: ImportOptions;
  ignoredRows?: number;
  /** Set after an undo: how many records were removed and which had to stay. */
  rollback?: { reverted: number; kept: { entity: string; key: string; reason: string }[] } | null;
  rolledBackAt?: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// ---------------------------------------------------------------- onboarding

export interface OnboardingStep {
  key: string;
  label: string;
  description: string;
  /** UI route hint relative to the app root, e.g. "settings/business". */
  href: string;
  done: boolean;
  skipped: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  /** Done or skipped. */
  completed: number;
  total: number;
  dismissed: boolean;
}

// ---------------------------------------------------------------- customer messages (GET /messages/settings)

export type MessageChannelMode = "whatsapp" | "sms" | "both";
export type MessageGroup = "bookings" | "jobcards" | "memberships" | "orders" | "store";

export interface MessagesSettings {
  language: "en" | "ta";
  email: boolean;
  bookingReminderHours: number;
  membershipRenewalDays: number;
  abandonedCartHours: number;
  events: Record<string, { on: boolean; channel: MessageChannelMode }>;
}

export interface MessageEventInfo {
  key: string;
  group: MessageGroup;
  marketing: boolean;
  /** The event's feature is on for this shop. */
  available: boolean;
  /** WhatsApp text with sample values, in the shop's message language. */
  preview: string;
}

export interface MessagesSettingsView {
  values: MessagesSettings;
  events: MessageEventInfo[];
  quietHours: { from: number; to: number };
}

export interface SentMessage {
  id: string;
  channel: "sms" | "email" | "whatsapp" | "push";
  /** Masked. */
  to: string;
  templateKey: string | null;
  status: "queued" | "sent" | "failed";
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface TestSendResult {
  channel: string;
  status: "queued" | "sent" | "failed" | "skipped";
  reason?: string;
  to?: string;
}
